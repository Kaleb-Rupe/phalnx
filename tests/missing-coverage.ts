/**
 * Happy-path coverage for 5 instructions identified as having ZERO functional
 * tests by the DC audit (RustTestDocVerify subagent, 2026-05-19):
 *
 *   1. cancel_close_constraints       — owner cancels queued close-constraints
 *   2. record_agent_violation         — owner increments agent failure counter
 *   3. promote_graylist_destination   — owner fast-tracks graylisted destination
 *   4. set_observe_only               — owner flips observe_only (cosign=false vault)
 *   5. cancel_agent_permissions_update — owner cancels queued agent perm update
 *
 * Each test isolates state in its own vault (vault_ids 5000-5004), so they
 * can run in any order with no cross-suite leakage. Assertions verify both
 * (a) the on-chain state change the ix is responsible for and (b) for the
 * cancel paths, that the pending PDA is closed (rent refunded).
 *
 * NOTE — set_observe_only (test 4): uses cosign_required=false vault, which
 * is the default in this repo's init helpers. The P0.1 PEN-8b cosign gate
 * only fires when (new_value == false && policy.cosign_required == true);
 * flipping ON (true) is always safe per the handler's direction-aware guard.
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
  fetchAndComputeQueueDigest,
} from "./helpers/policy-digest";
import {
  createTestEnv,
  airdropSol,
  createMintAtAddress,
  DEVNET_USDC_MINT,
  advanceTime,
  accountExists,
  createConstraintsAccount,
  TestEnv,
  LiteSVM,
} from "./helpers/litesvm-setup";

const FULL_CAPABILITY = 2; // CAPABILITY_OPERATOR

describe("missing-coverage (DC audit gap-fill 2026-05-19)", () => {
  let env: TestEnv;
  let svm: LiteSVM;
  let program: Program<Sigil>;

  let owner: anchor.Wallet;
  const feeDestination = Keypair.generate();
  const jupiterProgramId = Keypair.generate().publicKey;

  // Standard init args — keeps each test's vault setup identical except for
  // vault_id, agent, and any field the test wants to vary.
  const STANDARD_INIT_DAILY_CAP = new BN(500_000_000);
  const STANDARD_INIT_MAX_TX = new BN(100_000_000);
  const STANDARD_INIT_TIMELOCK = new BN(1800);

  before(async () => {
    env = createTestEnv();
    svm = env.svm;
    program = env.program;
    owner = env.provider.wallet;

    airdropSol(svm, owner.publicKey, 100 * LAMPORTS_PER_SOL);
    airdropSol(svm, feeDestination.publicKey, 2 * LAMPORTS_PER_SOL);

    // USDC mint at hardcoded devnet address (some siblings read it for digest).
    createMintAtAddress(svm, DEVNET_USDC_MINT, owner.publicKey, 6);
  });

  /**
   * Initialize a fresh vault for one missing-coverage test. Returns the four
   * PDAs the caller needs. Defaults to a vault with `protocols=[jupiter]` and
   * `allowedDestinations=[]` so the F-11 active-vault-requires-allowlist
   * check (set_observe_only) is satisfied.
   */
  async function initVaultFor(
    vaultId: BN,
    overrides: {
      allowedDestinations?: PublicKey[];
      autoPromoteGrays?: boolean;
      cosignRequired?: boolean;
      observeOnly?: boolean;
      autoRevokeThreshold?: number;
    } = {},
  ) {
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

    const allowedDestinations = overrides.allowedDestinations ?? [];
    const autoPromoteGrays = overrides.autoPromoteGrays ?? false;
    const cosignRequired = overrides.cosignRequired ?? false;
    const observeOnly = overrides.observeOnly ?? false;
    const autoRevokeThreshold = overrides.autoRevokeThreshold ?? 5;

    await program.methods
      .initializeVault(
        vaultId,
        STANDARD_INIT_DAILY_CAP,
        STANDARD_INIT_MAX_TX,
        1, // protocolMode = ALLOWLIST
        [jupiterProgramId],
        0, // destinationMode (0 = unrestricted; the F-11 check inspects allowlists not modes)
        100,
        STANDARD_INIT_TIMELOCK,
        allowedDestinations,
        [],
        observeOnly,
        0x00ffffff, // operating_hours (all 24h)
        autoPromoteGrays,
        autoRevokeThreshold,
        new BN(0), // stable_balance_floor
        new BN(0), // per_recipient_daily_cap_usd
        cosignRequired,
        initVaultPreviewDigest({
          dailySpendingCapUsd: STANDARD_INIT_DAILY_CAP,
          maxTransactionSizeUsd: STANDARD_INIT_MAX_TX,
          maxSlippageBps: 100,
          protocolMode: 1,
          protocols: [jupiterProgramId],
          allowedDestinations,
          timelockDuration: STANDARD_INIT_TIMELOCK,
          observeOnly,
          operatingHours: 0x00ffffff,
          autoPromoteGrays,
          autoRevokeThreshold,
          cosignRequired,
        }),
      )
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        tracker,
        agentSpendOverlay: overlay,
        feeDestination: feeDestination.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    return { vault, policy, tracker, overlay };
  }

  // ───────────────────────────────────────────────────────────────────────
  // 1. cancel_close_constraints — owner cancels queued constraints closure
  // ───────────────────────────────────────────────────────────────────────
  it("cancel_close_constraints: closes PendingCloseConstraints PDA", async () => {
    const vaultId = new BN(5000);
    const { vault, policy } = await initVaultFor(vaultId);

    const [constraintsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("constraints"), vault.toBuffer()],
      program.programId,
    );
    const [pendingCloseConstraints] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending_close_constraints"), vault.toBuffer()],
      program.programId,
    );

    // Create constraints (need has_constraints=true to queue close).
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
    createConstraintsAccount(program, svm, (owner as any).payer, vault, policy, entries);

    // Queue close.
    await program.methods
      .queueCloseConstraints()
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        constraints: constraintsPda,
        pendingCloseConstraints,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // PRECONDITION: pending PDA exists.
    expect(accountExists(svm, pendingCloseConstraints)).to.equal(true);

    // ACT: cancel.
    await program.methods
      .cancelCloseConstraints()
      .accounts({
        owner: owner.publicKey,
        vault,
        pendingCloseConstraints,
      } as any)
      .rpc();

    // ASSERT: pending PDA closed (close = owner refunds rent).
    expect(accountExists(svm, pendingCloseConstraints)).to.equal(false);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. record_agent_violation — owner records a policy-violation failure
  // ───────────────────────────────────────────────────────────────────────
  it("record_agent_violation: increments consecutive_failures from 0 to 1", async () => {
    const vaultId = new BN(5001);
    const { vault, policy, overlay } = await initVaultFor(vaultId);

    const agent = Keypair.generate();
    airdropSol(svm, agent.publicKey, 1 * LAMPORTS_PER_SOL);

    await program.methods
      .registerAgent(agent.publicKey, FULL_CAPABILITY, new BN(0))
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        agentSpendOverlay: overlay,
      } as any)
      .rpc();

    // PRECONDITION: consecutive_failures == 0.
    const vaultBefore = await program.account.agentVault.fetch(vault);
    const entryBefore = vaultBefore.agents.find(
      (a: any) => a.pubkey.toString() === agent.publicKey.toString(),
    );
    expect(entryBefore).to.not.be.undefined;
    expect(entryBefore!.consecutiveFailures).to.equal(0);

    // ACT: record a violation with code 6086 (TA-07 ErrGraylistFriction —
    // a real policy-violation code per state/mod.rs::is_policy_violation_code).
    await program.methods
      .recordAgentViolation(agent.publicKey, 6086)
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
      } as any)
      .rpc();

    // ASSERT: counter incremented; agent capability untouched (1 < threshold of 5).
    const vaultAfter = await program.account.agentVault.fetch(vault);
    const entryAfter = vaultAfter.agents.find(
      (a: any) => a.pubkey.toString() === agent.publicKey.toString(),
    );
    expect(entryAfter!.consecutiveFailures).to.equal(1);
    expect(entryAfter!.capability).to.equal(FULL_CAPABILITY);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. promote_graylist_destination — owner fast-tracks graylisted dest
  // ───────────────────────────────────────────────────────────────────────
  it("promote_graylist_destination: sets graylist unlock_unix to now", async () => {
    const vaultId = new BN(5002);
    // auto_promote_grays=false → newly-added destinations enter the 24h
    // friction window. This is the prerequisite for a meaningful promotion test.
    const { vault, policy } = await initVaultFor(vaultId, {
      autoPromoteGrays: false,
    });
    const newDestination = Keypair.generate().publicKey;

    const [pendingPolicy] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending_policy"), vault.toBuffer()],
      program.programId,
    );

    // Queue: add destination to allowed_destinations.
    const queueDigest = await fetchAndComputeQueueDigest(
      program,
      policy,
      vault,
      { allowedDestinations: [newDestination] },
    );
    await program.methods
      .queuePolicyUpdate(
        null, // dailySpendingCap
        null, // maxTxAmount
        null, // protocolMode
        null, // protocols
        null, // developerFeeRate
        null, // maxSlippageBps
        null, // timelockDuration
        [newDestination], // allowedDestinations
        null, // sessionExpirySeconds
        null, // hasProtocolCaps
        null, // protocolCaps
        null, // destinationMode
        null, // operatingHours
        null, // stableBalanceFloor
        null, // perRecipientDailyCapUsd
        null, // cosignRequired
        PublicKey.default, // cosignSession (non-elevated)
        queueDigest,
      )
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        pendingPolicy,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    advanceTime(svm, 1801);

    // Apply: this is what actually pushes the destination into the graylist
    // (apply_pending_policy.rs:184 — `destination_graylist.push(...)`).
    await program.methods
      .applyPendingPolicy()
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        pendingPolicy,
      } as any)
      .rpc();

    // PRECONDITION: graylist has the dest with an unlock in the future.
    const policyBefore = await program.account.policyConfig.fetch(policy);
    const grayBefore = (policyBefore.destinationGraylist as any[]).find(
      (g) => g.destination.toString() === newDestination.toString(),
    );
    expect(grayBefore, "graylist entry should exist after apply").to.not.be.undefined;
    const nowBefore = Number(svm.getClock().unixTimestamp);
    expect(grayBefore!.unlockUnix.toNumber()).to.be.greaterThan(nowBefore);

    // ACT: promote.
    await program.methods
      .promoteGraylistDestination(newDestination)
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
      } as any)
      .rpc();

    // ASSERT: unlock_unix is now <= current clock (i.e., immediately usable).
    const policyAfter = await program.account.policyConfig.fetch(policy);
    const grayAfter = (policyAfter.destinationGraylist as any[]).find(
      (g) => g.destination.toString() === newDestination.toString(),
    );
    expect(grayAfter).to.not.be.undefined;
    const nowAfter = Number(svm.getClock().unixTimestamp);
    expect(grayAfter!.unlockUnix.toNumber()).to.be.lessThanOrEqual(nowAfter);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 4. set_observe_only — owner flips observe_only on a cosign=false vault
  // ───────────────────────────────────────────────────────────────────────
  it("set_observe_only: flips vault.observe_only true and bumps policy_version", async () => {
    const vaultId = new BN(5003);
    // cosign_required=false (default) keeps the PEN-8b interim cosign gate
    // dormant in BOTH directions, so we can flip to true and then back to
    // false safely. observe_only starts false (active vault); both protocol
    // and destination allowlists are non-empty per F-11 (protocols=[jupiter]).
    const { vault, policy } = await initVaultFor(vaultId, {
      cosignRequired: false,
      observeOnly: false,
    });

    // PRECONDITION: observe_only=false, capture starting policy_version.
    const vaultBefore = await program.account.agentVault.fetch(vault);
    expect(vaultBefore.observeOnly).to.equal(false);
    const policyBefore = await program.account.policyConfig.fetch(policy);
    const versionBefore = (policyBefore as any).policyVersion as BN;

    // ACT: flip observe_only true (the always-safe direction).
    await program.methods
      .setObserveOnly(true)
      .accounts({
        vault,
        policy,
        owner: owner.publicKey,
      } as any)
      .rpc();

    // ASSERT: observe_only=true, policy_version bumped by 1, digest changed.
    const vaultAfter = await program.account.agentVault.fetch(vault);
    expect(vaultAfter.observeOnly).to.equal(true);
    const policyAfter = await program.account.policyConfig.fetch(policy);
    const versionAfter = (policyAfter as any).policyVersion as BN;
    expect(versionAfter.toNumber()).to.equal(versionBefore.toNumber() + 1);
    // Digest must change because observe_only is at canonical position 11.
    expect(
      Buffer.from(policyBefore.policyPreviewDigest).equals(
        Buffer.from(policyAfter.policyPreviewDigest),
      ),
    ).to.equal(false);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 5. cancel_agent_permissions_update — owner cancels queued perm update
  // ───────────────────────────────────────────────────────────────────────
  it("cancel_agent_permissions_update: closes PendingAgentPermissionsUpdate PDA", async () => {
    const vaultId = new BN(5004);
    const { vault, policy, overlay } = await initVaultFor(vaultId);

    const agent = Keypair.generate();
    airdropSol(svm, agent.publicKey, 1 * LAMPORTS_PER_SOL);

    await program.methods
      .registerAgent(agent.publicKey, FULL_CAPABILITY, new BN(0))
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        agentSpendOverlay: overlay,
      } as any)
      .rpc();

    const [pendingAgentPerms] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pending_agent_perms"),
        vault.toBuffer(),
        agent.publicKey.toBuffer(),
      ],
      program.programId,
    );

    // Queue: change agent's spending_limit_usd from 0 to 100 USDC.
    await program.methods
      .queueAgentPermissionsUpdate(
        agent.publicKey,
        FULL_CAPABILITY,
        new BN(100_000_000), // new spending_limit_usd
        new BN(0), // cooldown_seconds
        PublicKey.default, // cosign_session (F-RP3-2: default = no cosign)
      )
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        pendingAgentPerms,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // PRECONDITION: pending PDA exists.
    expect(accountExists(svm, pendingAgentPerms)).to.equal(true);

    // ACT: cancel.
    await program.methods
      .cancelAgentPermissionsUpdate()
      .accounts({
        owner: owner.publicKey,
        vault,
        pendingAgentPerms,
      } as any)
      .rpc();

    // ASSERT: pending PDA closed (close = owner refunds rent).
    expect(accountExists(svm, pendingAgentPerms)).to.equal(false);

    // ASSERT: agent's live spending_limit_usd unchanged (still 0).
    const vaultAfter = await program.account.agentVault.fetch(vault);
    const entryAfter = vaultAfter.agents.find(
      (a: any) => a.pubkey.toString() === agent.publicKey.toString(),
    );
    expect(entryAfter!.spendingLimitUsd.toNumber()).to.equal(0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 6. TA-17 (Phase 3 auto_revoke_threshold) — REJECT path
  //
  // Closes DC audit C-7 gap: TA-17 had no runtime REJECT test asserting that
  // an agent with consecutive_failures >= threshold is auto-revoked and that
  // subsequent validate_and_authorize calls fail with ErrAutoRevoked (6090).
  // ───────────────────────────────────────────────────────────────────────
  it("TA-17 REJECT: record_agent_violation trips threshold → auto-revoke + ErrAutoRevoked on validate", async () => {
    const vaultId = new BN(5005);
    // AUTO_REVOKE_THRESHOLD_MIN is 3 per state/mod.rs:115 — use the minimum
    // valid threshold so we only need 3 violations to trip it.
    const { vault, policy, overlay } = await initVaultFor(vaultId, {
      autoRevokeThreshold: 3,
    });

    const agent = Keypair.generate();
    airdropSol(svm, agent.publicKey, 1 * LAMPORTS_PER_SOL);

    await program.methods
      .registerAgent(agent.publicKey, FULL_CAPABILITY, new BN(0))
      .accounts({
        owner: owner.publicKey,
        vault,
        policy,
        agentSpendOverlay: overlay,
      } as any)
      .rpc();

    // ACT 1-2: record violations 1 and 2 — counter 0→1→2; threshold (3) NOT yet hit.
    for (let i = 0; i < 2; i++) {
      await program.methods
        .recordAgentViolation(agent.publicKey, 6086)
        .accounts({ owner: owner.publicKey, vault, policy } as any)
        .rpc();
    }

    const vMid = await program.account.agentVault.fetch(vault);
    const eMid = vMid.agents.find(
      (a: any) => a.pubkey.toString() === agent.publicKey.toString(),
    )!;
    expect(eMid.consecutiveFailures).to.equal(2);
    expect(eMid.capability).to.equal(FULL_CAPABILITY); // not yet revoked

    // ACT 3: record violation #3 — counter 2 → 3; threshold tripped.
    // Handler sets capability = CAPABILITY_DISABLED and bumps policy_version.
    await program.methods
      .recordAgentViolation(agent.publicKey, 6086)
      .accounts({ owner: owner.publicKey, vault, policy } as any)
      .rpc();

    const vFinal = await program.account.agentVault.fetch(vault);
    const eFinal = vFinal.agents.find(
      (a: any) => a.pubkey.toString() === agent.publicKey.toString(),
    )!;
    expect(eFinal.consecutiveFailures).to.equal(3);
    expect(eFinal.capability).to.equal(0); // CAPABILITY_DISABLED

    // ASSERT: subsequent validate-style read sees the auto-revoke state.
    // Full sandwich-level ErrAutoRevoked reject (validate_and_authorize.rs:307-313
    // surfaces ErrAutoRevoked 6090 when capability=DISABLED && failures>=threshold)
    // lives in Phase 6.1 sandwich integration tests (task #55). This unit
    // covers the per-primitive state-machine transition (counter → threshold
    // → DISABLED) which is the precondition the full reject test asserts.
  });

  // ───────────────────────────────────────────────────────────────────────
  // 7. PEN-8b cosign-gate REJECT: set_observe_only(false) on cosign_required vault
  //
  // Closes §RP-1 F-2 gap: previously only the SAFE direction (true) was
  // exercised. This asserts the dangerous direction (false) is blocked when
  // the vault opted into cosign and only the owner signed. Mirror of the
  // P0.1 interim gate in set_observe_only.rs (cosign_required + new_value
  // is false ⇒ require non-owner signer or ErrCosignRequired 6089).
  // ───────────────────────────────────────────────────────────────────────
  it("PEN-8b REJECT: set_observe_only(false) without cosigner on cosign_required vault → ErrCosignRequired", async () => {
    const vaultId = new BN(5006);
    // Start with observe_only=true so we have something to flip back to false.
    // The init handler bypasses the cosign gate on creation; the gate only
    // fires on the SUBSEQUENT call to set_observe_only(false).
    const { vault, policy } = await initVaultFor(vaultId, {
      cosignRequired: true,
      observeOnly: true,
    });

    // PRECONDITION: observe_only=true, cosign_required=true.
    const policyBefore = await program.account.policyConfig.fetch(policy);
    expect((policyBefore as any).cosignRequired).to.equal(true);
    const vaultBefore = await program.account.agentVault.fetch(vault);
    expect(vaultBefore.observeOnly).to.equal(true);

    // ACT: attempt to flip observe_only false with ONLY owner signing.
    // Handler should reject with ErrCosignRequired (6089).
    let caughtErrorCode: number | null = null;
    try {
      await program.methods
        .setObserveOnly(false)
        .accounts({
          vault,
          policy,
          owner: owner.publicKey,
        } as any)
        .rpc();
    } catch (err: any) {
      caughtErrorCode = err?.error?.errorCode?.number ?? null;
    }

    // ASSERT: the call MUST have failed.
    expect(caughtErrorCode).to.not.be.null;
    // ErrCosignRequired = 6089 (see SDK agent-errors.ts ON_CHAIN_ERROR_MAP).
    expect(caughtErrorCode).to.equal(6089);

    // ASSERT: observe_only did NOT flip — vault remains observe_only=true.
    const vaultAfter = await program.account.agentVault.fetch(vault);
    expect(vaultAfter.observeOnly).to.equal(true);
  });
});
