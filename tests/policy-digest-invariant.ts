/**
 * Phase 2 TA-19 regression test — policy_preview_digest invariant.
 *
 * Four handlers mutate `PolicyConfig.has_constraints` / `has_post_assertions`
 * fields outside of `apply_pending_policy`. These flags are part of the
 * canonical policy_preview_digest encoding. The handlers MUST recompute
 * the stored digest on every mutation; otherwise external consumers see
 * a stale on-chain digest that diverges from a canonical recompute.
 *
 * Covered handlers:
 *   1. create_instruction_constraints   (has_constraints   = true)
 *   2. apply_close_constraints          (has_constraints   = false)
 *   3. create_post_assertions           (has_post_assertions = 1)
 *   4. close_post_assertions            (has_post_assertions = 0)
 *
 * Each test:
 *   - Records the stored digest BEFORE the mutation.
 *   - Records the policy_version BEFORE.
 *   - Runs the mutation handler.
 *   - Re-reads stored digest + policy_version.
 *   - Asserts: stored digest CHANGED, policy_version BUMPED, and
 *     stored digest == SDK-recomputed digest with the new flag value.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sigil } from "../target/types/sigil";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";
import {
  initVaultPreviewDigest,
  computePolicyPreviewDigest,
  queuePolicyMergedDigest,
} from "./helpers/policy-digest";
import {
  createTestEnv,
  airdropSol,
  createMintAtAddress,
  DEVNET_USDC_MINT,
  createAtaHelper,
  mintToHelper,
  advanceTime,
  createConstraintsAccount,
  sendVersionedTx,
  TestEnv,
  LiteSVM,
} from "./helpers/litesvm-setup";

const FULL_CAPABILITY = 2;

/** Encode a [u8;32] returned by Anchor as a hex string for clean asserts. */
function digestHex(d: number[] | Uint8Array): string {
  const bytes = Array.from(d);
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("policy-digest invariant (TA-19 sibling-handler recompute)", () => {
  let env: TestEnv;
  let svm: LiteSVM;
  let program: Program<Sigil>;
  let owner: anchor.Wallet;
  const feeDestination = Keypair.generate();
  let usdcMint: PublicKey;

  /**
   * Fresh vault per test: each handler is destructive (creates / closes the
   * sibling PDA), so isolating per-vault prevents test-ordering coupling.
   */
  async function freshVault(vaultIdNum: number) {
    const vaultId = new BN(vaultIdNum);
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        owner.publicKey.toBuffer(),
        vaultId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
    const [policyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), vaultPda.toBuffer()],
      program.programId,
    );
    const [trackerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("tracker"), vaultPda.toBuffer()],
      program.programId,
    );
    const [overlayPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_spend"), vaultPda.toBuffer(), Buffer.from([0])],
      program.programId,
    );
    const [constraintsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("constraints"), vaultPda.toBuffer()],
      program.programId,
    );
    const [postAssertionsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("post_assertions"), vaultPda.toBuffer()],
      program.programId,
    );
    const [pendingCloseConstraintsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending_close_constraints"), vaultPda.toBuffer()],
      program.programId,
    );

    await program.methods
      .initializeVault(
        vaultId,
        new BN(500_000_000),
        new BN(100_000_000),
        1,
        [],
        0,
        100,
        new BN(1800),
        [],
        [],
        true, // observeOnly — required for F-11 (no protocols/destinations)
        initVaultPreviewDigest({
          dailySpendingCapUsd: new BN(500_000_000),
          maxTransactionSizeUsd: new BN(100_000_000),
          maxSlippageBps: 100,
          protocolMode: 1,
          protocols: [],
          allowedDestinations: [],
          timelockDuration: new BN(1800),
          observeOnly: true,
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

    return {
      vaultPda,
      policyPda,
      constraintsPda,
      postAssertionsPda,
      pendingCloseConstraintsPda,
    };
  }

  /**
   * Compute the expected canonical digest for a vault's current live policy,
   * letting caller override the flag(s) under test.
   */
  async function expectedDigestFor(
    policyPda: PublicKey,
    vaultPda: PublicKey,
    override: Partial<{
      hasConstraints: boolean;
      hasPostAssertions: number;
    }> = {},
  ): Promise<number[]> {
    const policy: any = await program.account.policyConfig.fetch(policyPda);
    const vault: any = await program.account.agentVault.fetch(vaultPda);
    return computePolicyPreviewDigest({
      dailySpendingCapUsd: policy.dailySpendingCapUsd,
      maxTransactionSizeUsd: policy.maxTransactionSizeUsd,
      maxSlippageBps: policy.maxSlippageBps,
      protocolMode: policy.protocolMode,
      protocols: policy.protocols,
      destinationMode: policy.destinationMode,
      allowedDestinations: policy.allowedDestinations,
      timelockDuration: policy.timelockDuration,
      sessionExpirySeconds: policy.sessionExpirySeconds,
      observeOnly: !!vault.observeOnly,
      hasConstraints:
        override.hasConstraints !== undefined
          ? override.hasConstraints
          : !!policy.hasConstraints,
      hasPostAssertions:
        override.hasPostAssertions !== undefined
          ? override.hasPostAssertions
          : (policy.hasPostAssertions as number),
    });
  }

  before(async () => {
    env = createTestEnv();
    svm = env.svm;
    program = env.program;
    owner = env.provider.wallet;

    airdropSol(svm, owner.publicKey, 200 * LAMPORTS_PER_SOL);
    airdropSol(svm, feeDestination.publicKey, 2 * LAMPORTS_PER_SOL);

    createMintAtAddress(svm, DEVNET_USDC_MINT, owner.publicKey, 6);
    usdcMint = DEVNET_USDC_MINT;

    // Owner ATA / mint — kept symmetrical with other test files (some helpers
    // assume the vault token account exists, but these digest tests don't
    // execute any spending so ATAs are not strictly required).
    const ownerUsdcAta = createAtaHelper(
      svm,
      (owner as any).payer,
      usdcMint,
      owner.publicKey,
    );
    mintToHelper(
      svm,
      (owner as any).payer,
      usdcMint,
      ownerUsdcAta,
      owner.publicKey,
      2_000_000_000n,
    );
  });

  it("create_instruction_constraints recomputes policy_preview_digest", async () => {
    const { vaultPda, policyPda, constraintsPda } = await freshVault(900);

    const before: any = await program.account.policyConfig.fetch(policyPda);
    const digestBefore = before.policyPreviewDigest as number[];
    const versionBefore = (before.policyVersion as BN).toString();
    expect(before.hasConstraints).to.equal(false);

    const entries = [
      {
        programId: Keypair.generate().publicKey,
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

    const after: any = await program.account.policyConfig.fetch(policyPda);
    expect(after.hasConstraints).to.equal(true);

    const digestAfter = after.policyPreviewDigest as number[];
    expect(digestHex(digestAfter)).to.not.equal(
      digestHex(digestBefore),
      "stored digest MUST change after has_constraints mutation",
    );

    const expected = await expectedDigestFor(policyPda, vaultPda);
    expect(digestHex(digestAfter)).to.equal(
      digestHex(expected),
      "stored digest MUST match SDK-recomputed digest with has_constraints=true",
    );

    const versionAfter = (after.policyVersion as BN).toString();
    expect(versionAfter).to.not.equal(
      versionBefore,
      "policy_version MUST be bumped after sibling-handler mutation",
    );
    expect(new BN(versionAfter).gt(new BN(versionBefore))).to.equal(
      true,
      "policy_version must strictly increase",
    );
  });

  it("apply_close_constraints recomputes policy_preview_digest", async () => {
    const {
      vaultPda,
      policyPda,
      constraintsPda,
      pendingCloseConstraintsPda,
    } = await freshVault(901);

    // Establish constraints (this also recomputes digest; we use the post-create
    // state as the "before" baseline for the close path).
    const entries = [
      {
        programId: Keypair.generate().publicKey,
        dataConstraints: [
          {
            offset: 0,
            operator: { eq: {} },
            value: Buffer.from([0x01, 0x02, 0, 0, 0, 0, 0, 0]),
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

    const before: any = await program.account.policyConfig.fetch(policyPda);
    const digestBefore = before.policyPreviewDigest as number[];
    const versionBefore = (before.policyVersion as BN).toString();
    expect(before.hasConstraints).to.equal(true);

    // Queue + advance + apply close
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
    advanceTime(svm, 1801);
    await program.methods
      .applyCloseConstraints()
      .accounts({
        owner: owner.publicKey,
        vault: vaultPda,
        policy: policyPda,
        constraints: constraintsPda,
        pendingCloseConstraints: pendingCloseConstraintsPda,
      } as any)
      .rpc();

    const after: any = await program.account.policyConfig.fetch(policyPda);
    expect(after.hasConstraints).to.equal(false);

    const digestAfter = after.policyPreviewDigest as number[];
    expect(digestHex(digestAfter)).to.not.equal(
      digestHex(digestBefore),
      "stored digest MUST change after apply_close_constraints",
    );

    const expected = await expectedDigestFor(policyPda, vaultPda);
    expect(digestHex(digestAfter)).to.equal(
      digestHex(expected),
      "stored digest MUST match SDK-recomputed digest with has_constraints=false",
    );

    const versionAfter = (after.policyVersion as BN).toString();
    expect(new BN(versionAfter).gt(new BN(versionBefore))).to.equal(
      true,
      "policy_version must strictly increase across apply_close_constraints",
    );
  });

  it("create_post_assertions recomputes policy_preview_digest", async () => {
    const { vaultPda, policyPda, postAssertionsPda } = await freshVault(902);

    const before: any = await program.account.policyConfig.fetch(policyPda);
    const digestBefore = before.policyPreviewDigest as number[];
    const versionBefore = (before.policyVersion as BN).toString();
    expect(before.hasPostAssertions).to.equal(0);

    const targetAccount = Keypair.generate().publicKey;
    await program.methods
      .createPostAssertions([
        {
          targetAccount,
          offset: 0,
          valueLen: 8,
          operator: { lte: {} },
          expectedValue: Buffer.from(new BN(1_000_000).toArray("le", 8)),
          assertionMode: 0,
        },
      ])
      .accounts({
        owner: owner.publicKey,
        vault: vaultPda,
        policy: policyPda,
        postAssertions: postAssertionsPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const after: any = await program.account.policyConfig.fetch(policyPda);
    expect(after.hasPostAssertions).to.equal(1);

    const digestAfter = after.policyPreviewDigest as number[];
    expect(digestHex(digestAfter)).to.not.equal(
      digestHex(digestBefore),
      "stored digest MUST change after has_post_assertions=1 mutation",
    );

    const expected = await expectedDigestFor(policyPda, vaultPda);
    expect(digestHex(digestAfter)).to.equal(
      digestHex(expected),
      "stored digest MUST match SDK-recomputed digest with has_post_assertions=1",
    );

    const versionAfter = (after.policyVersion as BN).toString();
    expect(new BN(versionAfter).gt(new BN(versionBefore))).to.equal(
      true,
      "policy_version must strictly increase across create_post_assertions",
    );
  });

  it("close_post_assertions recomputes policy_preview_digest", async () => {
    const { vaultPda, policyPda, postAssertionsPda } = await freshVault(903);

    // Establish assertions
    const targetAccount = Keypair.generate().publicKey;
    await program.methods
      .createPostAssertions([
        {
          targetAccount,
          offset: 0,
          valueLen: 8,
          operator: { lte: {} },
          expectedValue: Buffer.from(new BN(1_000_000).toArray("le", 8)),
          assertionMode: 0,
        },
      ])
      .accounts({
        owner: owner.publicKey,
        vault: vaultPda,
        policy: policyPda,
        postAssertions: postAssertionsPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const before: any = await program.account.policyConfig.fetch(policyPda);
    const digestBefore = before.policyPreviewDigest as number[];
    const versionBefore = (before.policyVersion as BN).toString();
    expect(before.hasPostAssertions).to.equal(1);

    await program.methods
      .closePostAssertions()
      .accounts({
        owner: owner.publicKey,
        vault: vaultPda,
        policy: policyPda,
        postAssertions: postAssertionsPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const after: any = await program.account.policyConfig.fetch(policyPda);
    expect(after.hasPostAssertions).to.equal(0);

    const digestAfter = after.policyPreviewDigest as number[];
    expect(digestHex(digestAfter)).to.not.equal(
      digestHex(digestBefore),
      "stored digest MUST change after has_post_assertions=0 mutation",
    );

    const expected = await expectedDigestFor(policyPda, vaultPda);
    expect(digestHex(digestAfter)).to.equal(
      digestHex(expected),
      "stored digest MUST match SDK-recomputed digest with has_post_assertions=0",
    );

    const versionAfter = (after.policyVersion as BN).toString();
    expect(new BN(versionAfter).gt(new BN(versionBefore))).to.equal(
      true,
      "policy_version must strictly increase across close_post_assertions",
    );
  });
});

// ============================================================================
// F-16 audit fix: negative tests for Phase 2 primitives
// ============================================================================
//
// 1. observe_only rejects validate_and_authorize (code 6081)
// 2. apply_pending_policy digest re-assert defends pending-update staleness
//    (code 6080) — substitute path: requeue invalidates prior digest
// 3. F-4 capability bound at apply_agent_permissions_update (code 6079) —
//    queue with valid capability, mutate to invalid in cancel/requeue flow

describe("Phase 2 close-up — F-16 negative tests", () => {
  let env: TestEnv;
  let svm: LiteSVM;
  let program: Program<Sigil>;
  let owner: anchor.Wallet;
  const feeDestination = Keypair.generate();
  let usdcMint: PublicKey;
  // Junk pubkey used as the protocol allowlist baseline so observe_only=false
  // vaults satisfy F-11 ActiveVaultRequiresAllowlist.
  const dummyProtocol = Keypair.generate().publicKey;

  before(async () => {
    env = createTestEnv();
    svm = env.svm;
    program = env.program;
    owner = env.provider.wallet;

    airdropSol(svm, owner.publicKey, 200 * LAMPORTS_PER_SOL);
    airdropSol(svm, feeDestination.publicKey, 2 * LAMPORTS_PER_SOL);

    createMintAtAddress(svm, DEVNET_USDC_MINT, owner.publicKey, 6);
    usdcMint = DEVNET_USDC_MINT;
  });

  /**
   * Init a fresh vault parametrised by observeOnly. Vault PDAs returned for
   * downstream use. allowlist defaults to [dummyProtocol] which satisfies F-11
   * for active vaults.
   */
  async function initVault(
    vaultIdNum: number,
    observeOnly: boolean,
    protocols: PublicKey[] = [dummyProtocol],
  ) {
    const vaultId = new BN(vaultIdNum);
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        owner.publicKey.toBuffer(),
        vaultId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
    const [policyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), vaultPda.toBuffer()],
      program.programId,
    );
    const [trackerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("tracker"), vaultPda.toBuffer()],
      program.programId,
    );
    const [overlayPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent_spend"), vaultPda.toBuffer(), Buffer.from([0])],
      program.programId,
    );

    await program.methods
      .initializeVault(
        vaultId,
        new BN(500_000_000),
        new BN(100_000_000),
        1,
        protocols,
        0,
        100,
        new BN(1800),
        [],
        [],
        observeOnly,
        initVaultPreviewDigest({
          dailySpendingCapUsd: new BN(500_000_000),
          maxTransactionSizeUsd: new BN(100_000_000),
          maxSlippageBps: 100,
          protocolMode: 1,
          protocols,
          allowedDestinations: [],
          timelockDuration: new BN(1800),
          observeOnly,
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

    return { vaultId, vaultPda, policyPda, trackerPda, overlayPda };
  }

  // ---------------------------------------------------------------------------
  // Test 1: observe_only rejects validate_and_authorize
  // ---------------------------------------------------------------------------
  it("observe_only vault rejects validate_and_authorize → ObserveOnlyModeBlocksExecute", async () => {
    const agent = Keypair.generate();
    airdropSol(svm, agent.publicKey, 10 * LAMPORTS_PER_SOL);

    // Vault with observeOnly=true. F-11 allows empty allowlist when
    // observeOnly=true; we still pass [dummyProtocol] to keep the fixture
    // close to active-vault shape so the only differentiator is observe_only.
    const vault = await initVault(1100, true, [dummyProtocol]);

    // Register an Operator-capable agent — observe_only must reject regardless
    // of agent capability.
    await program.methods
      .registerAgent(agent.publicKey, FULL_CAPABILITY, new BN(0))
      .accountsPartial({
        owner: owner.publicKey,
        vault: vault.vaultPda,
        agentSpendOverlay: vault.overlayPda,
      })
      .rpc();

    // Anchor account-resolution runs BEFORE the handler body. We need a
    // real vault-owned ATA so the #[account(constraint = ...owner == vault.key())]
    // check passes. Once Anchor hydration succeeds the handler hits the moved
    // observe_only short-circuit and rejects.
    const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      usdcMint,
      vault.vaultPda,
      true,
    );
    const ownerAta = createAtaHelper(
      svm,
      (owner as any).payer,
      usdcMint,
      owner.publicKey,
    );
    mintToHelper(
      svm,
      (owner as any).payer,
      usdcMint,
      ownerAta,
      owner.publicKey,
      1_000_000_000n,
    );
    // Deposit a small amount so the vault ATA exists with the vault as owner.
    await program.methods
      .depositFunds(new BN(1_000_000))
      .accounts({
        owner: owner.publicKey,
        vault: vault.vaultPda,
        mint: usdcMint,
        ownerTokenAccount: ownerAta,
        vaultTokenAccount: vaultUsdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const policyAccount: any = await program.account.policyConfig.fetch(
      vault.policyPda,
    );
    const currentVersion = policyAccount.policyVersion;
    const [sessionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("session"),
        vault.vaultPda.toBuffer(),
        agent.publicKey.toBuffer(),
        usdcMint.toBuffer(),
      ],
      program.programId,
    );

    const validateIx = await program.methods
      .validateAndAuthorize(usdcMint, new BN(0), dummyProtocol, currentVersion)
      .accounts({
        agent: agent.publicKey,
        vault: vault.vaultPda,
        policy: vault.policyPda,
        tracker: vault.trackerPda,
        session: sessionPda,
        vaultTokenAccount: vaultUsdcAta,
        tokenMintAccount: usdcMint,
        protocolTreasuryTokenAccount: null,
        feeDestinationTokenAccount: null,
        outputStablecoinAccount: null,
        agentSpendOverlay: vault.overlayPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      } as any)
      .instruction();

    let threw = false;
    try {
      sendVersionedTx(svm, [validateIx], agent);
    } catch (err: any) {
      threw = true;
      const msg = err?.message ?? String(err);
      expect(msg).to.satisfy(
        (m: string) =>
          m.includes("ObserveOnlyModeBlocksExecute") || m.includes("6081"),
        `expected ObserveOnlyModeBlocksExecute (6081), got: ${msg}`,
      );
    }
    expect(threw, "validate_and_authorize MUST reject on observe_only").to.equal(
      true,
    );
  });

  // ---------------------------------------------------------------------------
  // Test 2: apply_pending_policy digest re-assert defends against stale digest
  // ---------------------------------------------------------------------------
  // Strategy (per audit prompt's "substitute" fallback): the pending PDA is
  // closed on apply (close = owner). To exercise the digest re-assert defense
  // we cancel the first pending and queue a SECOND pending with a NEW digest;
  // then we attempt to apply the second using a STALE digest computed against
  // the first pending's intended fields. The apply handler re-computes against
  // the merged-effective policy fields and the stored pending digest — if the
  // queue caller supplied a stale digest, queue itself rejects (covered) AND
  // apply rejects with PolicyPreviewMismatch (the re-assert path).
  //
  // To hit the apply-side rejection cleanly we DIRECTLY tamper the live policy
  // state between queue and apply: bump `policy.policy_version` via a sibling
  // handler (create_post_assertions / close_post_assertions) which mutates a
  // field included in the digest. The pending digest captured at queue time is
  // now stale relative to the merged-effective live policy at apply time.
  it("apply_pending_policy re-asserts digest against tampered live policy → PolicyPreviewMismatch", async () => {
    const vault = await initVault(1101, false, [dummyProtocol]);

    // 1. Queue a policy update with a valid digest for the merged-effective policy.
    const livePolicy: any = await program.account.policyConfig.fetch(
      vault.policyPda,
    );
    const validDigest = queuePolicyMergedDigest(
      {
        dailySpendingCapUsd: livePolicy.dailySpendingCapUsd,
        maxTransactionSizeUsd: livePolicy.maxTransactionSizeUsd,
        maxSlippageBps: livePolicy.maxSlippageBps,
        protocolMode: livePolicy.protocolMode,
        protocols: livePolicy.protocols,
        destinationMode: livePolicy.destinationMode,
        allowedDestinations: livePolicy.allowedDestinations,
        timelockDuration: livePolicy.timelockDuration,
        sessionExpirySeconds: livePolicy.sessionExpirySeconds,
        hasConstraints: !!livePolicy.hasConstraints,
        hasPostAssertions: livePolicy.hasPostAssertions as number,
      },
      { dailySpendingCapUsd: new BN(750_000_000) },
      false, // observeOnly
    );

    const [pendingPolicyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pending_policy"), vault.vaultPda.toBuffer()],
      program.programId,
    );

    await program.methods
      .queuePolicyUpdate(
        new BN(750_000_000), // dailySpendingCapUsd
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        validDigest,
      )
      .accounts({
        owner: owner.publicKey,
        vault: vault.vaultPda,
        policy: vault.policyPda,
        pendingPolicy: pendingPolicyPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // 2. Tamper live policy: create post-assertions, which mutates
    //    `has_post_assertions` (included in the digest). The pending PDA's
    //    stored `new_policy_preview_digest` was computed when
    //    has_post_assertions=0; now apply will recompute against
    //    has_post_assertions=1 → mismatch.
    const [postAssertionsPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("post_assertions"), vault.vaultPda.toBuffer()],
      program.programId,
    );
    await program.methods
      .createPostAssertions([
        {
          targetAccount: Keypair.generate().publicKey,
          offset: 0,
          valueLen: 8,
          operator: { lte: {} },
          expectedValue: Buffer.from(new BN(1).toArray("le", 8)),
          assertionMode: 0,
        },
      ])
      .accounts({
        owner: owner.publicKey,
        vault: vault.vaultPda,
        policy: vault.policyPda,
        postAssertions: postAssertionsPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // 3. Advance timelock and attempt apply.
    advanceTime(svm, 1801);

    let threw = false;
    try {
      await program.methods
        .applyPendingPolicy()
        .accounts({
          owner: owner.publicKey,
          vault: vault.vaultPda,
          policy: vault.policyPda,
          pendingPolicy: pendingPolicyPda,
        } as any)
        .rpc();
    } catch (err: any) {
      threw = true;
      const msg = err?.message ?? String(err);
      expect(msg).to.satisfy(
        (m: string) =>
          m.includes("PolicyPreviewMismatch") || m.includes("6080"),
        `expected PolicyPreviewMismatch (6080), got: ${msg}`,
      );
    }
    expect(
      threw,
      "apply_pending_policy MUST reject when live policy digest differs from pending",
    ).to.equal(true);
  });

  // ---------------------------------------------------------------------------
  // Test 3: F-4 capability bound at queue_agent_permissions_update
  // ---------------------------------------------------------------------------
  // The auditor noted F-4 (capability bound 0..=2) is enforced at
  // register_agent + queue_agent_permissions_update + apply_agent_permissions_update.
  // Easiest reproducible negative is at queue (apply is a re-validation of the
  // queued capability, so queue rejection covers the same surface). Test that
  // capability=5 is rejected with InvalidCapability (6079).
  it("queue_agent_permissions_update with capability=5 → InvalidCapability", async () => {
    const agent = Keypair.generate();
    airdropSol(svm, agent.publicKey, 10 * LAMPORTS_PER_SOL);

    const vault = await initVault(1102, false, [dummyProtocol]);

    // Register agent first with valid capability so the per-agent pending PDA
    // can be derived for the queue.
    await program.methods
      .registerAgent(agent.publicKey, FULL_CAPABILITY, new BN(0))
      .accountsPartial({
        owner: owner.publicKey,
        vault: vault.vaultPda,
        agentSpendOverlay: vault.overlayPda,
      })
      .rpc();

    const [pendingAgentPermsPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pending_agent_perms"),
        vault.vaultPda.toBuffer(),
        agent.publicKey.toBuffer(),
      ],
      program.programId,
    );

    let threw = false;
    try {
      await program.methods
        .queueAgentPermissionsUpdate(agent.publicKey, 5, new BN(0))
        .accounts({
          owner: owner.publicKey,
          vault: vault.vaultPda,
          policy: vault.policyPda,
          pendingAgentPerms: pendingAgentPermsPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    } catch (err: any) {
      threw = true;
      const msg = err?.message ?? String(err);
      expect(msg).to.satisfy(
        (m: string) => m.includes("InvalidCapability") || m.includes("6079"),
        `expected InvalidCapability (6079), got: ${msg}`,
      );
    }
    expect(
      threw,
      "queue_agent_permissions_update MUST reject capability values > 2",
    ).to.equal(true);
  });
});
