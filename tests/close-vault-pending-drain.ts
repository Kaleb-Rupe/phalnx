/**
 * CH-2 (Bucket-3 audit 2026-05-23) — close_vault must drain the
 * PendingConstraintsUpdate PDA (seeds: [b"pending_constraints", vault]) when
 * passed in remaining_accounts, mirroring the SFH-01 pattern for
 * pending_owner + pending_agent_grant.
 *
 * Pre-fix:
 *   - close_vault.rs lines 99-231 drained 5 pending PDAs but NOT
 *     pending_constraints.
 *   - An owner with an in-flight constraints UPDATE at close time would
 *     orphan ~0.25 SOL (35,944-byte PDA) — unreclaimable post-close.
 *
 * Scenario exercised:
 *   1. init vault with timelock + create constraints (has_constraints=true)
 *   2. allocate + extend + queue_constraints_update → pending_constraints
 *      PDA exists with lamports
 *   3. queue_close_constraints + advance + apply_close_constraints WITHOUT
 *      the pending_constraints PDA in remaining_accounts. This is the
 *      "orphan path" — apply_close_constraints also drains pending_constraints
 *      if passed, but if the SDK forgot (or the queue happened in a separate
 *      session from the close), the PDA persists.
 *   4. close_vault WITH pending_constraints in remaining_accounts → the new
 *      CH-2 drain block transfers rent to the owner.
 *
 * Assertions:
 *   - pending_constraints PDA no longer exists post-close
 *   - owner balance increases by ≥ rent of all closed PDAs (vault, policy,
 *     tracker, overlay, audit logs, pending_constraints)
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
  createConstraintsAccount,
  queueConstraintsUpdateMultiIx,
  autoSiblingHandlerDigest,
  getBalance,
  TestEnv,
  LiteSVM,
} from "./helpers/litesvm-setup";

describe("close-vault-pending-drain (CH-2 Bucket-3 audit 2026-05-23)", () => {
  let env: TestEnv;
  let svm: LiteSVM;
  let program: Program<Sigil>;
  let owner: anchor.Wallet;

  const feeDestination = Keypair.generate();
  const jupiterProgramId = Keypair.generate().publicKey;

  // Vault id 7300 — isolated from other tests in the LiteSVM suite.
  const vaultId = new BN(7300);
  const TIMELOCK_SECONDS = 1800;

  let vaultPda: PublicKey;
  let policyPda: PublicKey;
  let trackerPda: PublicKey;
  let overlayPda: PublicKey;
  let constraintsPda: PublicKey;
  let pendingConstraintsPda: PublicKey;
  let pendingCloseConstraintsPda: PublicKey;

  before(async () => {
    env = createTestEnv();
    svm = env.svm;
    program = env.program;
    owner = env.provider.wallet;

    airdropSol(svm, owner.publicKey, 100 * LAMPORTS_PER_SOL);
    airdropSol(svm, feeDestination.publicKey, 2 * LAMPORTS_PER_SOL);

    // Some helpers (TA-19 sibling digests) touch the live USDC mint.
    createMintAtAddress(svm, DEVNET_USDC_MINT, owner.publicKey, 6);

    [vaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        owner.publicKey.toBuffer(),
        vaultId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
    [policyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), vaultPda.toBuffer()],
      program.programId,
    );
    [trackerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("tracker"), vaultPda.toBuffer()],
      program.programId,
    );
    [overlayPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_spend"), vaultPda.toBuffer(), Buffer.from([0])],
      program.programId,
    );
    [constraintsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("constraints"), vaultPda.toBuffer()],
      program.programId,
    );
    [pendingConstraintsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending_constraints"), vaultPda.toBuffer()],
      program.programId,
    );
    [pendingCloseConstraintsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending_close_constraints"), vaultPda.toBuffer()],
      program.programId,
    );
  });

  it("close_vault drains pending_constraints rent to owner", async () => {
    // ─── Step 1: init vault with timelock ──────────────────────────────────
    await program.methods
      .initializeVault(
        vaultId,
        new BN(1000),
        new BN(1000),
        1, // protocol_mode ALLOWLIST
        [jupiterProgramId],
        0, // destination_mode RESTRICTED
        100, // max_slippage_bps
        new BN(TIMELOCK_SECONDS), // timelock_duration
        [], // allowed_destinations
        [], // protocol_caps
        false, // observe_only
        0x00ffffff, // operating_hours (24h)
        false, // auto_promote_grays
        5, // auto_revoke_threshold
        new BN(0), // stable_balance_floor
        new BN(0), // per_recipient_daily_cap_usd
        false, // cosignRequired
        initVaultPreviewDigest({
          dailySpendingCapUsd: new BN(1000),
          maxTransactionSizeUsd: new BN(1000),
          maxSlippageBps: 100,
          protocolMode: 1,
          protocols: [jupiterProgramId],
          allowedDestinations: [],
          timelockDuration: new BN(TIMELOCK_SECONDS),
          operatingHours: 0x00ffffff,
          autoPromoteGrays: false,
          autoRevokeThreshold: 5,
        }),
      )
      .accounts({
        owner: owner.publicKey,
        vault: vaultPda,
        policy: policyPda,
        tracker: trackerPda,
        agentSpendOverlay: overlayPda,
        feeDestination: feeDestination.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // ─── Step 2: create constraints PDA (sets has_constraints=true) ────────
    // A5 anchor: first data_constraint MUST be Eq at offset 0 with non-zero
    // discriminator-length value.
    const entries = [
      {
        programId: jupiterProgramId,
        dataConstraints: [
          {
            offset: 0,
            operator: { eq: {} },
            value: Buffer.from([0xaa, 0xbb, 0, 0, 0, 0, 0, 0]),
          },
        ],
        accountConstraints: [],
        discriminatorFormat: { anchor8: {} },
      },
    ];

    createConstraintsAccount(
      program,
      svm,
      (owner as any).payer,
      vaultPda,
      policyPda,
      entries,
    );

    // Verify has_constraints flag is set.
    {
      const policy = await program.account.policyConfig.fetch(policyPda);
      expect(policy.hasConstraints).to.equal(true);
    }

    // ─── Step 3: allocate + queue pending_constraints (creates the PDA) ────
    // Use the same payload as Step 2 — keeps the queue body valid without
    // exercising any extra constraint logic.
    queueConstraintsUpdateMultiIx(
      program,
      svm,
      (owner as any).payer,
      vaultPda,
      policyPda,
      constraintsPda,
      entries,
    );

    // Sanity: the pending_constraints PDA now exists with lamports.
    expect(accountExists(svm, pendingConstraintsPda)).to.equal(
      true,
      "pending_constraints PDA must exist after queue_constraints_update",
    );
    const pendingRentLamports = svm.getBalance(pendingConstraintsPda);
    expect(pendingRentLamports != null && pendingRentLamports > 0n).to.equal(
      true,
      "pending_constraints must hold rent lamports before close",
    );

    // ─── Step 4: queue + apply close_constraints WITHOUT draining pending ──
    // This is the orphan path the CH-2 fix exists to recover from. Apply
    // would normally drain pending_constraints if passed in remaining_accounts;
    // we deliberately omit it so close_vault has work to do.
    await program.methods
      .queueCloseConstraints()
      .accounts({
        owner: owner.publicKey,
        vault: vaultPda,
        policy: policyPda,
        constraints: constraintsPda,
        pendingCloseConstraints: pendingCloseConstraintsPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    advanceTime(svm, TIMELOCK_SECONDS + 1);

    // PEN-CROSS-3: compute the owner-signed digest for has_constraints=false
    // (the about-to-flip flag). All other policy fields read live.
    const closeDigest = autoSiblingHandlerDigest(svm, program, policyPda, vaultPda, {
      hasConstraints: false,
    });

    await program.methods
      .applyCloseConstraints(closeDigest)
      .accounts({
        owner: owner.publicKey,
        vault: vaultPda,
        policy: policyPda,
        constraints: constraintsPda,
        pendingCloseConstraints: pendingCloseConstraintsPda,
      } as any)
      .rpc();

    // Post-apply invariants:
    //   - has_constraints flipped to false
    //   - constraints PDA closed (Anchor `close = owner`)
    //   - pending_constraints PDA STILL EXISTS (the bug this test pins)
    {
      const policy = await program.account.policyConfig.fetch(policyPda);
      expect(policy.hasConstraints).to.equal(false);
    }
    expect(accountExists(svm, constraintsPda)).to.equal(
      false,
      "constraints PDA should be closed by apply_close_constraints",
    );
    expect(accountExists(svm, pendingConstraintsPda)).to.equal(
      true,
      "pending_constraints PDA must still exist (orphan path: caller did " +
        "not pass it to apply_close_constraints)",
    );
    const pendingLamportsBeforeClose = svm.getBalance(pendingConstraintsPda);
    expect(
      pendingLamportsBeforeClose != null && pendingLamportsBeforeClose > 0n,
      "pending_constraints must still hold rent before close_vault",
    ).to.equal(true);

    // ─── Step 5: close_vault WITH pending_constraints in remaining_accounts ─
    const ownerBalanceBefore = getBalance(svm, owner.publicKey);

    await program.methods
      .closeVault()
      .accounts({
        owner: owner.publicKey,
        vault: vaultPda,
        policy: policyPda,
        tracker: trackerPda,
        agentSpendOverlay: overlayPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts([
        {
          pubkey: pendingConstraintsPda,
          isSigner: false,
          isWritable: true,
        },
      ])
      .rpc();

    // ─── Assertions ────────────────────────────────────────────────────────
    // 1. Vault + all named accounts closed.
    expect(accountExists(svm, vaultPda)).to.equal(false, "vault closed");
    expect(accountExists(svm, policyPda)).to.equal(false, "policy closed");
    expect(accountExists(svm, trackerPda)).to.equal(false, "tracker closed");
    expect(accountExists(svm, overlayPda)).to.equal(false, "overlay closed");

    // 2. **Load-bearing assertion**: pending_constraints PDA is gone (drained
    //    by the new CH-2 block in close_vault.rs).
    expect(accountExists(svm, pendingConstraintsPda)).to.equal(
      false,
      "pending_constraints PDA MUST be drained by close_vault (CH-2)",
    );

    // 3. Owner balance increased by at least the pending_constraints rent.
    //    (Vault/policy/tracker/overlay/audit-log rent flows in too, so this
    //    is a lower bound. The exact delta varies with audit-log sizes.)
    const ownerBalanceAfter = getBalance(svm, owner.publicKey);
    const delta = ownerBalanceAfter - ownerBalanceBefore;
    expect(delta).to.be.greaterThan(
      Number(pendingLamportsBeforeClose),
      `owner balance must rise by at least the pending_constraints rent ` +
        `(~${pendingLamportsBeforeClose} lamports) — actual delta ${delta}`,
    );
  });
});
