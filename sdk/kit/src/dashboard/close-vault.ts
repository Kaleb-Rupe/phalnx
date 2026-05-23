/**
 * close-vault helpers — pending-PDA enumeration for the close_vault path.
 *
 * CH-2 (Bucket-3 audit 2026-05-23) companion to the Rust handler change
 * in `programs/sigil/src/instructions/close_vault.rs` that added a drain
 * block for the `pending_constraints` PDA.
 *
 * Why this lives in its own file
 * ─────────────────────────────
 * The user-facing `closeVault` builder lives in `mutations.ts` (a
 * generously-sized file). CH-3 is concurrently editing `mutations.ts`,
 * so CH-2 keeps its surface minimal here: pure PDA enumeration helpers
 * plus the canonical drain order. CH-3 imports
 * {@link enumerateExistingPendingPdasForClose} (or the individual
 * derivation helpers) when wiring the new account into the
 * `remainingAccounts` list.
 *
 * On-chain ordering invariant
 * ───────────────────────────
 * close_vault.rs (HEAD 321a8fb3 + CH-2):
 *
 *   1. `pending_policy`              [b"pending_policy", vault]            — MUST be slot 0 when present (close_vault.rs:100-103 unconditionally reads `remaining_accounts.first()`)
 *   2. `pending_agent_perms`         [b"pending_agent_perms", vault, agent] — one per registered agent
 *   3. `pending_close_constraints`   [b"pending_close_constraints", vault]
 *   4. `pending_owner`               [b"pending_owner", vault]
 *   5. `pending_agent_grant`         [b"pending_agent_grant", vault]
 *   6. `pending_constraints`         [b"pending_constraints", vault]      — **CH-2 (new)**
 *
 * The Rust drain loops at lines 130-231 use `start_idx` (= 1 if
 * `policy.has_pending_policy`, else 0) — a single static offset, not an
 * incrementing cursor. So drains 2-6 all scan the same trailing window
 * and match by pubkey. The order of items 2-6 in `remaining_accounts`
 * does not matter functionally, but {@link CLOSE_VAULT_PENDING_PDA_ORDER}
 * pins the canonical layout for review-grep + future audit symmetry.
 *
 * Behavior on RPC failure
 * ───────────────────────
 * {@link enumerateExistingPendingPdasForClose} treats RPC `getAccountInfo`
 * failures as "absent": the close TX still goes through, the on-chain
 * handler silently skips any drain block whose PDA isn't passed (since
 * `lamports() > 0` is the guard). This matches the existing
 * `mutations.ts::closeVault` behavior for `pending_policy` +
 * `pending_agent_perms` + `pending_close_constraints`. A transient RPC
 * outage therefore degrades to "rent stays orphaned, vault still closes"
 * — never to "close TX rejects".
 */

import {
  type Address,
  type Rpc,
  type SolanaRpcApi,
  AccountRole,
  getProgramDerivedAddress,
  getAddressEncoder,
} from "../kit-adapter.js";

import { SIGIL_PROGRAM_ADDRESS } from "../generated/programs/sigil.js";
import { getSigilModuleLogger } from "../logger.js";
import { redactCause } from "../network-errors.js";

// ─── Seed constants ──────────────────────────────────────────────────────

const PENDING_OWNER_SEED = new TextEncoder().encode("pending_owner");
const PENDING_AGENT_GRANT_SEED = new TextEncoder().encode(
  "pending_agent_grant",
);
const PENDING_CONSTRAINTS_SEED = new TextEncoder().encode(
  "pending_constraints",
);

/**
 * Canonical layout pins for `close_vault` remaining_accounts.
 *
 * Mirrors the drain blocks in `programs/sigil/src/instructions/close_vault.rs`
 * (HEAD 321a8fb3 + CH-2). The Rust loops match by pubkey within
 * `remaining_accounts.iter().skip(start_idx)` so items 2-6 are
 * positionally interchangeable, but callers SHOULD append in this order
 * to keep audit-trail diffs reviewable.
 */
export const CLOSE_VAULT_PENDING_PDA_ORDER = [
  "pending_policy",
  "pending_agent_perms", // one per registered agent
  "pending_close_constraints",
  "pending_owner",
  "pending_agent_grant",
  "pending_constraints", // CH-2 (Bucket-3 audit 2026-05-23)
] as const;

// ─── PDA derivation ──────────────────────────────────────────────────────

/**
 * Derive the `PendingOwnershipTransfer` PDA for a vault.
 * Seeds: `[b"pending_owner", vault]`
 *
 * Drained by `close_vault.rs:187-203` (SFH-01 fix, audit 2026-05-19).
 */
export async function findPendingOwnerPda(
  vault: Address,
  programAddress: Address = SIGIL_PROGRAM_ADDRESS,
): Promise<Address> {
  const encoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds: [PENDING_OWNER_SEED, encoder.encode(vault)],
  });
  return pda;
}

/**
 * Derive the `PendingAgentGrant` PDA for a vault.
 * Seeds: `[b"pending_agent_grant", vault]`
 *
 * Drained by `close_vault.rs:215-231` (SFH-01 fix, audit 2026-05-19).
 */
export async function findPendingAgentGrantPda(
  vault: Address,
  programAddress: Address = SIGIL_PROGRAM_ADDRESS,
): Promise<Address> {
  const encoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds: [PENDING_AGENT_GRANT_SEED, encoder.encode(vault)],
  });
  return pda;
}

/**
 * Derive the `PendingConstraintsUpdate` PDA for a vault.
 * Seeds: `[b"pending_constraints", vault]`
 *
 * Drained by `close_vault.rs` (CH-2 block, Bucket-3 audit 2026-05-23).
 *
 * Re-exported here (separate from the existing
 * `constraint-reads.ts::findPendingConstraintsPda`) so the close_vault
 * builder can stay in this file's narrow API surface without a
 * cross-file import for a one-line seed derivation.
 */
export async function findPendingConstraintsPdaForClose(
  vault: Address,
  programAddress: Address = SIGIL_PROGRAM_ADDRESS,
): Promise<Address> {
  const encoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds: [PENDING_CONSTRAINTS_SEED, encoder.encode(vault)],
  });
  return pda;
}

// ─── On-chain enumeration ────────────────────────────────────────────────

/**
 * One entry in the close_vault remaining_accounts list — wraps a single
 * pending PDA pubkey alongside the role bit the on-chain drain block
 * requires (always `WRITABLE`, since the lamports + assign + resize
 * mutations need write access).
 */
export interface CloseVaultPendingAccount {
  /** Stable identifier for logs / audit diffs. Mirrors
   * {@link CLOSE_VAULT_PENDING_PDA_ORDER}. */
  readonly kind: (typeof CLOSE_VAULT_PENDING_PDA_ORDER)[number];
  /** PDA address. */
  readonly address: Address;
  /** Always WRITABLE — the drain block transfers lamports + reassigns. */
  readonly role: AccountRole.WRITABLE;
}

/**
 * Enumerate the **CH-2 + SFH-01** pending PDAs (pending_owner,
 * pending_agent_grant, pending_constraints) that currently hold rent
 * on-chain for a given vault.
 *
 * This helper is the load-bearing piece of the CH-2 SDK companion: callers
 * (the `closeVault` builder in `mutations.ts` — CH-3 will wire it)
 * append the returned entries to the existing
 * `pending_policy` + `pending_agent_perms` + `pending_close_constraints`
 * list to ensure every drainable PDA is covered.
 *
 * Failure mode: RPC errors on individual PDAs are logged via the Sigil
 * module logger and treated as "absent" — the close TX still proceeds,
 * but the missed PDA's rent stays orphaned (same compromise as the
 * existing `mutations.ts::closeVault` handles for the other drains).
 *
 * HH-1 close (audit 2026-05-23): the optional `onRpcError` callback lets
 * callers (e.g. `mutations.ts::closeVault`) escalate the visibility of
 * an enumeration failure beyond the module logger — emit an
 * ERROR-level log line with vault context, throw, or display a UI
 * warning. Without the callback the existing best-effort drain
 * semantic is preserved (warn-and-continue).
 */
export async function enumerateExistingPendingPdasForClose(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  programAddress: Address = SIGIL_PROGRAM_ADDRESS,
  onRpcError?: (kind: CloseVaultPendingAccount["kind"], address: Address, cause: unknown) => void,
): Promise<readonly CloseVaultPendingAccount[]> {
  const [pendingOwnerPda, pendingAgentGrantPda, pendingConstraintsPda] =
    await Promise.all([
      findPendingOwnerPda(vault, programAddress),
      findPendingAgentGrantPda(vault, programAddress),
      findPendingConstraintsPdaForClose(vault, programAddress),
    ]);

  const candidates: ReadonlyArray<{
    kind: CloseVaultPendingAccount["kind"];
    address: Address;
  }> = [
    { kind: "pending_owner", address: pendingOwnerPda },
    { kind: "pending_agent_grant", address: pendingAgentGrantPda },
    { kind: "pending_constraints", address: pendingConstraintsPda },
  ];

  const checks = await Promise.all(
    candidates.map(async ({ kind, address }) => {
      try {
        const info = await rpc
          .getAccountInfo(address, { encoding: "base64" })
          .send();
        return info?.value
          ? ({
              kind,
              address,
              role: AccountRole.WRITABLE,
            } as CloseVaultPendingAccount)
          : null;
      } catch (err: unknown) {
        const cause = redactCause(err);
        getSigilModuleLogger().warn(
          `[close_vault] existence check failed for ${kind} ${address} — treating as absent: ${
            cause.message ?? cause.name ?? cause.code ?? "unknown"
          }`,
        );
        // HH-1 close (audit 2026-05-23): give callers a chance to
        // escalate the RPC failure (e.g. emit error-level log with
        // vault context, throw to abort close, surface in UI). The
        // existing module logger is preserved as the default low-floor
        // signal.
        if (onRpcError !== undefined) {
          try {
            onRpcError(kind, address, err);
          } catch {
            // Caller's callback must not break the enumeration —
            // swallow silently. Errors from the callback itself are
            // a programming bug in the caller.
          }
        }
        return null;
      }
    }),
  );

  return checks.filter(
    (entry): entry is CloseVaultPendingAccount => entry !== null,
  );
}
