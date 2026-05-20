/**
 * Phase 8 Batch 3 — C26 ownership transfer LiteSVM coverage.
 *
 * Three new owner-side instructions land in this batch:
 *   - initiate_ownership_transfer  (disc=7)
 *   - accept_ownership_transfer    (disc=8)  EOA flow
 *   - cancel_ownership_transfer    (disc=9)
 *
 * The multisig-target accept variant (`is_multisig_target == true`) lives in
 * Batch 4 — this suite verifies the EOA path AND that the multisig path is
 * hard-rejected by today's EOA accept handler.
 *
 * Coverage map (Council ISC labels in parens):
 *   1. Happy: initiate + advance >= min_delay + accept                     (ISC-25..41)
 *   2. Boundary REJECT: accept at queued_at + min_delay - 1   → 6104       (ISC-37)
 *   3. Boundary OK:     accept at queued_at + min_delay        → success   (ISC-37)
 *   4. Double-init REJECT: initiate twice without cancel       → Anchor 0  (ISC-30 6103-class)
 *   5. Cancel by NON-current-owner REJECT: signer mismatch     → Anchor 2003
 *   6. Cancel HAPPY (cosign_required=false)                                 (ISC-49..53)
 *   7. Initiate when vault.Frozen REJECT                       → 6000      (ISC-130)
 *   8. Initiate to SystemProgram::ID REJECT                    → 6107      (ISC-128)
 *   9. Initiate when cosign_required=true + no cosigner REJECT → 6089      (ISC-129)
 *  10. Initiate when cosign_required=true + cosigner signs     → success
 *  11. Accept multisig-target via EOA handler REJECT           → 6104       (Batch 4 boundary)
 *
 * Each test uses a unique vault_id (9000+) to keep state isolated.
 *
 * Audit-log discriminator sanity (ISC-81..83): each happy path also asserts
 * the audit-log success buffer contains the expected disc byte (7/8/9).
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sigil } from "../target/types/sigil";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import {
  initVaultPreviewDigest,
} from "./helpers/policy-digest";
import {
  createTestEnv,
  airdropSol,
  createMintAtAddress,
  DEVNET_USDC_MINT,
  advanceTime,
  accountExists,
  TestEnv,
  LiteSVM,
} from "./helpers/litesvm-setup";

const STANDARD_INIT_DAILY_CAP = new BN(500_000_000);
const STANDARD_INIT_MAX_TX = new BN(100_000_000);
const STANDARD_INIT_TIMELOCK = new BN(1800);

// Mirrors PendingOwnershipTransfer::DEFAULT_MIN_DELAY (48h).
const DEFAULT_MIN_DELAY = 172_800;

// Audit-log discriminators (mirrors state/audit_log_success.rs).
const DISC_OWNERSHIP_INITIATE = 7;
const DISC_OWNERSHIP_ACCEPT = 8;
const DISC_OWNERSHIP_CANCEL = 9;

// Per-entry layout — must match programs/sigil/src/state/audit_log_success.rs.
const ENTRY_SIZE = 64;
const SUCCESS_CAPACITY = 128;
const ENTRIES_OFFSET = 8 + 32; // after disc + vault

/** Decode the last-written audit-log success buffer entry's discriminator. */
function lastSuccessDisc(svm: LiteSVM, auditSuccess: PublicKey): number {
  const acct = svm.getAccount(auditSuccess);
  if (!acct) throw new Error("audit log missing");
  const buf = Buffer.from(acct.data);
  const entriesEnd = 8 + 32 + ENTRY_SIZE * SUCCESS_CAPACITY;
  const head = buf[entriesEnd];
  const count = buf[entriesEnd + 1];
  if (count === 0) throw new Error("audit log empty");
  // head points to the NEXT slot to write; the most recent entry is head-1.
  const lastIdx = (head + SUCCESS_CAPACITY - 1) % SUCCESS_CAPACITY;
  return buf[ENTRIES_OFFSET + lastIdx * ENTRY_SIZE + 63];
}

describe("ownership-transfer (Phase 8 Batch 3 — C26)", () => {
  let env: TestEnv;
  let svm: LiteSVM;
  let program: Program<Sigil>;
  let owner: anchor.Wallet;

  const feeDestination = Keypair.generate();
  const jupiterProgramId = Keypair.generate().publicKey;

  before(async () => {
    env = createTestEnv();
    svm = env.svm;
    program = env.program;
    owner = env.provider.wallet;

    airdropSol(svm, owner.publicKey, 1000 * LAMPORTS_PER_SOL);
    airdropSol(svm, feeDestination.publicKey, 2 * LAMPORTS_PER_SOL);

    createMintAtAddress(svm, DEVNET_USDC_MINT, owner.publicKey, 6);
  });

  /**
   * Initialize a fresh vault with optional cosign-required override. Returns
   * the PDAs the ownership-transfer handlers consume.
   */
  async function initVault(
    vaultId: BN,
    opts: { cosignRequired?: boolean } = {},
  ) {
    const cosignRequired = opts.cosignRequired ?? false;

    const [vault] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        owner.publicKey.toBuffer(),
        vaultId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
    const [policy] = PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), vault.toBuffer()],
      program.programId,
    );
    const [tracker] = PublicKey.findProgramAddressSync(
      [Buffer.from("tracker"), vault.toBuffer()],
      program.programId,
    );
    const [overlay] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_spend"), vault.toBuffer(), Buffer.from([0])],
      program.programId,
    );
    const [auditSuccess] = PublicKey.findProgramAddressSync(
      [Buffer.from("audit_success"), vault.toBuffer()],
      program.programId,
    );
    const [auditRejected] = PublicKey.findProgramAddressSync(
      [Buffer.from("audit_rejected"), vault.toBuffer()],
      program.programId,
    );
    const [pendingOwner] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending_owner"), vault.toBuffer()],
      program.programId,
    );

    await program.methods
      .initializeVault(
        vaultId,
        STANDARD_INIT_DAILY_CAP,
        STANDARD_INIT_MAX_TX,
        1, // protocolMode = ALLOWLIST
        [jupiterProgramId],
        0,
        100,
        STANDARD_INIT_TIMELOCK,
        [],
        [],
        false, // observeOnly
        0x00ffffff,
        false, // autoPromoteGrays
        5, // autoRevokeThreshold
        new BN(0),
        new BN(0),
        cosignRequired,
        initVaultPreviewDigest({
          dailySpendingCapUsd: STANDARD_INIT_DAILY_CAP,
          maxTransactionSizeUsd: STANDARD_INIT_MAX_TX,
          maxSlippageBps: 100,
          protocolMode: 1,
          protocols: [jupiterProgramId],
          allowedDestinations: [],
          timelockDuration: STANDARD_INIT_TIMELOCK,
          operatingHours: 0x00ffffff,
          autoPromoteGrays: false,
          autoRevokeThreshold: 5,
          cosignRequired,
        }),
      )
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        tracker,
        agentSpendOverlay: overlay,
        auditLogSuccess: auditSuccess,
        auditLogRejected: auditRejected,
        feeDestination: feeDestination.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    return { vault, policy, tracker, overlay, auditSuccess, pendingOwner };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. HAPPY PATH — full initiate → wait → accept lifecycle.
  // ─────────────────────────────────────────────────────────────────────────
  it("happy path: initiate + advance min_delay + accept → vault.owner mutates, pending closed", async () => {
    const { vault, policy, auditSuccess, pendingOwner } = await initVault(
      new BN(9000),
    );
    const newOwner = Keypair.generate();
    airdropSol(svm, newOwner.publicKey, 1 * LAMPORTS_PER_SOL);

    // ACT — initiate.
    await program.methods
      .initiateOwnershipTransfer(newOwner.publicKey, false)
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // ASSERT — pending PDA populated + audit disc=7 written.
    const pendingState = await program.account.pendingOwnershipTransfer.fetch(
      pendingOwner,
    );
    expect(pendingState.vault.toString()).to.equal(vault.toString());
    expect(pendingState.currentOwner.toString()).to.equal(
      owner.publicKey.toString(),
    );
    expect(pendingState.newOwner.toString()).to.equal(
      newOwner.publicKey.toString(),
    );
    expect(pendingState.isMultisigTarget).to.equal(false);
    expect(pendingState.minDelaySeconds.toString()).to.equal(
      DEFAULT_MIN_DELAY.toString(),
    );
    expect(lastSuccessDisc(svm, auditSuccess)).to.equal(DISC_OWNERSHIP_INITIATE);

    // ACT — wait + accept.
    advanceTime(svm, DEFAULT_MIN_DELAY);

    await program.methods
      .acceptOwnershipTransfer()
      .accounts({
        newOwner: newOwner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([newOwner])
      .rpc();

    // ASSERT — vault.owner mutated, pending closed, audit disc=8 written.
    const vaultState = await program.account.agentVault.fetch(vault);
    expect(vaultState.owner.toString()).to.equal(newOwner.publicKey.toString());
    expect(accountExists(svm, pendingOwner)).to.equal(false);
    expect(lastSuccessDisc(svm, auditSuccess)).to.equal(DISC_OWNERSHIP_ACCEPT);

    // Phase 8 LBL-01 INVARIANT: vault_authority is IMMUTABLE across owner
    // transfer. The vault account itself stays at the original PDA address
    // (derived from the initial owner's pubkey + vault_id). If LBL-01
    // regresses, vault_authority would either be missing, mutated, or the
    // post-transfer downstream ix would fail with ConstraintSeeds.
    expect((vaultState as any).vaultAuthority.toString()).to.equal(
      owner.publicKey.toString(),
      "vault_authority MUST equal the original (init-time) owner — it is the immutable PDA seed-key",
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1B. LBL-01 REGRESSION GUARD — after ownership transfer, the new owner
  //     MUST be able to call owner-side instructions. Pre-LBL-01 the vault
  //     PDA seeds derived from `owner.key()` (or `vault.owner`), so once
  //     `vault.owner` mutated to `new_owner`, every subsequent owner-side
  //     ix derived a DIFFERENT PDA → Anchor ConstraintSeeds → vault bricked.
  //
  //     Post-LBL-01 the seeds derive from `vault.vault_authority` (immutable
  //     at init), so the new owner can sign owner-side ix successfully.
  // ─────────────────────────────────────────────────────────────────────────
  it("LBL-01: post-transfer new_owner can call owner-side ix (register_agent, pause_agent, freeze_vault) — vault NOT bricked", async () => {
    const { vault, policy, overlay, auditSuccess, pendingOwner } =
      await initVault(new BN(9050));
    const newOwner = Keypair.generate();
    airdropSol(svm, newOwner.publicKey, 5 * LAMPORTS_PER_SOL);

    // Phase 1: queue + accept ownership transfer.
    await program.methods
      .initiateOwnershipTransfer(newOwner.publicKey, false)
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    advanceTime(svm, DEFAULT_MIN_DELAY);

    await program.methods
      .acceptOwnershipTransfer()
      .accounts({
        newOwner: newOwner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([newOwner])
      .rpc();

    // Sanity: vault.owner is the new owner; vault_authority is unchanged.
    const postTransferVault = await program.account.agentVault.fetch(vault);
    expect(postTransferVault.owner.toString()).to.equal(
      newOwner.publicKey.toString(),
    );
    expect((postTransferVault as any).vaultAuthority.toString()).to.equal(
      owner.publicKey.toString(),
      "vault_authority MUST NOT change across ownership transfer",
    );

    // Phase 2: from new_owner, register an agent. Pre-LBL-01 this would
    // fail with ConstraintSeeds because the seed-key was new_owner.key()
    // which doesn't match the vault PDA (originally derived from old
    // owner's key).
    const newAgent = Keypair.generate();
    await program.methods
      .registerAgent(newAgent.publicKey, 2, new BN(0)) // CAPABILITY_OPERATOR = 2
      .accounts({
        owner: newOwner.publicKey,
        vault,
        policy,
        agentSpendOverlay: overlay,
      } as any)
      .signers([newOwner])
      .rpc();

    const afterRegister = await program.account.agentVault.fetch(vault);
    expect(afterRegister.agents.length).to.equal(1);
    expect(afterRegister.agents[0]!.pubkey.toString()).to.equal(
      newAgent.publicKey.toString(),
    );

    // Phase 3: from new_owner, pause the just-registered agent. Same
    // LBL-01 invariant — owner-side ix from new_owner MUST succeed.
    await program.methods
      .pauseAgent(newAgent.publicKey)
      .accounts({
        owner: newOwner.publicKey,
        vault,
        policy,
      } as any)
      .signers([newOwner])
      .rpc();

    const afterPause = await program.account.agentVault.fetch(vault);
    expect(afterPause.agents[0]!.paused).to.equal(true);

    // Phase 4: from new_owner, freeze the vault. Spec-required spot-check
    // that the freeze code path also resolves the vault PDA via
    // vault_authority post-transfer.
    await program.methods
      .freezeVault()
      .accounts({
        owner: newOwner.publicKey,
        vault,
      } as any)
      .signers([newOwner])
      .rpc();

    const afterFreeze = await program.account.agentVault.fetch(vault);
    expect(afterFreeze.status).to.have.property("frozen");
    expect((afterFreeze as any).vaultAuthority.toString()).to.equal(
      owner.publicKey.toString(),
      "vault_authority remains immutable across freeze",
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. BOUNDARY REJECT — accept one second before timelock elapses.
  // ─────────────────────────────────────────────────────────────────────────
  it("boundary: accept at queued_at + min_delay - 1 → reject 6104", async () => {
    const { vault, policy, auditSuccess, pendingOwner } = await initVault(
      new BN(9001),
    );
    const newOwner = Keypair.generate();
    airdropSol(svm, newOwner.publicKey, 1 * LAMPORTS_PER_SOL);

    await program.methods
      .initiateOwnershipTransfer(newOwner.publicKey, false)
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // Advance to one second BEFORE the timelock window.
    advanceTime(svm, DEFAULT_MIN_DELAY - 1);

    let caughtCode: number | null = null;
    try {
      await program.methods
        .acceptOwnershipTransfer()
        .accounts({
          newOwner: newOwner.publicKey,
          vault,
          policy,
          pending: pendingOwner,
          auditLogSuccess: auditSuccess,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([newOwner])
        .rpc();
    } catch (err: any) {
      caughtCode = err?.error?.errorCode?.number ?? null;
    }
    expect(caughtCode, "accept MUST have rejected").to.not.be.null;
    expect(caughtCode).to.equal(6104); // ErrPendingOwnershipNotReady
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. BOUNDARY OK — accept exactly at queued_at + min_delay succeeds.
  // ─────────────────────────────────────────────────────────────────────────
  it("boundary: accept at queued_at + min_delay → ok", async () => {
    const { vault, policy, auditSuccess, pendingOwner } = await initVault(
      new BN(9002),
    );
    const newOwner = Keypair.generate();
    airdropSol(svm, newOwner.publicKey, 1 * LAMPORTS_PER_SOL);

    await program.methods
      .initiateOwnershipTransfer(newOwner.publicKey, false)
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // Advance exactly to the boundary.
    advanceTime(svm, DEFAULT_MIN_DELAY);

    await program.methods
      .acceptOwnershipTransfer()
      .accounts({
        newOwner: newOwner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([newOwner])
      .rpc();

    const vaultState = await program.account.agentVault.fetch(vault);
    expect(vaultState.owner.toString()).to.equal(newOwner.publicKey.toString());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. DOUBLE-INIT REJECT — initiate twice without intervening cancel.
  // ─────────────────────────────────────────────────────────────────────────
  it("initiate when pending exists → reject (Anchor account-already-init)", async () => {
    const { vault, policy, auditSuccess, pendingOwner } = await initVault(
      new BN(9003),
    );
    const newOwner1 = Keypair.generate();
    const newOwner2 = Keypair.generate();

    await program.methods
      .initiateOwnershipTransfer(newOwner1.publicKey, false)
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // Second initiate against the SAME (vault, pending) → Anchor sees the
    // PDA already exists and rejects with AccountAlreadyInitialized.
    let rejected = false;
    try {
      await program.methods
        .initiateOwnershipTransfer(newOwner2.publicKey, false)
        .accounts({
          owner: owner.publicKey,
          vault,
          policy,
          pending: pendingOwner,
          auditLogSuccess: auditSuccess,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    } catch (err: any) {
      rejected = true;
    }
    expect(rejected, "double-initiate MUST reject").to.equal(true);

    // ASSERT — the first pending PDA still bound to newOwner1 (unchanged).
    const pendingState = await program.account.pendingOwnershipTransfer.fetch(
      pendingOwner,
    );
    expect(pendingState.newOwner.toString()).to.equal(
      newOwner1.publicKey.toString(),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. CANCEL BY NON-CURRENT-OWNER REJECT
  //    Phase 8 LBL-01: vault PDA seed-key is `vault.vault_authority`
  //    (immutable, set at init). PDA derivation succeeds regardless of
  //    signer identity, but the handler-level `require_keys_eq!(
  //    pending.current_owner, current_owner.key())` check inside
  //    `cancel_ownership_transfer` rejects the imposter signer.
  // ─────────────────────────────────────────────────────────────────────────
  it("cancel by non-current-owner → reject", async () => {
    const { vault, policy, auditSuccess, pendingOwner } = await initVault(
      new BN(9004),
    );
    const newOwner = Keypair.generate();
    const imposter = Keypair.generate();
    airdropSol(svm, imposter.publicKey, 1 * LAMPORTS_PER_SOL);

    await program.methods
      .initiateOwnershipTransfer(newOwner.publicKey, false)
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    let rejected = false;
    try {
      await program.methods
        .cancelOwnershipTransfer()
        .accounts({
          currentOwner: imposter.publicKey,
          vault,
          policy,
          pending: pendingOwner,
          auditLogSuccess: auditSuccess,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([imposter])
        .rpc();
    } catch (err: any) {
      rejected = true;
    }
    expect(rejected, "non-current-owner cancel MUST reject").to.equal(true);

    // ASSERT — pending PDA still alive.
    expect(accountExists(svm, pendingOwner)).to.equal(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. CANCEL HAPPY (cosign_required=false default).
  // ─────────────────────────────────────────────────────────────────────────
  it("cancel happy path (cosign_required=false) → pending closes, rent → current_owner", async () => {
    const { vault, policy, auditSuccess, pendingOwner } = await initVault(
      new BN(9005),
    );
    const newOwner = Keypair.generate();

    await program.methods
      .initiateOwnershipTransfer(newOwner.publicKey, false)
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    expect(accountExists(svm, pendingOwner)).to.equal(true);

    await program.methods
      .cancelOwnershipTransfer()
      .accounts({
        currentOwner: owner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    expect(accountExists(svm, pendingOwner)).to.equal(false);
    expect(lastSuccessDisc(svm, auditSuccess)).to.equal(DISC_OWNERSHIP_CANCEL);

    // ASSERT — vault.owner UNCHANGED (cancel does not mutate authority).
    const vaultState = await program.account.agentVault.fetch(vault);
    expect(vaultState.owner.toString()).to.equal(owner.publicKey.toString());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. INITIATE WHEN VAULT.FROZEN REJECT — Council ISC-130.
  // ─────────────────────────────────────────────────────────────────────────
  it("initiate when vault.Frozen → reject ErrVaultNotActive (6000)", async () => {
    const { vault, policy, auditSuccess, pendingOwner } = await initVault(
      new BN(9006),
    );
    const newOwner = Keypair.generate();

    // Freeze the vault first.
    await program.methods
      .freezeVault()
      .accounts({ owner: owner.publicKey, vault } as any)
      .rpc();

    let caughtCode: number | null = null;
    try {
      await program.methods
        .initiateOwnershipTransfer(newOwner.publicKey, false)
        .accounts({
          owner: owner.publicKey,
          vault,
          policy,
          pending: pendingOwner,
          auditLogSuccess: auditSuccess,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    } catch (err: any) {
      caughtCode = err?.error?.errorCode?.number ?? null;
    }
    expect(caughtCode, "initiate-when-frozen MUST reject").to.not.be.null;
    expect(caughtCode).to.equal(6000); // VaultNotActive
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. INITIATE TO BANNED ADDRESS REJECT — Council ISC-128.
  //    SystemProgram::ID is the canonical foot-gun target.
  // ─────────────────────────────────────────────────────────────────────────
  it("initiate to SystemProgram::ID → reject 6107 ErrInvalidOwnershipTarget", async () => {
    const { vault, policy, auditSuccess, pendingOwner } = await initVault(
      new BN(9007),
    );

    let caughtCode: number | null = null;
    try {
      await program.methods
        .initiateOwnershipTransfer(SystemProgram.programId, false)
        .accounts({
          owner: owner.publicKey,
          vault,
          policy,
          pending: pendingOwner,
          auditLogSuccess: auditSuccess,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    } catch (err: any) {
      caughtCode = err?.error?.errorCode?.number ?? null;
    }
    expect(caughtCode, "initiate-to-system MUST reject").to.not.be.null;
    expect(caughtCode).to.equal(6107); // ErrInvalidOwnershipTarget
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. INITIATE WHEN cosign_required + NO COSIGNER → 6089 ErrCosignRequired.
  //    Council ISC-129 interim cosign gate.
  // ─────────────────────────────────────────────────────────────────────────
  it("initiate when cosign_required=true and no cosigner → reject 6089", async () => {
    const { vault, policy, auditSuccess, pendingOwner } = await initVault(
      new BN(9008),
      { cosignRequired: true },
    );
    const newOwner = Keypair.generate();

    let caughtCode: number | null = null;
    try {
      await program.methods
        .initiateOwnershipTransfer(newOwner.publicKey, false)
        .accounts({
          owner: owner.publicKey,
          vault,
          policy,
          pending: pendingOwner,
          auditLogSuccess: auditSuccess,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    } catch (err: any) {
      caughtCode = err?.error?.errorCode?.number ?? null;
    }
    expect(caughtCode, "no-cosigner initiate MUST reject").to.not.be.null;
    expect(caughtCode).to.equal(6089); // ErrCosignRequired
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 10. INITIATE WHEN cosign_required + COSIGNER SIGNS → success.
  //     Pins the legitimate cosign flow on the new ix.
  // ─────────────────────────────────────────────────────────────────────────
  it("initiate when cosign_required=true and cosigner signs → success", async () => {
    const { vault, policy, auditSuccess, pendingOwner } = await initVault(
      new BN(9009),
      { cosignRequired: true },
    );
    const newOwner = Keypair.generate();
    const cosigner = Keypair.generate();
    airdropSol(svm, cosigner.publicKey, 1 * LAMPORTS_PER_SOL);

    await program.methods
      .initiateOwnershipTransfer(newOwner.publicKey, false)
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts([
        { pubkey: cosigner.publicKey, isSigner: true, isWritable: false },
      ])
      .signers([cosigner])
      .rpc();

    const pendingState = await program.account.pendingOwnershipTransfer.fetch(
      pendingOwner,
    );
    expect(pendingState.newOwner.toString()).to.equal(
      newOwner.publicKey.toString(),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 11. EOA ACCEPT REJECTS MULTISIG-TARGETED PENDING.
  //     Pins the Batch 4 boundary: accept_ownership_transfer must NOT be a
  //     back-door for `is_multisig_target == true` pendings.
  // ─────────────────────────────────────────────────────────────────────────
  it("EOA accept rejects is_multisig_target=true pending (Batch 4 boundary)", async () => {
    const { vault, policy, auditSuccess, pendingOwner } = await initVault(
      new BN(9010),
    );
    const newOwner = Keypair.generate();
    airdropSol(svm, newOwner.publicKey, 1 * LAMPORTS_PER_SOL);

    // Queue a multisig-target initiate.
    await program.methods
      .initiateOwnershipTransfer(newOwner.publicKey, true) // is_multisig_target=true
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        pending: pendingOwner,
        auditLogSuccess: auditSuccess,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    advanceTime(svm, DEFAULT_MIN_DELAY);

    let caughtCode: number | null = null;
    try {
      await program.methods
        .acceptOwnershipTransfer()
        .accounts({
          newOwner: newOwner.publicKey,
          vault,
          policy,
          pending: pendingOwner,
          auditLogSuccess: auditSuccess,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([newOwner])
        .rpc();
    } catch (err: any) {
      caughtCode = err?.error?.errorCode?.number ?? null;
    }
    expect(caughtCode, "EOA accept of multisig pending MUST reject").to.not.be
      .null;
    expect(caughtCode).to.equal(6104); // ErrPendingOwnershipNotReady
  });
});
