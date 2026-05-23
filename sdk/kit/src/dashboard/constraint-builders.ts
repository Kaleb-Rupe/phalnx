/**
 * @usesigil/kit/dashboard — Constraint instruction-chain builders.
 *
 * The on-chain `create_instruction_constraints` and `queue_constraints_update`
 * handlers require their target PDA to already be allocated to a fixed size
 * before the populate instruction runs (35,888 bytes for `InstructionConstraints`,
 * 35,904 bytes for `PendingConstraintsUpdate`). The runtime CPI realloc cap is
 * 10,240 bytes per call, so the PDA must be grown across multiple instructions
 * batched into a single transaction.
 *
 * This module composes the full 5-instruction chain:
 *
 *   1. `allocate_constraints_pda` (or `allocate_pending_constraints_pda`)
 *      — initial 10,240-byte allocation
 *   2. `extend_pda` to 20,480 bytes
 *   3. `extend_pda` to 30,720 bytes
 *   4. `extend_pda` to 35,888 (constraints) or 35,904 (pending) bytes
 *   5. `create_instruction_constraints` (or `queue_constraints_update`)
 *      — populate with the caller-provided entries
 *
 * **Why this matters (Day-0 bug):** before this module existed, `mutations.ts`
 * sent only step 5. Every owner call hit `InvalidConstraintsPda` on-chain
 * because step-5's `require!(info.data_len() == InstructionConstraints::SIZE)`
 * could never be satisfied — the PDA didn't exist.
 *
 * **Tx-size guardrail:** all 5 instructions ride in one transaction (atomic —
 * partial allocation is unsafe). Solana's 1232-byte wire limit means the
 * realistic ceiling is ~3 fully-populated `ConstraintEntry`s per call. Past
 * that, this module throws `SIGIL_ERROR__RPC__TX_TOO_LARGE` at build time
 * rather than letting the RPC reject it. Splitting across transactions is not
 * an option — a half-allocated PDA leaves the vault wedged until manual cleanup.
 *
 * The builders return `Instruction[]`; callers (typically `mutations.ts`)
 * pass that array straight into `run()` for blockhash/signing/submission.
 * Address lookup tables compress the recurring vault/owner accounts and let
 * us fit 3 fully-populated entries within the limit.
 */

import type {
  Address,
  Instruction,
  TransactionSigner,
} from "../kit-adapter.js";
import {
  pipe,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "../kit-adapter.js";
import { measureTransactionSize, MAX_TX_SIZE } from "../composer.js";
import { SigilRpcError } from "../errors/rpc.js";
import { SIGIL_ERROR__RPC__TX_TOO_LARGE } from "../errors/codes.js";
import { getAllocateConstraintsPdaInstructionAsync } from "../generated/instructions/allocateConstraintsPda.js";
import { getAllocatePendingConstraintsPdaInstructionAsync } from "../generated/instructions/allocatePendingConstraintsPda.js";
import { getCreateInstructionConstraintsInstructionAsync } from "../generated/instructions/createInstructionConstraints.js";
import { getExtendPdaInstruction } from "../generated/instructions/extendPda.js";
import { getQueueConstraintsUpdateInstructionAsync } from "../generated/instructions/queueConstraintsUpdate.js";
import {
  findConstraintsPda,
  findPendingConstraintsPda,
} from "./constraint-reads.js";
import type { ConstraintEntry } from "./types.js";

// ─── On-chain layout constants ──────────────────────────────────────────────
//
// Mirror the Rust constants in `programs/sigil/src/state/constraints.rs` and
// `programs/sigil/src/instructions/allocate_constraints_pda.rs`. If the on-chain
// layout grows, regenerate Codama AND update these. The on-chain
// `assert_size_in_sync` test ensures the Rust SIZE constant stays in sync with
// the computed layout — but TypeScript has no such cross-language assertion,
// so any change here MUST be paired with a deliberate audit of the chain.

/** `InstructionConstraints::SIZE` — full byte length of the populated PDA. */
export const CONSTRAINTS_SIZE = 35_888;

/**
 * `PendingConstraintsUpdate::SIZE` — full byte length of the populated PDA.
 * Source: `programs/sigil/src/state/pending_constraints.rs:47`
 * Layout: 8 disc + 32 vault + (560 * 64) entries + 1 entries_count + 1 bump
 *       + 6 padding + 8 created_at + 8 queued_at_slot [F-10] + 8 effective_at
 *       + 32 pending_content_digest [M-4 Bucket 2 PEN-CROSS-3]
 *       = 35,944.
 */
export const PENDING_CONSTRAINTS_SIZE = 35_944;

/**
 * `MAX_CPI_ACCOUNT_SIZE` — initial alloc + max growth per `extend_pda` call.
 * Solana's runtime caps a single CPI realloc to this many bytes.
 */
export const MAX_CPI_ACCOUNT_SIZE = 10_240;

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Compute the sequence of `target_size` values for the extend chain.
 * Starts at MAX_CPI_ACCOUNT_SIZE (the initial alloc) and grows by at most
 * MAX_CPI_ACCOUNT_SIZE per step until reaching `fullSize`.
 */
function extendSteps(fullSize: number): number[] {
  const steps: number[] = [];
  let current = MAX_CPI_ACCOUNT_SIZE;
  while (current < fullSize) {
    current = Math.min(current + MAX_CPI_ACCOUNT_SIZE, fullSize);
    steps.push(current);
  }
  return steps;
}

/**
 * Best-effort tx-size check on the in-progress instruction list.
 *
 * Compiles a stub transaction (zero blockhash, owner as fee payer) and asks
 * Kit to measure the wire bytes. The signature/blockhash bytes are fixed
 * size, so this is a faithful upper-bound check at build time — no RPC.
 *
 * Throws `SIGIL_ERROR__RPC__TX_TOO_LARGE` so the existing dashboard error
 * pipeline recognizes the failure category.
 */
function assertWithinTxSize(
  owner: TransactionSigner,
  instructions: Instruction[],
): void {
  // Use a fixed all-zero blockhash for the measurement. Real submission
  // replaces this; the wire-size delta is zero.
  const stubBlockhash = {
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 0n,
  };

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(owner.address, tx),
    (tx) =>
      setTransactionMessageLifetimeUsingBlockhash(
        stubBlockhash as Parameters<
          typeof setTransactionMessageLifetimeUsingBlockhash
        >[0],
        tx,
      ),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );
  const compiled = compileTransaction(
    message as Parameters<typeof compileTransaction>[0],
  );
  const { byteLength, withinLimit } = measureTransactionSize(compiled);
  if (!withinLimit) {
    throw new SigilRpcError(
      SIGIL_ERROR__RPC__TX_TOO_LARGE,
      `Constraint chain wire size ${byteLength} bytes exceeds limit of ${MAX_TX_SIZE} bytes. ` +
        `Reduce ConstraintEntry payload size or split entries across multiple owner calls.`,
      { context: { byteLength, limit: MAX_TX_SIZE } },
    );
  }
}

// ─── Public types ───────────────────────────────────────────────────────────

export interface BuildCreateConstraintsInput {
  owner: TransactionSigner;
  vault: Address;
  /**
   * Policy PDA address. Callers normally derive this via `getPolicyPDA(vault)`
   * and pass the result. The codama generators auto-derive from `vault` if
   * omitted, but we keep `policy` explicit here to match the on-chain struct
   * and to avoid a hidden async PDA derivation inside the builder.
   */
  policy: Address;
  entries: ConstraintEntry[];
  /**
   * PEN-CROSS-3 (Phase 2 close-up): owner-signed digest covering the
   * post-mutation policy state (with `has_constraints=true`). The on-chain
   * `create_instruction_constraints` handler recomputes the digest from the
   * resulting `PolicyConfig` and rejects with `PolicyPreviewMismatch` if the
   * caller's digest does not match. Required for `buildCreateConstraintsIxs`
   * — forces the owner to explicitly attest the flag flip.
   *
   * NOT required for `buildQueueConstraintsUpdateIxs` (queue path doesn't
   * mutate `has_constraints`); pass `undefined` there.
   *
   * Compute via `computePolicyPreviewDigest` with `hasConstraints: true` and
   * all other fields read from live `PolicyConfig` + `AgentVault`.
   */
  expectedDigest?: Uint8Array;
  // strictMode field removed in V2 (REVAMP_PLAN §2.2): every entry is strictly
  // enforced. Callers no longer pass a mode flag.
}

// ─── Public builders ────────────────────────────────────────────────────────

/**
 * Build the 5-instruction chain that allocates the constraints PDA and writes
 * the caller-provided entries. Pass the returned array into `run()` (or any
 * other transaction submitter) — all 5 instructions must ride in one tx.
 *
 * Throws `SIGIL_ERROR__RPC__TX_TOO_LARGE` if the entries do not fit within
 * Solana's 1232-byte wire limit. Catch and split entries across multiple
 * owner calls in that case (no automatic fallback — partial PDA allocation
 * is unsafe and would wedge the vault).
 */
export async function buildCreateConstraintsIxs(
  input: BuildCreateConstraintsInput,
): Promise<Instruction[]> {
  const { owner, vault, policy, entries, expectedDigest } = input;

  if (!entries || entries.length === 0) {
    // Match the validation already performed in `mutations.createConstraints`.
    // Putting it here too means direct callers of the builder get the same
    // guard, and the mutation wrapper becomes trivially correct.
    throw new Error("Constraint entries must be a non-empty array");
  }

  // PEN-CROSS-3: this path mutates has_constraints. expectedDigest required.
  if (!expectedDigest || expectedDigest.length !== 32) {
    throw new Error(
      "buildCreateConstraintsIxs: expectedDigest is required (32-byte SHA-256 of post-mutation policy fields). Compute via computePolicyPreviewDigest with hasConstraints=true.",
    );
  }

  const constraintsPda = await findConstraintsPda(vault);

  // Step 1: initial 10,240-byte allocation (single CPI alloc).
  const allocateIx = await getAllocateConstraintsPdaInstructionAsync({
    owner,
    vault,
    policy,
    constraints: constraintsPda,
  });

  // Steps 2..N-1: extend in 10,240-byte increments until we reach full size.
  const extendIxs = extendSteps(CONSTRAINTS_SIZE).map((targetSize) =>
    getExtendPdaInstruction({
      owner,
      vault,
      pda: constraintsPda,
      targetSize,
    }),
  );

  // Step N: populate (the original instruction the SDK was sending alone).
  // PEN-CROSS-3: pass the owner-signed post-mutation digest.
  const populateIx = await getCreateInstructionConstraintsInstructionAsync({
    owner,
    vault,
    policy,
    constraints: constraintsPda,
    entries,
    expectedDigest,
  });

  const ixs: Instruction[] = [allocateIx, ...extendIxs, populateIx];

  assertWithinTxSize(owner, ixs);

  return ixs;
}

/**
 * Build the 5-instruction chain for `queueConstraintsUpdate`. Targets the
 * `pending_constraints` PDA (seed `b"pending_constraints"`) at 35,904 bytes
 * — 16 more than `InstructionConstraints` to accommodate the extra timestamp
 * fields in `PendingConstraintsUpdate`.
 *
 * Same tx-size contract as `buildCreateConstraintsIxs`.
 */
export async function buildQueueConstraintsUpdateIxs(
  input: BuildCreateConstraintsInput,
): Promise<Instruction[]> {
  const { owner, vault, policy, entries } = input;

  if (!entries || entries.length === 0) {
    throw new Error("Constraint entries must be a non-empty array");
  }

  // Both PDAs must exist for queueing: constraints (the live config) and
  // pendingConstraints (the freshly allocated buffer we're about to write).
  const [constraintsPda, pendingConstraintsPda] = await Promise.all([
    findConstraintsPda(vault),
    findPendingConstraintsPda(vault),
  ]);

  // Step 1: initial alloc on the *pending* PDA. The on-chain handler verifies
  // that `constraints` already exists — i.e. there is something to update —
  // before allocating `pending_constraints`.
  const allocateIx = await getAllocatePendingConstraintsPdaInstructionAsync({
    owner,
    vault,
    policy,
    constraints: constraintsPda,
    pendingConstraints: pendingConstraintsPda,
  });

  // Steps 2..N-1: grow the pending PDA to 35,904 bytes. The on-chain
  // `extend_pda` handler keys on the `vault` field stored in the PDA at
  // bytes 8..40, so a single instruction works for both PDA types.
  const extendIxs = extendSteps(PENDING_CONSTRAINTS_SIZE).map((targetSize) =>
    getExtendPdaInstruction({
      owner,
      vault,
      pda: pendingConstraintsPda,
      targetSize,
    }),
  );

  // Step N: queue the update payload onto the pre-allocated buffer.
  const populateIx = await getQueueConstraintsUpdateInstructionAsync({
    owner,
    vault,
    policy,
    constraints: constraintsPda,
    pendingConstraints: pendingConstraintsPda,
    entries,
  });

  const ixs: Instruction[] = [allocateIx, ...extendIxs, populateIx];

  assertWithinTxSize(owner, ixs);

  return ixs;
}
