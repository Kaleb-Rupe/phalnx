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
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import {
  initVaultPreviewDigest,
  computePolicyPreviewDigest,
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
        false, // observeOnly
        initVaultPreviewDigest({
          dailySpendingCapUsd: new BN(500_000_000),
          maxTransactionSizeUsd: new BN(100_000_000),
          maxSlippageBps: 100,
          protocolMode: 1,
          protocols: [],
          allowedDestinations: [],
          timelockDuration: new BN(1800),
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
