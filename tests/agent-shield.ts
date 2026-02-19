import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentShield } from "../target/types/agent_shield";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import {
  createTestEnv,
  airdropSol,
  createMintHelper,
  createAtaHelper,
  createAtaIdempotentHelper,
  mintToHelper,
  getTokenBalance,
  getBalance,
  accountExists,
  advancePastSlot,
  advanceTime,
  TestEnv,
  LiteSVM,
} from "./helpers/litesvm-setup";

// Helper to build AllowedToken objects for the IDL
function makeAllowedToken(
  mint: PublicKey,
  oracleFeed: PublicKey = PublicKey.default, // default = stablecoin
  decimals: number = 6,
  dailyCapBase: BN = new BN(0),
  maxTxBase: BN = new BN(0),
) {
  return { mint, oracleFeed, decimals, dailyCapBase, maxTxBase };
}

describe("agent-shield", () => {
  let env: TestEnv;
  let svm: LiteSVM;
  let program: Program<AgentShield>;

  // Test actors
  let owner: anchor.Wallet;
  const agent = Keypair.generate();
  const feeDestination = Keypair.generate();
  const unauthorizedUser = Keypair.generate();

  // Token mints and accounts
  let usdcMint: PublicKey;
  let solMint: PublicKey; // a second SPL token for testing
  const vaultId = new BN(1);

  // PDAs
  let vaultPda: PublicKey;
  let vaultBump: number;
  let policyPda: PublicKey;
  let policyBump: number;
  let trackerPda: PublicKey;
  let trackerBump: number;

  // Token accounts
  let ownerUsdcAta: PublicKey;
  let vaultUsdcAta: PublicKey;
  let feeDestUsdcAta: PublicKey;

  // Allowed protocol (fake Jupiter program ID for testing)
  const jupiterProgramId = Keypair.generate().publicKey;

  // Protocol treasury (must match hardcoded constant in program)
  const protocolTreasury = new PublicKey("ASHie1dFTnDSnrHMPGmniJhMgfJVGPm3rAaEPnrtWDiT");
  let protocolTreasuryUsdcAta: PublicKey;

  before(async () => {
    env = createTestEnv();
    svm = env.svm;
    program = env.program;
    owner = env.provider.wallet;

    // Airdrop to test accounts
    // Owner needs extra SOL for larger PolicyConfig (AllowedToken is 81 bytes each)
    airdropSol(svm, owner.publicKey, 100 * LAMPORTS_PER_SOL);
    airdropSol(svm, agent.publicKey, 10 * LAMPORTS_PER_SOL);
    airdropSol(svm, unauthorizedUser.publicKey, 10 * LAMPORTS_PER_SOL);
    airdropSol(svm, feeDestination.publicKey, 2 * LAMPORTS_PER_SOL);

    // Create USDC-like mint (6 decimals)
    usdcMint = createMintHelper(
      svm,
      (owner as any).payer,
      owner.publicKey,
      6
    );

    // Create a second mint for testing disallowed tokens
    solMint = createMintHelper(
      svm,
      (owner as any).payer,
      owner.publicKey,
      9
    );

    // Create owner's USDC ATA and mint tokens
    ownerUsdcAta = createAtaHelper(
      svm,
      (owner as any).payer,
      usdcMint,
      owner.publicKey
    );
    mintToHelper(
      svm,
      (owner as any).payer,
      usdcMint,
      ownerUsdcAta,
      owner.publicKey,
      2_000_000_000n // 2000 USDC
    );

    // Create protocol treasury ATA (needed for fee transfers)
    // Protocol treasury is an off-curve address, so we need allowOwnerOffCurve=true
    protocolTreasuryUsdcAta = createAtaIdempotentHelper(
      svm,
      (owner as any).payer,
      usdcMint,
      protocolTreasury,
      true
    );

    // Derive PDAs
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        owner.publicKey.toBuffer(),
        vaultId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    [policyPda, policyBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), vaultPda.toBuffer()],
      program.programId
    );

    [trackerPda, trackerBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("tracker"), vaultPda.toBuffer()],
      program.programId
    );
  });

  // =========================================================================
  // initialize_vault
  // =========================================================================
  describe("initialize_vault", () => {
    it("creates vault, policy, and tracker PDAs with correct values", async () => {
      const dailyCap = new BN(500_000_000); // 500 USDC
      const maxTxSize = new BN(100_000_000); // 100 USDC

      await program.methods
        .initializeVault(
          vaultId,
          dailyCap,
          maxTxSize,
          [makeAllowedToken(usdcMint)],
          [jupiterProgramId],
          new BN(0) as any, // max_leverage_bps (u16)
          3, // max_concurrent_positions
          0, // developer_fee_rate
          new BN(0), // timelockDuration
          [], // allowedDestinations
          0, // tracker_tier: Standard
        )
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
          tracker: trackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Verify vault state
      const vault = await program.account.agentVault.fetch(vaultPda);
      expect(vault.owner.toString()).to.equal(owner.publicKey.toString());
      expect(vault.agent.toString()).to.equal(PublicKey.default.toString());
      expect(vault.feeDestination.toString()).to.equal(feeDestination.publicKey.toString());
      expect(vault.vaultId.toNumber()).to.equal(1);
      expect(vault.totalTransactions.toNumber()).to.equal(0);
      expect(vault.totalVolume.toNumber()).to.equal(0);
      expect(vault.openPositions).to.equal(0);
      expect(vault.totalFeesCollected.toNumber()).to.equal(0);

      // Verify policy state
      const policy = await program.account.policyConfig.fetch(policyPda);
      expect(policy.vault.toString()).to.equal(vaultPda.toString());
      expect(policy.dailySpendingCapUsd.toNumber()).to.equal(500_000_000);
      expect(policy.maxTransactionSizeUsd.toNumber()).to.equal(100_000_000);
      expect(policy.allowedTokens.length).to.equal(1);
      expect(policy.allowedTokens[0].mint.toString()).to.equal(usdcMint.toString());
      expect(policy.allowedProtocols.length).to.equal(1);
      expect(policy.allowedProtocols[0].toString()).to.equal(jupiterProgramId.toString());
      expect(policy.canOpenPositions).to.equal(true);
      expect(policy.maxConcurrentPositions).to.equal(3);
      expect(policy.developerFeeRate).to.equal(0);

      // Verify tracker state
      const tracker = await program.account.spendTracker.fetch(trackerPda);
      expect(tracker.vault.toString()).to.equal(vaultPda.toString());
      expect(tracker.rollingSpends.length).to.equal(0);
      expect(tracker.recentTransactions.length).to.equal(0);
    });

    it("rejects duplicate vault_id (PDA already exists)", async () => {
      try {
        await program.methods
          .initializeVault(
            vaultId, // same vault_id
            new BN(100),
            new BN(100),
            [],
            [],
            new BN(0) as any,
            1,
            0,
            new BN(0),
            [],
            0, // tracker_tier: Standard
          )
          .accounts({
            owner: owner.publicKey,
            vault: vaultPda,
            policy: policyPda,
            tracker: trackerPda,
            feeDestination: feeDestination.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Anchor init constraint fails when account already exists
        expect(err.toString()).to.include("already in use");
      }
    });

    it("rejects too many allowed tokens", async () => {
      const vaultId2 = new BN(99);
      const [vault2] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), vaultId2.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [policy2] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), vault2.toBuffer()],
        program.programId
      );
      const [tracker2] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), vault2.toBuffer()],
        program.programId
      );

      // 11 tokens exceeds MAX_ALLOWED_TOKENS (10)
      const tooManyTokens = Array.from({ length: 11 }, () => makeAllowedToken(Keypair.generate().publicKey));
      try {
        await program.methods
          .initializeVault(vaultId2, new BN(100), new BN(100), tooManyTokens, [], new BN(0) as any, 1, 0, new BN(0), [], 0)
          .accounts({
            owner: owner.publicKey,
            vault: vault2,
            policy: policy2,
            tracker: tracker2,
            feeDestination: feeDestination.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // With AllowedToken at 81 bytes each, 11 entries may exceed tx size
        // before the on-chain check fires — both are valid rejections
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("TooManyAllowedTokens") || s.includes("Transaction too large")
        );
      }
    });
  });

  // =========================================================================
  // deposit_funds
  // =========================================================================
  describe("deposit_funds", () => {
    it("transfers tokens from owner to vault", async () => {
      const depositAmount = new BN(100_000_000); // 100 USDC

      // vault ATA will be created by init_if_needed
      vaultUsdcAta = anchor.utils.token.associatedAddress({
        mint: usdcMint,
        owner: vaultPda,
      });

      await program.methods
        .depositFunds(depositAmount)
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          mint: usdcMint,
          ownerTokenAccount: ownerUsdcAta,
          vaultTokenAccount: vaultUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const vaultBalance = getTokenBalance(svm, vaultUsdcAta);
      expect(Number(vaultBalance)).to.equal(100_000_000);
    });

    it("rejects non-owner signer", async () => {
      try {
        // Derive vault PDA for unauthorizedUser — won't match
        const [fakeVault] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("vault"),
            unauthorizedUser.publicKey.toBuffer(),
            vaultId.toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );

        await program.methods
          .depositFunds(new BN(1_000_000))
          .accounts({
            owner: unauthorizedUser.publicKey,
            vault: vaultPda, // real vault owned by `owner`
            mint: usdcMint,
            ownerTokenAccount: ownerUsdcAta,
            vaultTokenAccount: vaultUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Anchor's PDA re-derivation fails before the handler runs
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("ConstraintSeeds") || s.includes("has_one")
        );
      }
    });
  });

  // =========================================================================
  // register_agent
  // =========================================================================
  describe("register_agent", () => {
    it("registers an agent pubkey", async () => {
      await program.methods
        .registerAgent(agent.publicKey)
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
        } as any)
        .rpc();

      const vault = await program.account.agentVault.fetch(vaultPda);
      expect(vault.agent.toString()).to.equal(agent.publicKey.toString());
    });

    it("rejects double registration", async () => {
      try {
        await program.methods
          .registerAgent(Keypair.generate().publicKey)
          .accounts({
            owner: owner.publicKey,
            vault: vaultPda,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("AgentAlreadyRegistered");
      }
    });

    it("rejects non-owner signer", async () => {
      // Create a new vault for this test
      const vid = new BN(200);
      const [v] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), vid.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [p] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), v.toBuffer()],
        program.programId
      );
      const [t] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), v.toBuffer()],
        program.programId
      );

      // First create the vault
      await program.methods
        .initializeVault(vid, new BN(1000), new BN(1000), [] as any[], [], new BN(0) as any, 1, 0, new BN(0), [], 0)
        .accounts({
          owner: owner.publicKey,
          vault: v,
          policy: p,
          tracker: t,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Try to register agent as non-owner
      try {
        await program.methods
          .registerAgent(agent.publicKey)
          .accounts({
            owner: unauthorizedUser.publicKey,
            vault: v,
          } as any)
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("ConstraintSeeds") || s.includes("has_one")
        );
      }
    });
  });

  // =========================================================================
  // update_policy
  // =========================================================================
  describe("update_policy", () => {
    it("updates individual policy fields", async () => {
      await program.methods
        .updatePolicy(
          new BN(200_000_000), // new daily cap: 200 USDC
          null,                // keep max_transaction_size
          null,                // keep allowed_tokens
          null,                // keep allowed_protocols
          null,                // keep max_leverage_bps
          null,                // keep can_open_positions
          null,                // keep max_concurrent_positions
          null,                // keep developer_fee_rate
          null,                // keep timelockDuration
          null                 // keep allowedDestinations
        )
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
          tracker: trackerPda,
        } as any)
        .rpc();

      const policy = await program.account.policyConfig.fetch(policyPda);
      expect(policy.dailySpendingCapUsd.toNumber()).to.equal(200_000_000);
      // Other fields unchanged
      expect(policy.maxTransactionSizeUsd.toNumber()).to.equal(100_000_000);
      expect(policy.allowedTokens.length).to.equal(1);
    });

    it("rejects non-owner signer", async () => {
      try {
        await program.methods
          .updatePolicy(new BN(999), null, null, null, null, null, null, null, null, null)
          .accounts({
            owner: unauthorizedUser.publicKey,
            vault: vaultPda,
            policy: policyPda,
            tracker: trackerPda,
          } as any)
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("ConstraintSeeds") || s.includes("has_one")
        );
      }
    });

    it("rejects too many allowed protocols", async () => {
      const tooManyProtocols = Array.from({ length: 11 }, () => Keypair.generate().publicKey);
      try {
        await program.methods
          .updatePolicy(null, null, null, tooManyProtocols, null, null, null, null, null, null)
          .accounts({
            owner: owner.publicKey,
            vault: vaultPda,
            policy: policyPda,
            tracker: trackerPda,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("TooManyAllowedProtocols");
      }
    });
  });

  // =========================================================================
  // revoke_agent (kill switch)
  // =========================================================================
  describe("revoke_agent", () => {
    // We'll use a separate vault for revoke/reactivate tests to not affect other tests
    const revokeVaultId = new BN(10);
    let revokeVaultPda: PublicKey;

    before(async () => {
      [revokeVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), revokeVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [rp] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), revokeVaultPda.toBuffer()],
        program.programId
      );
      const [rt] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), revokeVaultPda.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(revokeVaultId, new BN(1000), new BN(1000), [] as any[], [], new BN(0) as any, 1, 0, new BN(0), [], 0)
        .accounts({
          owner: owner.publicKey,
          vault: revokeVaultPda,
          policy: rp,
          tracker: rt,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      await program.methods
        .registerAgent(agent.publicKey)
        .accounts({ owner: owner.publicKey, vault: revokeVaultPda } as any)
        .rpc();
    });

    it("freezes the vault", async () => {
      await program.methods
        .revokeAgent()
        .accounts({ owner: owner.publicKey, vault: revokeVaultPda } as any)
        .rpc();

      const vault = await program.account.agentVault.fetch(revokeVaultPda);
      // VaultStatus::Frozen is represented as { frozen: {} }
      expect(vault.status).to.have.property("frozen");
    });

    it("is idempotent (can freeze already-frozen vault)", async () => {
      await program.methods
        .revokeAgent()
        .accounts({ owner: owner.publicKey, vault: revokeVaultPda } as any)
        .rpc();

      const vault = await program.account.agentVault.fetch(revokeVaultPda);
      expect(vault.status).to.have.property("frozen");
    });

    it("rejects non-owner signer", async () => {
      try {
        await program.methods
          .revokeAgent()
          .accounts({ owner: unauthorizedUser.publicKey, vault: revokeVaultPda } as any)
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("ConstraintSeeds") || s.includes("has_one")
        );
      }
    });
  });

  // =========================================================================
  // reactivate_vault
  // =========================================================================
  describe("reactivate_vault", () => {
    const reactVaultId = new BN(11);
    let reactVaultPda: PublicKey;

    before(async () => {
      [reactVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), reactVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [rp] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), reactVaultPda.toBuffer()],
        program.programId
      );
      const [rt] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), reactVaultPda.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(reactVaultId, new BN(1000), new BN(1000), [] as any[], [], new BN(0) as any, 1, 0, new BN(0), [], 0)
        .accounts({
          owner: owner.publicKey,
          vault: reactVaultPda,
          policy: rp,
          tracker: rt,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Freeze it first
      await program.methods
        .revokeAgent()
        .accounts({ owner: owner.publicKey, vault: reactVaultPda } as any)
        .rpc();
    });

    it("reactivates a frozen vault", async () => {
      await program.methods
        .reactivateVault(null)
        .accounts({ owner: owner.publicKey, vault: reactVaultPda } as any)
        .rpc();

      const vault = await program.account.agentVault.fetch(reactVaultPda);
      expect(vault.status).to.have.property("active");
    });

    it("rejects reactivating an already-active vault", async () => {
      try {
        await program.methods
          .reactivateVault(null)
          .accounts({ owner: owner.publicKey, vault: reactVaultPda } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("VaultNotFrozen");
      }
    });

    it("optionally rotates agent key on reactivation", async () => {
      // Freeze again
      await program.methods
        .revokeAgent()
        .accounts({ owner: owner.publicKey, vault: reactVaultPda } as any)
        .rpc();

      const newAgent = Keypair.generate();
      await program.methods
        .reactivateVault(newAgent.publicKey)
        .accounts({ owner: owner.publicKey, vault: reactVaultPda } as any)
        .rpc();

      const vault = await program.account.agentVault.fetch(reactVaultPda);
      expect(vault.agent.toString()).to.equal(newAgent.publicKey.toString());
      expect(vault.status).to.have.property("active");
    });
  });

  // =========================================================================
  // withdraw_funds
  // =========================================================================
  describe("withdraw_funds", () => {
    it("transfers tokens from vault to owner", async () => {
      const ownerBefore = Number(getTokenBalance(svm, ownerUsdcAta));
      const vaultBefore = Number(getTokenBalance(svm, vaultUsdcAta));

      const withdrawAmount = new BN(10_000_000); // 10 USDC
      await program.methods
        .withdrawFunds(withdrawAmount)
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          mint: usdcMint,
          vaultTokenAccount: vaultUsdcAta,
          ownerTokenAccount: ownerUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();

      const ownerAfter = Number(getTokenBalance(svm, ownerUsdcAta));
      const vaultAfter = Number(getTokenBalance(svm, vaultUsdcAta));

      expect(vaultAfter).to.equal(vaultBefore - 10_000_000);
      expect(ownerAfter).to.equal(ownerBefore + 10_000_000);
    });

    it("rejects withdrawal exceeding balance", async () => {
      try {
        await program.methods
          .withdrawFunds(new BN(999_999_999_999))
          .accounts({
            owner: owner.publicKey,
            vault: vaultPda,
            mint: usdcMint,
            vaultTokenAccount: vaultUsdcAta,
            ownerTokenAccount: ownerUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("InsufficientBalance");
      }
    });

    it("rejects non-owner signer", async () => {
      try {
        await program.methods
          .withdrawFunds(new BN(1))
          .accounts({
            owner: unauthorizedUser.publicKey,
            vault: vaultPda,
            mint: usdcMint,
            vaultTokenAccount: vaultUsdcAta,
            ownerTokenAccount: ownerUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("ConstraintSeeds") || s.includes("has_one")
        );
      }
    });
  });

  // =========================================================================
  // validate_and_authorize
  // =========================================================================
  describe("validate_and_authorize", () => {
    let sessionPda: PublicKey;

    before(async () => {
      [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), vaultPda.toBuffer(), agent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );
    });

    it("authorizes a valid swap action", async () => {
      const amount = new BN(50_000_000); // 50 USDC

      await program.methods
        .validateAndAuthorize(
          { swap: {} },    // ActionType::Swap
          usdcMint,
          amount,
          jupiterProgramId,
          null               // no leverage
        )
        .accounts({
          agent: agent.publicKey,
          vault: vaultPda,
          policy: policyPda,
          tracker: trackerPda,
          session: sessionPda,
          vaultTokenAccount: vaultUsdcAta,
          tokenMintAccount: usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agent])
        .rpc();

      // Verify session was created
      const session = await program.account.sessionAuthority.fetch(sessionPda);
      expect(session.vault.toString()).to.equal(vaultPda.toString());
      expect(session.agent.toString()).to.equal(agent.publicKey.toString());
      expect(session.authorized).to.equal(true);
      expect(session.authorizedAmount.toNumber()).to.equal(50_000_000);
      expect(session.authorizedToken.toString()).to.equal(usdcMint.toString());
      expect(session.authorizedProtocol.toString()).to.equal(jupiterProgramId.toString());
      expect(session.delegated).to.equal(true);
      expect(session.delegationTokenAccount.toString()).to.equal(vaultUsdcAta.toString());

      // Verify spend was tracked (USD amount for stablecoin = base amount)
      const tracker = await program.account.spendTracker.fetch(trackerPda);
      expect(tracker.rollingSpends.length).to.equal(1);
      expect(tracker.rollingSpends[0].usdAmount.toNumber()).to.equal(50_000_000);
      expect(tracker.rollingSpends[0].baseAmount.toNumber()).to.equal(50_000_000);
    });

    it("prevents double-authorization (session already exists)", async () => {
      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            usdcMint,
            new BN(1_000_000),
            jupiterProgramId,
            null
          )
          .accounts({
            agent: agent.publicKey,
            vault: vaultPda,
            policy: policyPda,
            tracker: trackerPda,
            session: sessionPda,
            vaultTokenAccount: vaultUsdcAta,
            tokenMintAccount: usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([agent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // init constraint fails because session PDA already exists
        expect(err.toString()).to.include("already in use");
      }
    });
  });

  // =========================================================================
  // finalize_session
  // =========================================================================
  describe("finalize_session", () => {
    let sessionPda: PublicKey;

    before(async () => {
      [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), vaultPda.toBuffer(), agent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );
    });

    it("finalizes a session and records audit log", async () => {
      // Protocol fee = 50_000_000 * 20 / 1_000_000 = 1000 (> 0), so we need token accounts
      await program.methods
        .finalizeSession(true)
        .accounts({
          payer: agent.publicKey,
          vault: vaultPda,
          policy: policyPda,
          tracker: trackerPda,
          session: sessionPda,
          sessionRentRecipient: agent.publicKey,
          vaultTokenAccount: vaultUsdcAta,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agent])
        .rpc();

      // Session should be closed (fetch should fail)
      try {
        await program.account.sessionAuthority.fetch(sessionPda);
        expect.fail("Session should have been closed");
      } catch (err: any) {
        // LiteSVM proxy returns "Account does not exist"; Anchor provider
        // returns "Could not find". Both confirm the session PDA was closed.
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("Account does not exist") || s.includes("Could not find")
        );
      }

      // Verify vault stats updated
      const vault = await program.account.agentVault.fetch(vaultPda);
      expect(vault.totalTransactions.toNumber()).to.equal(1);
      expect(vault.totalVolume.toNumber()).to.equal(50_000_000);

      // Verify audit log
      const tracker = await program.account.spendTracker.fetch(trackerPda);
      expect(tracker.recentTransactions.length).to.equal(1);
      expect(tracker.recentTransactions[0].success).to.equal(true);
      expect(tracker.recentTransactions[0].amount.toNumber()).to.equal(50_000_000);
    });
  });

  // =========================================================================
  // validate_and_authorize — error paths
  // =========================================================================
  describe("validate_and_authorize error paths", () => {
    let sessionPda: PublicKey;

    beforeEach(async () => {
      [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), vaultPda.toBuffer(), agent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );
    });

    it("rejects disallowed token", async () => {
      // Session PDA for solMint (disallowed token)
      const [solSession] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), vaultPda.toBuffer(), agent.publicKey.toBuffer(), solMint.toBuffer()],
        program.programId
      );
      // Create vault ATA for solMint so Anchor account validation passes,
      // allowing the handler's TokenNotAllowed check to fire.
      const vaultSolAta = createAtaIdempotentHelper(
        svm,
        (owner as any).payer,
        solMint,
        vaultPda,
        true, // allowOwnerOffCurve — vault is a PDA
      );
      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            solMint, // not in allowed_tokens
            new BN(1_000_000),
            jupiterProgramId,
            null
          )
          .accounts({
            agent: agent.publicKey,
            vault: vaultPda,
            policy: policyPda,
            tracker: trackerPda,
            session: solSession,
            vaultTokenAccount: vaultSolAta,
            tokenMintAccount: solMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([agent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("TokenNotAllowed");
      }
    });

    it("rejects disallowed protocol", async () => {
      const fakeProtocol = Keypair.generate().publicKey;
      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            usdcMint,
            new BN(1_000_000),
            fakeProtocol, // not in allowed_protocols
            null
          )
          .accounts({
            agent: agent.publicKey,
            vault: vaultPda,
            policy: policyPda,
            tracker: trackerPda,
            session: sessionPda,
            vaultTokenAccount: vaultUsdcAta,
            tokenMintAccount: usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([agent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("ProtocolNotAllowed");
      }
    });

    it("rejects transaction exceeding max size", async () => {
      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            usdcMint,
            new BN(200_000_000), // exceeds max_transaction_size of 100 USDC
            jupiterProgramId,
            null
          )
          .accounts({
            agent: agent.publicKey,
            vault: vaultPda,
            policy: policyPda,
            tracker: trackerPda,
            session: sessionPda,
            vaultTokenAccount: vaultUsdcAta,
            tokenMintAccount: usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([agent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("TransactionTooLarge");
      }
    });

    it("rejects when daily spending cap would be exceeded", async () => {
      // Current daily cap is 200 USDC, already spent 50 USDC
      // Trying to spend 160 USDC would put us at 210 > 200
      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            usdcMint,
            new BN(100_000_000), // 100 USDC — within max_tx_size but 50+100=150 which is under 200 cap
            jupiterProgramId,
            null
          )
          .accounts({
            agent: agent.publicKey,
            vault: vaultPda,
            policy: policyPda,
            tracker: trackerPda,
            session: sessionPda,
            vaultTokenAccount: vaultUsdcAta,
            tokenMintAccount: usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([agent])
          .rpc();

        // This should succeed (50 + 100 = 150 < 200 cap)
        // Finalize it so we can test the cap
        await program.methods
          .finalizeSession(true)
          .accounts({
            payer: agent.publicKey,
            vault: vaultPda,
            policy: policyPda,
            tracker: trackerPda,
            session: sessionPda,
            sessionRentRecipient: agent.publicKey,
            vaultTokenAccount: vaultUsdcAta,
            feeDestinationTokenAccount: null,
            protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([agent])
          .rpc();

        // Now try to spend another 100 USDC — total would be 250 > 200 cap
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            usdcMint,
            new BN(100_000_000),
            jupiterProgramId,
            null
          )
          .accounts({
            agent: agent.publicKey,
            vault: vaultPda,
            policy: policyPda,
            tracker: trackerPda,
            session: sessionPda,
            vaultTokenAccount: vaultUsdcAta,
            tokenMintAccount: usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([agent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("DailyCapExceeded");
      }
    });

    it("rejects unauthorized agent", async () => {
      const fakeAgent = Keypair.generate();
      airdropSol(svm, fakeAgent.publicKey, LAMPORTS_PER_SOL);

      const [fakeSession] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), vaultPda.toBuffer(), fakeAgent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            usdcMint,
            new BN(1_000_000),
            jupiterProgramId,
            null
          )
          .accounts({
            agent: fakeAgent.publicKey,
            vault: vaultPda,
            policy: policyPda,
            tracker: trackerPda,
            session: fakeSession,
            vaultTokenAccount: vaultUsdcAta,
            tokenMintAccount: usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([fakeAgent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("UnauthorizedAgent");
      }
    });

    it("rejects action on frozen vault", async () => {
      // Create a fresh vault, register agent, then freeze it
      // Note: revoke_agent clears the agent key, so is_agent() fails before
      // the handler's VaultNotActive check. We verify the vault rejects
      // the action — either UnauthorizedAgent (agent cleared) or VaultNotActive.
      const frozenVaultId = new BN(10);
      const [frozenVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), frozenVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [frozenPolicy] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), frozenVault.toBuffer()],
        program.programId
      );
      const [frozenTracker] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), frozenVault.toBuffer()],
        program.programId
      );
      const [frozenSession] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), frozenVault.toBuffer(), agent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );

      // Create vault ATA so Anchor account validation passes,
      // allowing the agent/status checks to fire.
      const frozenVaultUsdcAta = createAtaIdempotentHelper(
        svm,
        (owner as any).payer,
        usdcMint,
        frozenVault,
        true, // allowOwnerOffCurve — vault is a PDA
      );

      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            usdcMint,
            new BN(1_000_000),
            jupiterProgramId,
            null
          )
          .accounts({
            agent: agent.publicKey,
            vault: frozenVault,
            policy: frozenPolicy,
            tracker: frozenTracker,
            session: frozenSession,
            vaultTokenAccount: frozenVaultUsdcAta,
            tokenMintAccount: usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([agent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // revoke_agent clears the agent key, so is_agent() constraint fails
        // before the handler's VaultNotActive check can run.
        expect(err.toString()).to.satisfy(
          (s: string) =>
            s.includes("UnauthorizedAgent") ||
            s.includes("ConstraintRaw")
        );
      }
    });
  });

  // =========================================================================
  // close_vault
  // =========================================================================
  describe("close_vault", () => {
    const closeVaultId = new BN(20);
    let closeVaultPda: PublicKey;
    let closePolicyPda: PublicKey;
    let closeTrackerPda: PublicKey;

    before(async () => {
      [closeVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), closeVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [closePolicyPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), closeVaultPda.toBuffer()],
        program.programId
      );
      [closeTrackerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), closeVaultPda.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(closeVaultId, new BN(1000), new BN(1000), [] as any[], [], new BN(0) as any, 1, 0, new BN(0), [], 0)
        .accounts({
          owner: owner.publicKey,
          vault: closeVaultPda,
          policy: closePolicyPda,
          tracker: closeTrackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    });

    it("closes vault and reclaims rent", async () => {
      const ownerBefore = getBalance(svm, owner.publicKey);

      await program.methods
        .closeVault()
        .accounts({
          owner: owner.publicKey,
          vault: closeVaultPda,
          policy: closePolicyPda,
          tracker: closeTrackerPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Accounts should no longer exist
      expect(accountExists(svm, closeVaultPda)).to.be.false;
      expect(accountExists(svm, closePolicyPda)).to.be.false;
      expect(accountExists(svm, closeTrackerPda)).to.be.false;

      // Owner should have received rent back
      const ownerAfter = getBalance(svm, owner.publicKey);
      expect(ownerAfter).to.be.greaterThan(ownerBefore);
    });

    it("rejects non-owner signer", async () => {
      // Create another vault to test rejection
      const vid = new BN(21);
      const [v] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), vid.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [p] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), v.toBuffer()],
        program.programId
      );
      const [t] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), v.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(vid, new BN(1000), new BN(1000), [] as any[], [], new BN(0) as any, 1, 0, new BN(0), [], 0)
        .accounts({
          owner: owner.publicKey,
          vault: v,
          policy: p,
          tracker: t,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      try {
        await program.methods
          .closeVault()
          .accounts({
            owner: unauthorizedUser.publicKey,
            vault: v,
            policy: p,
            tracker: t,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("ConstraintSeeds") || s.includes("has_one")
        );
      }
    });
  });

  // =========================================================================
  // Dual Fee Model Tests
  // =========================================================================
  describe("dual fee model", () => {
    const feeVaultId = new BN(30);
    let feeVaultPda: PublicKey;
    let feePolicyPda: PublicKey;
    let feeTrackerPda: PublicKey;
    let feeVaultUsdcAta: PublicKey;
    let feeSessionPda: PublicKey;

    it("init vault with developer_fee_rate 30 → stored correctly", async () => {
      [feeVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), feeVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [feePolicyPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), feeVaultPda.toBuffer()],
        program.programId
      );
      [feeTrackerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), feeVaultPda.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(
          feeVaultId,
          new BN(500_000_000),
          new BN(100_000_000),
          [makeAllowedToken(usdcMint)],
          [jupiterProgramId],
          new BN(0) as any,
          3,
          30, // developer_fee_rate = 30 (0.3 BPS)
          new BN(0),
          [],
          0, // tracker_tier: Standard
        )
        .accounts({
          owner: owner.publicKey,
          vault: feeVaultPda,
          policy: feePolicyPda,
          tracker: feeTrackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const policy = await program.account.policyConfig.fetch(feePolicyPda);
      expect(policy.developerFeeRate).to.equal(30);
    });

    it("init vault with developer_fee_rate 51 → rejects DeveloperFeeTooHigh", async () => {
      const badVaultId = new BN(31);
      const [bv] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), badVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [bp] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), bv.toBuffer()],
        program.programId
      );
      const [bt] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), bv.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .initializeVault(badVaultId, new BN(1000), new BN(1000), [] as any[], [], new BN(0) as any, 1, 51, new BN(0), [], 0)
          .accounts({
            owner: owner.publicKey,
            vault: bv,
            policy: bp,
            tracker: bt,
            feeDestination: feeDestination.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("DeveloperFeeTooHigh");
      }
    });

    it("update_policy changes developer_fee_rate 0→30 → stored", async () => {
      // Use the fee vault created above, first set to 0
      await program.methods
        .updatePolicy(null, null, null, null, null, null, null, 0, null, null)
        .accounts({
          owner: owner.publicKey,
          vault: feeVaultPda,
          policy: feePolicyPda,
          tracker: feeTrackerPda,
        } as any)
        .rpc();

      let policy = await program.account.policyConfig.fetch(feePolicyPda);
      expect(policy.developerFeeRate).to.equal(0);

      // Now update to 30
      await program.methods
        .updatePolicy(null, null, null, null, null, null, null, 30, null, null)
        .accounts({
          owner: owner.publicKey,
          vault: feeVaultPda,
          policy: feePolicyPda,
          tracker: feeTrackerPda,
        } as any)
        .rpc();

      policy = await program.account.policyConfig.fetch(feePolicyPda);
      expect(policy.developerFeeRate).to.equal(30);
    });

    it("update_policy with developer_fee_rate 51 → rejects", async () => {
      try {
        await program.methods
          .updatePolicy(null, null, null, null, null, null, null, 51, null, null)
          .accounts({
            owner: owner.publicKey,
            vault: feeVaultPda,
            policy: feePolicyPda,
            tracker: feeTrackerPda,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("DeveloperFeeTooHigh");
      }
    });

    it("finalize with developer_fee=0 → only protocol fee transferred", async () => {
      // Set developer fee to 0
      await program.methods
        .updatePolicy(null, null, null, null, null, null, null, 0, null, null)
        .accounts({
          owner: owner.publicKey,
          vault: feeVaultPda,
          policy: feePolicyPda,
          tracker: feeTrackerPda,
        } as any)
        .rpc();

      // Register agent on fee vault
      await program.methods
        .registerAgent(agent.publicKey)
        .accounts({ owner: owner.publicKey, vault: feeVaultPda } as any)
        .rpc();

      // Deposit to the fee vault
      feeVaultUsdcAta = anchor.utils.token.associatedAddress({
        mint: usdcMint,
        owner: feeVaultPda,
      });

      await program.methods
        .depositFunds(new BN(50_000_000))
        .accounts({
          owner: owner.publicKey,
          vault: feeVaultPda,
          mint: usdcMint,
          ownerTokenAccount: ownerUsdcAta,
          vaultTokenAccount: feeVaultUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Authorize action
      [feeSessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), feeVaultPda.toBuffer(), agent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );

      await program.methods
        .validateAndAuthorize(
          { swap: {} },
          usdcMint,
          new BN(10_000_000),
          jupiterProgramId,
          null
        )
        .accounts({
          agent: agent.publicKey,
          vault: feeVaultPda,
          policy: feePolicyPda,
          tracker: feeTrackerPda,
          session: feeSessionPda,
          vaultTokenAccount: feeVaultUsdcAta,
          tokenMintAccount: usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agent])
        .rpc();

      // protocol_fee = 10_000_000 * 20 / 1_000_000 = 200 (> 0), needs token accounts
      await program.methods
        .finalizeSession(true)
        .accounts({
          payer: agent.publicKey,
          vault: feeVaultPda,
          policy: feePolicyPda,
          tracker: feeTrackerPda,
          session: feeSessionPda,
          sessionRentRecipient: agent.publicKey,
          vaultTokenAccount: feeVaultUsdcAta,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agent])
        .rpc();

      // Verify vault stats updated
      const vault = await program.account.agentVault.fetch(feeVaultPda);
      expect(vault.totalTransactions.toNumber()).to.equal(1);
      // developer fees should be 0
      expect(vault.totalFeesCollected.toNumber()).to.equal(0);
    });

    it("finalize with developer_fee=50 → both fees transferred", async () => {
      // Set developer fee to 50 (max, 0.5 BPS)
      await program.methods
        .updatePolicy(null, null, null, null, null, null, null, 50, null, null)
        .accounts({
          owner: owner.publicKey,
          vault: feeVaultPda,
          policy: feePolicyPda,
          tracker: feeTrackerPda,
        } as any)
        .rpc();

      // Create fee destination ATA
      try {
        feeDestUsdcAta = createAtaHelper(
          svm,
          (owner as any).payer,
          usdcMint,
          feeDestination.publicKey
        );
      } catch {
        // ATA may already exist
        feeDestUsdcAta = anchor.utils.token.associatedAddress({
          mint: usdcMint,
          owner: feeDestination.publicKey,
        });
      }

      // Authorize
      [feeSessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), feeVaultPda.toBuffer(), agent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );

      await program.methods
        .validateAndAuthorize(
          { swap: {} },
          usdcMint,
          new BN(10_000_000),
          jupiterProgramId,
          null
        )
        .accounts({
          agent: agent.publicKey,
          vault: feeVaultPda,
          policy: feePolicyPda,
          tracker: feeTrackerPda,
          session: feeSessionPda,
          vaultTokenAccount: feeVaultUsdcAta,
          tokenMintAccount: usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agent])
        .rpc();

      // Finalize with both fee accounts
      await program.methods
        .finalizeSession(true)
        .accounts({
          payer: agent.publicKey,
          vault: feeVaultPda,
          policy: feePolicyPda,
          tracker: feeTrackerPda,
          session: feeSessionPda,
          sessionRentRecipient: agent.publicKey,
          vaultTokenAccount: feeVaultUsdcAta,
          feeDestinationTokenAccount: feeDestUsdcAta,
          protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agent])
        .rpc();

      // developer fee = 10_000_000 * 50 / 1_000_000 = 500
      const vault = await program.account.agentVault.fetch(feeVaultPda);
      expect(vault.totalFeesCollected.toNumber()).to.equal(500);
    });

    it("finalize with success=false → no fees", async () => {
      // Authorize
      [feeSessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), feeVaultPda.toBuffer(), agent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );

      await program.methods
        .validateAndAuthorize(
          { swap: {} },
          usdcMint,
          new BN(10_000_000),
          jupiterProgramId,
          null
        )
        .accounts({
          agent: agent.publicKey,
          vault: feeVaultPda,
          policy: feePolicyPda,
          tracker: feeTrackerPda,
          session: feeSessionPda,
          vaultTokenAccount: feeVaultUsdcAta,
          tokenMintAccount: usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agent])
        .rpc();

      const vaultBefore = await program.account.agentVault.fetch(feeVaultPda);
      const feesBefore = vaultBefore.totalFeesCollected.toNumber();

      // Finalize with success=false
      await program.methods
        .finalizeSession(false)
        .accounts({
          payer: agent.publicKey,
          vault: feeVaultPda,
          policy: feePolicyPda,
          tracker: feeTrackerPda,
          session: feeSessionPda,
          sessionRentRecipient: agent.publicKey,
          vaultTokenAccount: null,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([agent])
        .rpc();

      const vault = await program.account.agentVault.fetch(feeVaultPda);
      // No new fees collected on failure
      expect(vault.totalFeesCollected.toNumber()).to.equal(feesBefore);
    });

    it("init vault with developer_fee_rate at max (50) succeeds", async () => {
      const maxFeeVaultId = new BN(32);
      const [mv] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), maxFeeVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [mp] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), mv.toBuffer()],
        program.programId
      );
      const [mt] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), mv.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(maxFeeVaultId, new BN(1000), new BN(1000), [] as any[], [], new BN(0) as any, 1, 50, new BN(0), [], 0)
        .accounts({
          owner: owner.publicKey,
          vault: mv,
          policy: mp,
          tracker: mt,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const policy = await program.account.policyConfig.fetch(mp);
      expect(policy.developerFeeRate).to.equal(50);
    });
  });

  // =========================================================================
  // Tier 1a: Session expiry & permissionless crank
  // =========================================================================
  describe("session expiry & permissionless crank", () => {
    const expiryVaultId = new BN(40);
    let expiryVaultPda: PublicKey;
    let expiryPolicyPda: PublicKey;
    let expiryTrackerPda: PublicKey;
    let expirySessionPda: PublicKey;
    let expiryVaultUsdcAta: PublicKey;
    const expiryAgent = Keypair.generate();

    before(async () => {
      // Airdrop to new agent
      airdropSol(svm, expiryAgent.publicKey, 5 * LAMPORTS_PER_SOL);

      [expiryVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), expiryVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [expiryPolicyPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), expiryVaultPda.toBuffer()],
        program.programId
      );
      [expiryTrackerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), expiryVaultPda.toBuffer()],
        program.programId
      );
      [expirySessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), expiryVaultPda.toBuffer(), expiryAgent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );

      // Create vault with USDC allowed
      await program.methods
        .initializeVault(
          expiryVaultId,
          new BN(500_000_000),
          new BN(100_000_000),
          [makeAllowedToken(usdcMint)],
          [jupiterProgramId],
          new BN(0) as any,
          3,
          0,
          new BN(0),
          [],
          0, // tracker_tier: Standard
        )
        .accounts({
          owner: owner.publicKey,
          vault: expiryVaultPda,
          policy: expiryPolicyPda,
          tracker: expiryTrackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Register agent
      await program.methods
        .registerAgent(expiryAgent.publicKey)
        .accounts({ owner: owner.publicKey, vault: expiryVaultPda } as any)
        .rpc();

      // Deposit USDC to vault
      expiryVaultUsdcAta = anchor.utils.token.associatedAddress({
        mint: usdcMint,
        owner: expiryVaultPda,
      });

      await program.methods
        .depositFunds(new BN(50_000_000))
        .accounts({
          owner: owner.publicKey,
          vault: expiryVaultPda,
          mint: usdcMint,
          ownerTokenAccount: ownerUsdcAta,
          vaultTokenAccount: expiryVaultUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    });

    it("finalize expired session → success=false, rent returned to agent", async () => {
      // Create session
      await program.methods
        .validateAndAuthorize(
          { swap: {} },
          usdcMint,
          new BN(10_000_000),
          jupiterProgramId,
          null
        )
        .accounts({
          agent: expiryAgent.publicKey,
          vault: expiryVaultPda,
          policy: expiryPolicyPda,
          tracker: expiryTrackerPda,
          session: expirySessionPda,
          vaultTokenAccount: expiryVaultUsdcAta,
          tokenMintAccount: usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([expiryAgent])
        .rpc();

      // Get session expiry slot
      const sessionData = await program.account.sessionAuthority.fetch(expirySessionPda);
      const expiresAt = sessionData.expiresAtSlot.toNumber();

      // Advance clock past expiry (instant, no polling needed)
      advancePastSlot(svm, expiresAt);

      const agentBalBefore = getBalance(svm, expiryAgent.publicKey);

      // Finalize expired session — agent as payer, success is forced to false
      await program.methods
        .finalizeSession(true) // even though we pass true, expired sessions → false
        .accounts({
          payer: expiryAgent.publicKey,
          vault: expiryVaultPda,
          policy: expiryPolicyPda,
          tracker: expiryTrackerPda,
          session: expirySessionPda,
          sessionRentRecipient: expiryAgent.publicKey,
          vaultTokenAccount: null,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([expiryAgent])
        .rpc();

      // Session should be closed
      try {
        await program.account.sessionAuthority.fetch(expirySessionPda);
        expect.fail("Session should have been closed");
      } catch (err: any) {
        // LiteSVM proxy returns "Account does not exist"; Anchor provider
        // returns "Could not find". Both confirm the session PDA was closed.
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("Account does not exist") || s.includes("Could not find")
        );
      }

      // Agent should have received rent back
      const agentBalAfter = getBalance(svm, expiryAgent.publicKey);
      expect(agentBalAfter).to.be.greaterThan(agentBalBefore - 10000); // minus small tx fee

      // Audit log should record success=false
      const tracker = await program.account.spendTracker.fetch(expiryTrackerPda);
      const lastTx = tracker.recentTransactions[tracker.recentTransactions.length - 1];
      expect(lastTx.success).to.equal(false);
    });

    it("permissionless crank: third-party finalizes expired session", async () => {
      // Create a new session
      await program.methods
        .validateAndAuthorize(
          { swap: {} },
          usdcMint,
          new BN(5_000_000),
          jupiterProgramId,
          null
        )
        .accounts({
          agent: expiryAgent.publicKey,
          vault: expiryVaultPda,
          policy: expiryPolicyPda,
          tracker: expiryTrackerPda,
          session: expirySessionPda,
          vaultTokenAccount: expiryVaultUsdcAta,
          tokenMintAccount: usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([expiryAgent])
        .rpc();

      // Get session expiry and advance past it
      const sessionData = await program.account.sessionAuthority.fetch(expirySessionPda);
      const expiresAt = sessionData.expiresAtSlot.toNumber();
      advancePastSlot(svm, expiresAt);

      // Third-party (unauthorizedUser) can clean up expired session
      await program.methods
        .finalizeSession(false)
        .accounts({
          payer: unauthorizedUser.publicKey,
          vault: expiryVaultPda,
          policy: expiryPolicyPda,
          tracker: expiryTrackerPda,
          session: expirySessionPda,
          sessionRentRecipient: expiryAgent.publicKey, // rent still goes to agent
          vaultTokenAccount: null,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([unauthorizedUser])
        .rpc();

      // Session should be closed
      try {
        await program.account.sessionAuthority.fetch(expirySessionPda);
        expect.fail("Session should have been closed");
      } catch (err: any) {
        // LiteSVM proxy returns "Account does not exist"; Anchor provider
        // returns "Could not find". Both confirm the session PDA was closed.
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("Account does not exist") || s.includes("Could not find")
        );
      }
    });

    it("non-expired session: rejects non-agent payer", async () => {
      // Create session
      await program.methods
        .validateAndAuthorize(
          { swap: {} },
          usdcMint,
          new BN(5_000_000),
          jupiterProgramId,
          null
        )
        .accounts({
          agent: expiryAgent.publicKey,
          vault: expiryVaultPda,
          policy: expiryPolicyPda,
          tracker: expiryTrackerPda,
          session: expirySessionPda,
          vaultTokenAccount: expiryVaultUsdcAta,
          tokenMintAccount: usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([expiryAgent])
        .rpc();

      // Try to finalize immediately (not expired) as non-agent
      try {
        await program.methods
          .finalizeSession(true)
          .accounts({
            payer: unauthorizedUser.publicKey,
            vault: expiryVaultPda,
            policy: expiryPolicyPda,
            tracker: expiryTrackerPda,
            session: expirySessionPda,
            sessionRentRecipient: expiryAgent.publicKey,
            vaultTokenAccount: null,
            feeDestinationTokenAccount: null,
            protocolTreasuryTokenAccount: null,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([unauthorizedUser])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("UnauthorizedAgent");
      }

      // Clean up: finalize with proper agent
      await program.methods
        .finalizeSession(true)
        .accounts({
          payer: expiryAgent.publicKey,
          vault: expiryVaultPda,
          policy: expiryPolicyPda,
          tracker: expiryTrackerPda,
          session: expirySessionPda,
          sessionRentRecipient: expiryAgent.publicKey,
          vaultTokenAccount: expiryVaultUsdcAta,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([expiryAgent])
        .rpc();
    });

    it("session rent recipient ≠ agent → rejects InvalidSession", async () => {
      // Create session
      await program.methods
        .validateAndAuthorize(
          { swap: {} },
          usdcMint,
          new BN(5_000_000),
          jupiterProgramId,
          null
        )
        .accounts({
          agent: expiryAgent.publicKey,
          vault: expiryVaultPda,
          policy: expiryPolicyPda,
          tracker: expiryTrackerPda,
          session: expirySessionPda,
          vaultTokenAccount: expiryVaultUsdcAta,
          tokenMintAccount: usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([expiryAgent])
        .rpc();

      // Try to redirect rent to someone else
      try {
        await program.methods
          .finalizeSession(true)
          .accounts({
            payer: expiryAgent.publicKey,
            vault: expiryVaultPda,
            policy: expiryPolicyPda,
            tracker: expiryTrackerPda,
            session: expirySessionPda,
            sessionRentRecipient: unauthorizedUser.publicKey, // wrong recipient
            vaultTokenAccount: null,
            feeDestinationTokenAccount: null,
            protocolTreasuryTokenAccount: null,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([expiryAgent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("InvalidSession");
      }

      // Clean up
      await program.methods
        .finalizeSession(true)
        .accounts({
          payer: expiryAgent.publicKey,
          vault: expiryVaultPda,
          policy: expiryPolicyPda,
          tracker: expiryTrackerPda,
          session: expirySessionPda,
          sessionRentRecipient: expiryAgent.publicKey,
          vaultTokenAccount: expiryVaultUsdcAta,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([expiryAgent])
        .rpc();
    });
  });

  // =========================================================================
  // Tier 1c: Agent registration security
  // =========================================================================
  describe("agent registration security", () => {
    it("rejects owner as agent → AgentIsOwner", async () => {
      const vid = new BN(50);
      const [v] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), vid.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [p] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), v.toBuffer()],
        program.programId
      );
      const [t] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), v.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(vid, new BN(1000), new BN(1000), [] as any[], [], new BN(0) as any, 1, 0, new BN(0), [], 0)
        .accounts({
          owner: owner.publicKey,
          vault: v,
          policy: p,
          tracker: t,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      try {
        await program.methods
          .registerAgent(owner.publicKey) // owner = agent → reject
          .accounts({ owner: owner.publicKey, vault: v } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("AgentIsOwner");
      }
    });

    it("validate_and_authorize with agent after revocation → UnauthorizedAgent", async () => {
      // Use the revoke vault (ID=10) which has been frozen and agent cleared
      const revokeVaultId = new BN(10);
      const [rv] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), revokeVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [rp] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), rv.toBuffer()],
        program.programId
      );
      const [rt] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), rv.toBuffer()],
        program.programId
      );

      // Reactivate so status is Active but with a NEW agent, not our test agent
      const newAgent = Keypair.generate();
      airdropSol(svm, newAgent.publicKey, LAMPORTS_PER_SOL);

      // First reactivate with newAgent
      try {
        // May already be active from earlier test, so freeze first
        await program.methods
          .revokeAgent()
          .accounts({ owner: owner.publicKey, vault: rv } as any)
          .rpc();
      } catch {
        // ignore if already frozen
      }

      await program.methods
        .reactivateVault(newAgent.publicKey)
        .accounts({ owner: owner.publicKey, vault: rv } as any)
        .rpc();

      // Now try to use the ORIGINAL agent (who was revoked)
      const [oldSession] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), rv.toBuffer(), agent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            usdcMint,
            new BN(1_000_000),
            jupiterProgramId,
            null
          )
          .accounts({
            agent: agent.publicKey,
            vault: rv,
            policy: rp,
            tracker: rt,
            session: oldSession,
            vaultTokenAccount: vaultUsdcAta,
            tokenMintAccount: usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([agent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Anchor's is_agent() constraint fires before the handler runs
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("UnauthorizedAgent") || s.includes("ConstraintRaw")
        );
      }
    });
  });

  // =========================================================================
  // Tier 1d: Vault status transitions
  // =========================================================================
  describe("vault status transitions", () => {
    it("deposit to frozen vault → should succeed (only checks VaultAlreadyClosed)", async () => {
      const frozenVaultId = new BN(60);
      const [fv] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), frozenVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [fp] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), fv.toBuffer()],
        program.programId
      );
      const [ft] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), fv.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(frozenVaultId, new BN(1000), new BN(1000), [makeAllowedToken(usdcMint)], [], new BN(0) as any, 1, 0, new BN(0), [], 0)
        .accounts({
          owner: owner.publicKey,
          vault: fv,
          policy: fp,
          tracker: ft,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Freeze the vault
      await program.methods
        .revokeAgent()
        .accounts({ owner: owner.publicKey, vault: fv } as any)
        .rpc();

      const frozenVaultUsdcAta = anchor.utils.token.associatedAddress({
        mint: usdcMint,
        owner: fv,
      });

      // Deposit should succeed even when frozen
      await program.methods
        .depositFunds(new BN(1_000_000))
        .accounts({
          owner: owner.publicKey,
          vault: fv,
          mint: usdcMint,
          ownerTokenAccount: ownerUsdcAta,
          vaultTokenAccount: frozenVaultUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const vaultTokenBalance = getTokenBalance(svm, frozenVaultUsdcAta);
      expect(Number(vaultTokenBalance)).to.equal(1_000_000);
    });

    it("deposit to closed vault → rejects VaultAlreadyClosed", async () => {
      const closedVaultId = new BN(61);
      const [cv] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), closedVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [cp] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), cv.toBuffer()],
        program.programId
      );
      const [ct] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), cv.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(closedVaultId, new BN(1000), new BN(1000), [makeAllowedToken(usdcMint)], [], new BN(0) as any, 1, 0, new BN(0), [], 0)
        .accounts({
          owner: owner.publicKey,
          vault: cv,
          policy: cp,
          tracker: ct,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Close vault
      await program.methods
        .closeVault()
        .accounts({
          owner: owner.publicKey,
          vault: cv,
          policy: cp,
          tracker: ct,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // The vault PDA no longer exists after closing, so any attempt to deposit
      // will fail at the account deserialization level
      const closedVaultUsdcAta = anchor.utils.token.associatedAddress({
        mint: usdcMint,
        owner: cv,
      });

      try {
        await program.methods
          .depositFunds(new BN(1_000_000))
          .accounts({
            owner: owner.publicKey,
            vault: cv,
            mint: usdcMint,
            ownerTokenAccount: ownerUsdcAta,
            vaultTokenAccount: closedVaultUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Vault PDA was closed — Anchor can't deserialize a zeroed/missing account.
        // LiteSVM proxy returns "Account does not exist"; Anchor provider
        // returns "Could not find" or "AccountNotInitialized".
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("AccountNotInitialized") || s.includes("does not exist") || s.includes("Could not find")
        );
      }
    });

    it("validate_and_authorize on closed vault → rejects", async () => {
      const closedVaultId = new BN(62);
      const [cv] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), closedVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [cp] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), cv.toBuffer()],
        program.programId
      );
      const [ct] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), cv.toBuffer()],
        program.programId
      );
      const [cs] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), cv.toBuffer(), agent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(closedVaultId, new BN(1000), new BN(1000), [makeAllowedToken(usdcMint)], [jupiterProgramId], new BN(0) as any, 1, 0, new BN(0), [], 0)
        .accounts({
          owner: owner.publicKey,
          vault: cv,
          policy: cp,
          tracker: ct,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Register agent, then close
      await program.methods
        .registerAgent(agent.publicKey)
        .accounts({ owner: owner.publicKey, vault: cv } as any)
        .rpc();

      await program.methods
        .closeVault()
        .accounts({
          owner: owner.publicKey,
          vault: cv,
          policy: cp,
          tracker: ct,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            usdcMint,
            new BN(1_000_000),
            jupiterProgramId,
            null
          )
          .accounts({
            agent: agent.publicKey,
            vault: cv,
            policy: cp,
            tracker: ct,
            session: cs,
            vaultTokenAccount: anchor.utils.token.associatedAddress({ mint: usdcMint, owner: cv }),
            tokenMintAccount: usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([agent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Vault PDA was closed — Anchor can't deserialize it.
        // LiteSVM returns "does not exist"; Anchor returns "Could not find"
        // or "AccountNotInitialized".
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("AccountNotInitialized") || s.includes("does not exist") || s.includes("Could not find")
        );
      }
    });
  });

  // =========================================================================
  // Tier 2a: Audit log ring buffer (MAX_RECENT_TRANSACTIONS = 50)
  // =========================================================================
  describe("audit log ring buffer", () => {
    const ringVaultId = new BN(70);
    let ringVaultPda: PublicKey;
    let ringPolicyPda: PublicKey;
    let ringTrackerPda: PublicKey;
    let ringVaultUsdcAta: PublicKey;
    const ringAgent = Keypair.generate();

    before(async () => {
      airdropSol(svm, ringAgent.publicKey, 10 * LAMPORTS_PER_SOL);

      [ringVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), ringVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [ringPolicyPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), ringVaultPda.toBuffer()],
        program.programId
      );
      [ringTrackerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), ringVaultPda.toBuffer()],
        program.programId
      );

      // Large daily cap to allow many transactions
      await program.methods
        .initializeVault(
          ringVaultId,
          new BN(999_000_000_000), // 999k USDC daily cap
          new BN(100_000_000),     // 100 USDC max tx
          [makeAllowedToken(usdcMint)],
          [jupiterProgramId],
          new BN(0) as any,
          3,
          0,
          new BN(0),
          [],
          0, // tracker_tier: Standard
        )
        .accounts({
          owner: owner.publicKey,
          vault: ringVaultPda,
          policy: ringPolicyPda,
          tracker: ringTrackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      await program.methods
        .registerAgent(ringAgent.publicKey)
        .accounts({ owner: owner.publicKey, vault: ringVaultPda } as any)
        .rpc();

      ringVaultUsdcAta = anchor.utils.token.associatedAddress({
        mint: usdcMint,
        owner: ringVaultPda,
      });

      // Deposit enough for all transactions + fees
      await program.methods
        .depositFunds(new BN(500_000_000))
        .accounts({
          owner: owner.publicKey,
          vault: ringVaultPda,
          mint: usdcMint,
          ownerTokenAccount: ownerUsdcAta,
          vaultTokenAccount: ringVaultUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    });

    it("51+ transactions → oldest evicted, newest preserved, count stays at 50", async () => {
      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), ringVaultPda.toBuffer(), ringAgent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );

      // Execute 51 authorize+finalize cycles
      for (let i = 0; i < 51; i++) {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            usdcMint,
            new BN(1_000_000), // 1 USDC each
            jupiterProgramId,
            null
          )
          .accounts({
            agent: ringAgent.publicKey,
            vault: ringVaultPda,
            policy: ringPolicyPda,
            tracker: ringTrackerPda,
            session: sessionPda,
            vaultTokenAccount: ringVaultUsdcAta,
            tokenMintAccount: usdcMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([ringAgent])
          .rpc();

        await program.methods
          .finalizeSession(true)
          .accounts({
            payer: ringAgent.publicKey,
            vault: ringVaultPda,
            policy: ringPolicyPda,
            tracker: ringTrackerPda,
            session: sessionPda,
            sessionRentRecipient: ringAgent.publicKey,
            vaultTokenAccount: ringVaultUsdcAta,
            feeDestinationTokenAccount: null,
            protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([ringAgent])
          .rpc();
      }

      const tracker = await program.account.spendTracker.fetch(ringTrackerPda);
      // Ring buffer capped at 50
      expect(tracker.recentTransactions.length).to.equal(50);

      // Newest entry should be the last one we added
      const newest = tracker.recentTransactions[tracker.recentTransactions.length - 1];
      expect(newest.success).to.equal(true);
      expect(newest.amount.toNumber()).to.equal(1_000_000);

      // Vault should show 51 total transactions
      const vault = await program.account.agentVault.fetch(ringVaultPda);
      expect(vault.totalTransactions.toNumber()).to.equal(51);
    });
  });

  // =========================================================================
  // Tier 2b: Fee precision edge cases
  // =========================================================================
  describe("fee precision edge cases", () => {
    const feeEdgeVaultId = new BN(80);
    let feeEdgeVaultPda: PublicKey;
    let feeEdgePolicyPda: PublicKey;
    let feeEdgeTrackerPda: PublicKey;
    let feeEdgeVaultUsdcAta: PublicKey;
    const feeEdgeAgent = Keypair.generate();

    before(async () => {
      airdropSol(svm, feeEdgeAgent.publicKey, 5 * LAMPORTS_PER_SOL);

      [feeEdgeVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), feeEdgeVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [feeEdgePolicyPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), feeEdgeVaultPda.toBuffer()],
        program.programId
      );
      [feeEdgeTrackerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), feeEdgeVaultPda.toBuffer()],
        program.programId
      );

      // developer_fee_rate = 0 to isolate protocol fee
      await program.methods
        .initializeVault(
          feeEdgeVaultId,
          new BN(999_000_000),
          new BN(100_000_000),
          [makeAllowedToken(usdcMint)],
          [jupiterProgramId],
          new BN(0) as any,
          3,
          0, // developer_fee_rate = 0
          new BN(0),
          [],
          0, // tracker_tier: Standard
        )
        .accounts({
          owner: owner.publicKey,
          vault: feeEdgeVaultPda,
          policy: feeEdgePolicyPda,
          tracker: feeEdgeTrackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      await program.methods
        .registerAgent(feeEdgeAgent.publicKey)
        .accounts({ owner: owner.publicKey, vault: feeEdgeVaultPda } as any)
        .rpc();

      feeEdgeVaultUsdcAta = anchor.utils.token.associatedAddress({
        mint: usdcMint,
        owner: feeEdgeVaultPda,
      });

      await program.methods
        .depositFunds(new BN(10_000_000))
        .accounts({
          owner: owner.publicKey,
          vault: feeEdgeVaultPda,
          mint: usdcMint,
          ownerTokenAccount: ownerUsdcAta,
          vaultTokenAccount: feeEdgeVaultUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    });

    it("amount = 1 lamport → protocol_fee = 0 → no fee transfer", async () => {
      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), feeEdgeVaultPda.toBuffer(), feeEdgeAgent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );

      // protocol_fee = 1 * 20 / 1_000_000 = 0
      await program.methods
        .validateAndAuthorize(
          { swap: {} },
          usdcMint,
          new BN(1), // 1 lamport
          jupiterProgramId,
          null
        )
        .accounts({
          agent: feeEdgeAgent.publicKey,
          vault: feeEdgeVaultPda,
          policy: feeEdgePolicyPda,
          tracker: feeEdgeTrackerPda,
          session: sessionPda,
          vaultTokenAccount: feeEdgeVaultUsdcAta,
          tokenMintAccount: usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([feeEdgeAgent])
        .rpc();

      const vaultBalBefore = getTokenBalance(svm, feeEdgeVaultUsdcAta);

      // Finalize — no token accounts needed since fees are 0
      await program.methods
        .finalizeSession(true)
        .accounts({
          payer: feeEdgeAgent.publicKey,
          vault: feeEdgeVaultPda,
          policy: feeEdgePolicyPda,
          tracker: feeEdgeTrackerPda,
          session: sessionPda,
          sessionRentRecipient: feeEdgeAgent.publicKey,
          vaultTokenAccount: null,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([feeEdgeAgent])
        .rpc();

      // Vault balance unchanged (no fee deducted)
      const vaultBalAfter = getTokenBalance(svm, feeEdgeVaultUsdcAta);
      expect(Number(vaultBalAfter)).to.equal(Number(vaultBalBefore));
    });

    it("amount = 49999 → fee = 0; amount = 50000 → fee = 1", async () => {
      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), feeEdgeVaultPda.toBuffer(), feeEdgeAgent.publicKey.toBuffer(), usdcMint.toBuffer()],
        program.programId
      );

      // Test amount = 49999: protocol_fee = 49999 * 20 / 1_000_000 = 0 (integer division)
      await program.methods
        .validateAndAuthorize(
          { swap: {} },
          usdcMint,
          new BN(49_999),
          jupiterProgramId,
          null
        )
        .accounts({
          agent: feeEdgeAgent.publicKey,
          vault: feeEdgeVaultPda,
          policy: feeEdgePolicyPda,
          tracker: feeEdgeTrackerPda,
          session: sessionPda,
          vaultTokenAccount: feeEdgeVaultUsdcAta,
          tokenMintAccount: usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([feeEdgeAgent])
        .rpc();

      // Finalize with no token accounts (fee=0)
      await program.methods
        .finalizeSession(true)
        .accounts({
          payer: feeEdgeAgent.publicKey,
          vault: feeEdgeVaultPda,
          policy: feeEdgePolicyPda,
          tracker: feeEdgeTrackerPda,
          session: sessionPda,
          sessionRentRecipient: feeEdgeAgent.publicKey,
          vaultTokenAccount: null,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: null,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([feeEdgeAgent])
        .rpc();

      // Test amount = 50000: protocol_fee = 50000 * 20 / 1_000_000 = 1
      await program.methods
        .validateAndAuthorize(
          { swap: {} },
          usdcMint,
          new BN(50_000),
          jupiterProgramId,
          null
        )
        .accounts({
          agent: feeEdgeAgent.publicKey,
          vault: feeEdgeVaultPda,
          policy: feeEdgePolicyPda,
          tracker: feeEdgeTrackerPda,
          session: sessionPda,
          vaultTokenAccount: feeEdgeVaultUsdcAta,
          tokenMintAccount: usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([feeEdgeAgent])
        .rpc();

      const vaultBalBefore = getTokenBalance(svm, feeEdgeVaultUsdcAta);

      // Finalize — needs token accounts since fee = 1
      await program.methods
        .finalizeSession(true)
        .accounts({
          payer: feeEdgeAgent.publicKey,
          vault: feeEdgeVaultPda,
          policy: feeEdgePolicyPda,
          tracker: feeEdgeTrackerPda,
          session: sessionPda,
          sessionRentRecipient: feeEdgeAgent.publicKey,
          vaultTokenAccount: feeEdgeVaultUsdcAta,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([feeEdgeAgent])
        .rpc();

      // Vault balance should decrease by exactly 1 (protocol fee)
      const vaultBalAfter = getTokenBalance(svm, feeEdgeVaultUsdcAta);
      expect(Number(vaultBalBefore) - Number(vaultBalAfter)).to.equal(1);
    });
  });

  // =========================================================================
  // Oracle Pricing (Pyth + Switchboard dual-oracle)
  // =========================================================================
  describe("Oracle Pricing", () => {
    // Pyth Receiver program ID
    const PYTH_RECEIVER_PROGRAM = new PublicKey(
      "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"
    );
    // Switchboard On-Demand program ID
    const SWITCHBOARD_ON_DEMAND_PROGRAM = new PublicKey(
      "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv"
    );

    // Oracle vault state
    const oracleVaultId = new BN(500);
    let oracleVaultPda: PublicKey;
    let oraclePolicyPda: PublicKey;
    let oracleTrackerPda: PublicKey;
    const oracleAgent = Keypair.generate();

    // SOL-like oracle-priced token (9 decimals)
    let oracleMint: PublicKey;
    let ownerOracleAta: PublicKey;
    let vaultOracleAta: PublicKey;

    // Mock oracle feed address
    const pythFeedKeypair = Keypair.generate();
    const switchboardFeedKeypair = Keypair.generate();

    /**
     * Build a mock Pyth PriceUpdateV2 account (133 bytes, Borsh-serialized).
     *
     * Layout:
     *   [0..8]    discriminator (8 bytes, zeros)
     *   [8..40]   write_authority (32 bytes)
     *   [40]      verification_level (1 byte: 0=Partial, 1=Full)
     *   [41..73]  feed_id (32 bytes)
     *   [73..81]  price (i64 LE)
     *   [81..89]  conf (u64 LE)
     *   [89..93]  exponent (i32 LE)
     *   [93..101] publish_time (i64 LE)
     *   [101..133] remaining fields (prev_publish_time, ema_price, ema_conf, posted_slot)
     */
    function createMockPythAccount(
      feedAddress: PublicKey,
      price: bigint,       // i64, e.g. 15000000000n for $150 with exponent -8
      conf: bigint,        // u64, confidence interval
      exponent: number,    // i32, typically -8
      publishTime: bigint, // i64, unix timestamp in seconds
      verificationLevel: number = 1, // 1 = Full (Wormhole verified)
      postedSlot?: bigint, // u64, slot when price was posted (offset 125)
    ): void {
      const data = Buffer.alloc(133);
      // discriminator [0..8] — zeros
      // write_authority [8..40] — zeros
      // verification_level [40]
      data.writeUInt8(verificationLevel, 40);
      // feed_id [41..73] — zeros
      // price [73..81]
      data.writeBigInt64LE(price, 73);
      // conf [81..89]
      data.writeBigUInt64LE(conf, 81);
      // exponent [89..93]
      data.writeInt32LE(exponent, 89);
      // publish_time [93..101]
      data.writeBigInt64LE(publishTime, 93);
      // posted_slot [125..133] — used for slot-based staleness check
      if (postedSlot !== undefined) {
        data.writeBigUInt64LE(postedSlot, 125);
      }

      svm.setAccount(feedAddress, {
        lamports: 1_000_000,
        data,
        owner: PYTH_RECEIVER_PROGRAM,
        executable: false,
      });
    }

    /**
     * Build a mock Switchboard PullFeed account (discriminator + 32 submissions).
     * Each submission: [oracle(32) | slot(8) | padding(8) | value(16)] = 64 bytes.
     */
    function createMockSwitchboardAccount(
      feedAddress: PublicKey,
      priceI128: bigint, // i128 with 18 implicit decimals
      currentSlot: bigint,
      numSamples: number = 5,
    ): void {
      const DISC = 8;
      const STRIDE = 64;
      const data = Buffer.alloc(DISC + 32 * STRIDE);

      for (let i = 0; i < numSamples; i++) {
        const base = DISC + i * STRIDE;
        // oracle pubkey — non-zero (use index as fill byte)
        data.fill(i + 1, base, base + 32);
        // slot (u64 LE)
        data.writeBigUInt64LE(currentSlot, base + 32);
        // padding (8 bytes, zeros)
        // value (i128 LE) — write as two 64-bit halves
        const low = priceI128 & 0xFFFFFFFFFFFFFFFFn;
        const high = (priceI128 >> 64n) & 0xFFFFFFFFFFFFFFFFn;
        data.writeBigUInt64LE(low, base + 48);
        data.writeBigInt64LE(high, base + 56);
      }

      svm.setAccount(feedAddress, {
        lamports: 1_000_000,
        data,
        owner: SWITCHBOARD_ON_DEMAND_PROGRAM,
        executable: false,
      });
    }

    // Protocol treasury ATA for oracle mint
    let protocolTreasuryOracleAta: PublicKey;

    before(async () => {
      // Airdrop
      airdropSol(svm, oracleAgent.publicKey, 10 * LAMPORTS_PER_SOL);

      // Create oracle-priced token (9 decimals, SOL-like)
      oracleMint = createMintHelper(
        svm,
        (owner as any).payer,
        owner.publicKey,
        9
      );

      // Create owner ATA and mint tokens
      ownerOracleAta = createAtaHelper(
        svm,
        (owner as any).payer,
        oracleMint,
        owner.publicKey
      );
      mintToHelper(
        svm,
        (owner as any).payer,
        oracleMint,
        ownerOracleAta,
        owner.publicKey,
        10_000_000_000n // 10 tokens (9 decimals)
      );

      // Create protocol treasury ATA for oracle mint (needed for fee transfers)
      protocolTreasuryOracleAta = createAtaIdempotentHelper(
        svm,
        (owner as any).payer,
        oracleMint,
        protocolTreasury,
        true
      );

      // Derive oracle vault PDAs
      [oracleVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), oracleVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [oraclePolicyPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), oracleVaultPda.toBuffer()],
        program.programId
      );
      [oracleTrackerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), oracleVaultPda.toBuffer()],
        program.programId
      );

      // Initialize vault with oracle-priced token (Pyth feed) and stablecoin
      await program.methods
        .initializeVault(
          oracleVaultId,
          new BN(10_000_000_000), // $10,000 daily cap
          new BN(1_000_000_000),  // $1,000 max tx
          [
            makeAllowedToken(oracleMint, pythFeedKeypair.publicKey, 9),
            makeAllowedToken(usdcMint),
          ],
          [jupiterProgramId],
          new BN(0) as any,
          3,
          0,
          new BN(0),
          [],
          0, // tracker_tier: Standard
        )
        .accounts({
          owner: owner.publicKey,
          vault: oracleVaultPda,
          policy: oraclePolicyPda,
          tracker: oracleTrackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Register agent
      await program.methods
        .registerAgent(oracleAgent.publicKey)
        .accounts({
          owner: owner.publicKey,
          vault: oracleVaultPda,
        } as any)
        .rpc();

      // Create vault ATA for oracle-priced token and deposit
      vaultOracleAta = createAtaIdempotentHelper(
        svm,
        (owner as any).payer,
        oracleMint,
        oracleVaultPda,
        true
      );

      await program.methods
        .depositFunds(new BN(5_000_000_000)) // 5 tokens
        .accounts({
          owner: owner.publicKey,
          vault: oracleVaultPda,
          mint: oracleMint,
          ownerTokenAccount: ownerOracleAta,
          vaultTokenAccount: vaultOracleAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
    });

    it("Pyth oracle pricing — correct USD conversion", async () => {
      // SOL/USD = $150.00 (price=15000000000, exponent=-8)
      // 1 SOL (1_000_000_000 base units) at $150 = $150 USD = 150_000_000 (6 decimals)
      const clock = svm.getClock();
      createMockPythAccount(
        pythFeedKeypair.publicKey,
        15_000_000_000n,  // price i64 ($150 with 8 decimal places)
        50_000_000n,       // conf (low: ~0.33% of price)
        -8,                // exponent
        clock.unixTimestamp, // fresh publish_time
        1,                   // Full verification
        clock.slot           // fresh posted_slot
      );

      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), oracleVaultPda.toBuffer(), oracleAgent.publicKey.toBuffer(), oracleMint.toBuffer()],
        program.programId
      );

      await program.methods
        .validateAndAuthorize(
          { swap: {} },
          oracleMint,
          new BN(1_000_000_000), // 1 token (9 decimals)
          jupiterProgramId,
          null
        )
        .accounts({
          agent: oracleAgent.publicKey,
          vault: oracleVaultPda,
          policy: oraclePolicyPda,
          tracker: oracleTrackerPda,
          session: sessionPda,
          vaultTokenAccount: vaultOracleAta,
          tokenMintAccount: oracleMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .remainingAccounts([
          { pubkey: pythFeedKeypair.publicKey, isWritable: false, isSigner: false },
        ])
        .signers([oracleAgent])
        .rpc();

      // Verify session was created with correct USD amount
      const session = await program.account.sessionAuthority.fetch(sessionPda);
      expect(session.authorized).to.equal(true);
      expect(session.authorizedAmount.toNumber()).to.equal(1_000_000_000);

      // Check tracker recorded correct USD value
      const tracker = await program.account.spendTracker.fetch(oracleTrackerPda);
      const lastSpend = tracker.rollingSpends[tracker.rollingSpends.length - 1];
      // 1 token * $150 = $150 = 150_000_000 in USD-6
      expect(lastSpend.usdAmount.toNumber()).to.equal(150_000_000);

      // Clean up: finalize session (pass treasury ATA for protocol fee)
      await program.methods
        .finalizeSession(true)
        .accounts({
          payer: oracleAgent.publicKey,
          vault: oracleVaultPda,
          policy: oraclePolicyPda,
          tracker: oracleTrackerPda,
          session: sessionPda,
          sessionRentRecipient: oracleAgent.publicKey,
          vaultTokenAccount: vaultOracleAta,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: protocolTreasuryOracleAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([oracleAgent])
        .rpc();
    });

    it("Switchboard oracle pricing — correct USD conversion", async () => {
      // SOL/USD = $150.00 as i128 with 18 decimals
      // $150 = 150 * 10^18 = 150_000_000_000_000_000_000
      const clock = svm.getClock();
      const priceI128 = 150_000_000_000_000_000_000n;

      // Update policy to use Switchboard feed for this token
      await program.methods
        .updatePolicy(
          null, null,
          [
            makeAllowedToken(oracleMint, switchboardFeedKeypair.publicKey, 9),
            makeAllowedToken(usdcMint),
          ],
          null, null, null, null, null, null, null
        )
        .accounts({
          owner: owner.publicKey,
          vault: oracleVaultPda,
          policy: oraclePolicyPda,
          tracker: oracleTrackerPda,
        } as any)
        .rpc();

      createMockSwitchboardAccount(
        switchboardFeedKeypair.publicKey,
        priceI128,
        clock.slot
      );

      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), oracleVaultPda.toBuffer(), oracleAgent.publicKey.toBuffer(), oracleMint.toBuffer()],
        program.programId
      );

      await program.methods
        .validateAndAuthorize(
          { swap: {} },
          oracleMint,
          new BN(1_000_000_000), // 1 token
          jupiterProgramId,
          null
        )
        .accounts({
          agent: oracleAgent.publicKey,
          vault: oracleVaultPda,
          policy: oraclePolicyPda,
          tracker: oracleTrackerPda,
          session: sessionPda,
          vaultTokenAccount: vaultOracleAta,
          tokenMintAccount: oracleMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .remainingAccounts([
          { pubkey: switchboardFeedKeypair.publicKey, isWritable: false, isSigner: false },
        ])
        .signers([oracleAgent])
        .rpc();

      const tracker = await program.account.spendTracker.fetch(oracleTrackerPda);
      const lastSpend = tracker.rollingSpends[tracker.rollingSpends.length - 1];
      expect(lastSpend.usdAmount.toNumber()).to.equal(150_000_000);

      // Finalize (pass treasury ATA for protocol fee)
      await program.methods
        .finalizeSession(true)
        .accounts({
          payer: oracleAgent.publicKey,
          vault: oracleVaultPda,
          policy: oraclePolicyPda,
          tracker: oracleTrackerPda,
          session: sessionPda,
          sessionRentRecipient: oracleAgent.publicKey,
          vaultTokenAccount: vaultOracleAta,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: protocolTreasuryOracleAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([oracleAgent])
        .rpc();

      // Restore policy to Pyth for subsequent tests
      await program.methods
        .updatePolicy(
          null, null,
          [
            makeAllowedToken(oracleMint, pythFeedKeypair.publicKey, 9),
            makeAllowedToken(usdcMint),
          ],
          null, null, null, null, null, null, null
        )
        .accounts({
          owner: owner.publicKey,
          vault: oracleVaultPda,
          policy: oraclePolicyPda,
          tracker: oracleTrackerPda,
        } as any)
        .rpc();
    });

    it("stale Pyth feed — rejects with OracleFeedStale", async () => {
      // Advance slot past 200 so staleness check is meaningful
      advancePastSlot(svm, 300);
      const clock = svm.getClock();
      // Set posted_slot to 0 (stale: current_slot ~301 > 100 + 0)
      createMockPythAccount(
        pythFeedKeypair.publicKey,
        15_000_000_000n,
        50_000_000n,
        -8,
        clock.unixTimestamp,
        1,  // Full verification
        0n  // slot 0 — stale
      );

      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), oracleVaultPda.toBuffer(), oracleAgent.publicKey.toBuffer(), oracleMint.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            oracleMint,
            new BN(100_000_000),
            jupiterProgramId,
            null
          )
          .accounts({
            agent: oracleAgent.publicKey,
            vault: oracleVaultPda,
            policy: oraclePolicyPda,
            tracker: oracleTrackerPda,
            session: sessionPda,
            vaultTokenAccount: vaultOracleAta,
            tokenMintAccount: oracleMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .remainingAccounts([
            { pubkey: pythFeedKeypair.publicKey, isWritable: false, isSigner: false },
          ])
          .signers([oracleAgent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("OracleFeedStale");
      }
    });

    it("wide confidence Pyth feed — rejects with OracleConfidenceTooWide", async () => {
      const clock = svm.getClock();
      // conf = 20% of price (2000 BPS > MAX_CONFIDENCE_BPS of 1000)
      createMockPythAccount(
        pythFeedKeypair.publicKey,
        15_000_000_000n,
        3_000_000_000n, // 20% of price → way over 10%
        -8,
        clock.unixTimestamp,
        1,              // Full verification
        clock.slot      // fresh posted_slot
      );

      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), oracleVaultPda.toBuffer(), oracleAgent.publicKey.toBuffer(), oracleMint.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            oracleMint,
            new BN(100_000_000),
            jupiterProgramId,
            null
          )
          .accounts({
            agent: oracleAgent.publicKey,
            vault: oracleVaultPda,
            policy: oraclePolicyPda,
            tracker: oracleTrackerPda,
            session: sessionPda,
            vaultTokenAccount: vaultOracleAta,
            tokenMintAccount: oracleMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .remainingAccounts([
            { pubkey: pythFeedKeypair.publicKey, isWritable: false, isSigner: false },
          ])
          .signers([oracleAgent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("OracleConfidenceTooWide");
      }
    });

    it("unverified Pyth feed — rejects with OracleNotVerified", async () => {
      const clock = svm.getClock();
      // verification_level = 0 (Partial, not Wormhole-verified)
      createMockPythAccount(
        pythFeedKeypair.publicKey,
        15_000_000_000n,
        50_000_000n,
        -8,
        clock.unixTimestamp,
        0,          // Partial — not verified
        clock.slot  // fresh posted_slot
      );

      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), oracleVaultPda.toBuffer(), oracleAgent.publicKey.toBuffer(), oracleMint.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            oracleMint,
            new BN(100_000_000),
            jupiterProgramId,
            null
          )
          .accounts({
            agent: oracleAgent.publicKey,
            vault: oracleVaultPda,
            policy: oraclePolicyPda,
            tracker: oracleTrackerPda,
            session: sessionPda,
            vaultTokenAccount: vaultOracleAta,
            tokenMintAccount: oracleMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .remainingAccounts([
            { pubkey: pythFeedKeypair.publicKey, isWritable: false, isSigner: false },
          ])
          .signers([oracleAgent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("OracleNotVerified");
      }
    });

    it("unknown oracle owner — rejects with OracleUnsupportedType", async () => {
      // Create an account with a random owner (not Pyth or Switchboard)
      const unknownFeed = Keypair.generate();
      const data = Buffer.alloc(133);
      svm.setAccount(unknownFeed.publicKey, {
        lamports: 1_000_000,
        data,
        owner: SystemProgram.programId, // wrong owner
        executable: false,
      });

      // Update policy to reference this unknown feed
      await program.methods
        .updatePolicy(
          null, null,
          [
            makeAllowedToken(oracleMint, unknownFeed.publicKey, 9),
            makeAllowedToken(usdcMint),
          ],
          null, null, null, null, null, null, null
        )
        .accounts({
          owner: owner.publicKey,
          vault: oracleVaultPda,
          policy: oraclePolicyPda,
          tracker: oracleTrackerPda,
        } as any)
        .rpc();

      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), oracleVaultPda.toBuffer(), oracleAgent.publicKey.toBuffer(), oracleMint.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            oracleMint,
            new BN(100_000_000),
            jupiterProgramId,
            null
          )
          .accounts({
            agent: oracleAgent.publicKey,
            vault: oracleVaultPda,
            policy: oraclePolicyPda,
            tracker: oracleTrackerPda,
            session: sessionPda,
            vaultTokenAccount: vaultOracleAta,
            tokenMintAccount: oracleMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .remainingAccounts([
            { pubkey: unknownFeed.publicKey, isWritable: false, isSigner: false },
          ])
          .signers([oracleAgent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("OracleUnsupportedType");
      }

      // Restore policy to Pyth feed
      await program.methods
        .updatePolicy(
          null, null,
          [
            makeAllowedToken(oracleMint, pythFeedKeypair.publicKey, 9),
            makeAllowedToken(usdcMint),
          ],
          null, null, null, null, null, null, null
        )
        .accounts({
          owner: owner.publicKey,
          vault: oracleVaultPda,
          policy: oraclePolicyPda,
          tracker: oracleTrackerPda,
        } as any)
        .rpc();
    });

    it("missing oracle account for oracle-priced token — rejects with OracleAccountMissing", async () => {
      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("session"), oracleVaultPda.toBuffer(), oracleAgent.publicKey.toBuffer(), oracleMint.toBuffer()],
        program.programId
      );

      try {
        // No remainingAccounts — oracle feed not provided
        await program.methods
          .validateAndAuthorize(
            { swap: {} },
            oracleMint,
            new BN(100_000_000),
            jupiterProgramId,
            null
          )
          .accounts({
            agent: oracleAgent.publicKey,
            vault: oracleVaultPda,
            policy: oraclePolicyPda,
            tracker: oracleTrackerPda,
            session: sessionPda,
            vaultTokenAccount: vaultOracleAta,
            tokenMintAccount: oracleMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([oracleAgent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("OracleAccountMissing");
      }
    });
  });

  // =========================================================================
  // Timelock policy changes
  // =========================================================================
  describe("timelock policy changes", () => {
    const tlVaultId = new BN(600);
    let tlVaultPda: PublicKey;
    let tlPolicyPda: PublicKey;
    let tlTrackerPda: PublicKey;
    let tlPendingPda: PublicKey;
    const tlAgent = Keypair.generate();

    before(async () => {
      airdropSol(svm, tlAgent.publicKey, 5 * LAMPORTS_PER_SOL);

      [tlVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), tlVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [tlPolicyPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), tlVaultPda.toBuffer()],
        program.programId
      );
      [tlTrackerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), tlVaultPda.toBuffer()],
        program.programId
      );
      [tlPendingPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pending_policy"), tlVaultPda.toBuffer()],
        program.programId
      );

      // Create vault WITH timelock (60 seconds)
      await program.methods
        .initializeVault(
          tlVaultId,
          new BN(500_000_000),
          new BN(100_000_000),
          [makeAllowedToken(usdcMint)],
          [jupiterProgramId],
          new BN(0) as any,
          3,
          0,
          new BN(60), // 60 second timelock
          [],
          0, // tracker_tier: Standard
        )
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          policy: tlPolicyPda,
          tracker: tlTrackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      await program.methods
        .registerAgent(tlAgent.publicKey)
        .accounts({ owner: owner.publicKey, vault: tlVaultPda } as any)
        .rpc();
    });

    it("immediate update_policy blocked when timelock > 0", async () => {
      try {
        await program.methods
          .updatePolicy(
            new BN(999), null, null, null, null, null, null, null, null, null
          )
          .accounts({
            owner: owner.publicKey,
            vault: tlVaultPda,
            policy: tlPolicyPda,
            tracker: tlTrackerPda,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("TimelockActive");
      }
    });

    it("queue policy update succeeds when timelock > 0", async () => {
      await program.methods
        .queuePolicyUpdate(
          new BN(200_000_000), // new daily cap
          null, null, null, null, null, null, null, null, null
        )
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          policy: tlPolicyPda,
          pendingPolicy: tlPendingPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const pending = await program.account.pendingPolicyUpdate.fetch(tlPendingPda);
      expect(pending.vault.toString()).to.equal(tlVaultPda.toString());
      expect(pending.dailySpendingCapUsd.toNumber()).to.equal(200_000_000);
      expect(pending.executesAt.toNumber()).to.be.greaterThan(pending.queuedAt.toNumber());
    });

    it("apply fails before timelock expires", async () => {
      try {
        await program.methods
          .applyPendingPolicy()
          .accounts({
            owner: owner.publicKey,
            vault: tlVaultPda,
            policy: tlPolicyPda,
            tracker: tlTrackerPda,
            pendingPolicy: tlPendingPda,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("TimelockNotExpired");
      }
    });

    it("apply succeeds after timelock expires", async () => {
      // Advance time past timelock (60 seconds + buffer)
      advanceTime(svm, 61);

      await program.methods
        .applyPendingPolicy()
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          policy: tlPolicyPda,
          tracker: tlTrackerPda,
          pendingPolicy: tlPendingPda,
        } as any)
        .rpc();

      // Verify policy was updated
      const policy = await program.account.policyConfig.fetch(tlPolicyPda);
      expect(policy.dailySpendingCapUsd.toNumber()).to.equal(200_000_000);

      // Pending PDA should be closed
      try {
        await program.account.pendingPolicyUpdate.fetch(tlPendingPda);
        expect.fail("PendingPolicyUpdate should have been closed");
      } catch (err: any) {
        expect(err.toString()).to.satisfy(
          (s: string) => s.includes("Account does not exist") || s.includes("Could not find")
        );
      }
    });

    it("cancel pending policy succeeds and returns rent", async () => {
      // Queue another update
      await program.methods
        .queuePolicyUpdate(
          new BN(300_000_000), null, null, null, null, null, null, null, null, null
        )
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          policy: tlPolicyPda,
          pendingPolicy: tlPendingPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      const ownerBalBefore = getBalance(svm, owner.publicKey);

      await program.methods
        .cancelPendingPolicy()
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          pendingPolicy: tlPendingPda,
        } as any)
        .rpc();

      // Rent should be returned
      const ownerBalAfter = getBalance(svm, owner.publicKey);
      expect(ownerBalAfter).to.be.greaterThan(ownerBalBefore);

      // Policy unchanged
      const policy = await program.account.policyConfig.fetch(tlPolicyPda);
      expect(policy.dailySpendingCapUsd.toNumber()).to.equal(200_000_000);
    });

    it("only one pending update at a time (init fails if PDA exists)", async () => {
      // Queue an update
      await program.methods
        .queuePolicyUpdate(
          new BN(400_000_000), null, null, null, null, null, null, null, null, null
        )
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          policy: tlPolicyPda,
          pendingPolicy: tlPendingPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Try to queue another (should fail — PDA already exists)
      try {
        await program.methods
          .queuePolicyUpdate(
            new BN(500_000_000), null, null, null, null, null, null, null, null, null
          )
          .accounts({
            owner: owner.publicKey,
            vault: tlVaultPda,
            policy: tlPolicyPda,
            pendingPolicy: tlPendingPda,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Anchor init constraint fails when PDA already exists
        expect(err.toString()).to.not.include("Should have thrown");
      }

      // Clean up
      await program.methods
        .cancelPendingPolicy()
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          pendingPolicy: tlPendingPda,
        } as any)
        .rpc();
    });

    it("queue fails when timelock = 0 (NoTimelockConfigured)", async () => {
      // Create a vault with timelock = 0
      const noTlVaultId = new BN(601);
      const [noTlVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), noTlVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [noTlPolicy] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), noTlVault.toBuffer()],
        program.programId
      );
      const [noTlTracker] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), noTlVault.toBuffer()],
        program.programId
      );
      const [noTlPending] = PublicKey.findProgramAddressSync(
        [Buffer.from("pending_policy"), noTlVault.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(
          noTlVaultId, new BN(1000), new BN(1000), [] as any[], [],
          new BN(0) as any, 1, 0, new BN(0), [],
          0, // tracker_tier: Standard
        )
        .accounts({
          owner: owner.publicKey,
          vault: noTlVault,
          policy: noTlPolicy,
          tracker: noTlTracker,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      try {
        await program.methods
          .queuePolicyUpdate(
            new BN(999), null, null, null, null, null, null, null, null, null
          )
          .accounts({
            owner: owner.publicKey,
            vault: noTlVault,
            policy: noTlPolicy,
            pendingPolicy: noTlPending,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("NoTimelockConfigured");
      }
    });

    it("changing timelock_duration itself goes through queue", async () => {
      // Queue a timelock change from 60 to 120
      await program.methods
        .queuePolicyUpdate(
          null, null, null, null, null, null, null, null,
          new BN(120), // new timelock_duration
          null
        )
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          policy: tlPolicyPda,
          pendingPolicy: tlPendingPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      advanceTime(svm, 61);

      await program.methods
        .applyPendingPolicy()
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          policy: tlPolicyPda,
          tracker: tlTrackerPda,
          pendingPolicy: tlPendingPda,
        } as any)
        .rpc();

      const policy = await program.account.policyConfig.fetch(tlPolicyPda);
      expect(policy.timelockDuration.toNumber()).to.equal(120);
    });

    it("setting timelock to 0 via queue (disabling)", async () => {
      // Queue timelock disable (set to 0)
      await program.methods
        .queuePolicyUpdate(
          null, null, null, null, null, null, null, null,
          new BN(0), // disable timelock
          null
        )
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          policy: tlPolicyPda,
          pendingPolicy: tlPendingPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      advanceTime(svm, 121);

      await program.methods
        .applyPendingPolicy()
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          policy: tlPolicyPda,
          tracker: tlTrackerPda,
          pendingPolicy: tlPendingPda,
        } as any)
        .rpc();

      const policy = await program.account.policyConfig.fetch(tlPolicyPda);
      expect(policy.timelockDuration.toNumber()).to.equal(0);

      // Now immediate update should work
      await program.methods
        .updatePolicy(
          new BN(999_000_000), null, null, null, null, null, null, null, null, null
        )
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          policy: tlPolicyPda,
          tracker: tlTrackerPda,
        } as any)
        .rpc();

      const updated = await program.account.policyConfig.fetch(tlPolicyPda);
      expect(updated.dailySpendingCapUsd.toNumber()).to.equal(999_000_000);
    });

    it("revoke_agent bypasses timelock (emergency)", async () => {
      // Re-enable timelock
      await program.methods
        .updatePolicy(
          null, null, null, null, null, null, null, null, new BN(60), null
        )
        .accounts({
          owner: owner.publicKey,
          vault: tlVaultPda,
          policy: tlPolicyPda,
          tracker: tlTrackerPda,
        } as any)
        .rpc();

      // Revoke agent should work immediately (no timelock)
      await program.methods
        .revokeAgent()
        .accounts({ owner: owner.publicKey, vault: tlVaultPda } as any)
        .rpc();

      const vault = await program.account.agentVault.fetch(tlVaultPda);
      expect(JSON.stringify(vault.status)).to.include("frozen");
    });
  });

  // =========================================================================
  // Destination allowlist + agent_transfer
  // =========================================================================
  describe("destination allowlist & agent_transfer", () => {
    const destVaultId = new BN(510);
    let destVaultPda: PublicKey;
    let destPolicyPda: PublicKey;
    let destTrackerPda: PublicKey;
    const destAgent = Keypair.generate();
    const allowedDest = Keypair.generate();
    const blockedDest = Keypair.generate();
    let destVaultUsdcAta: PublicKey;
    let allowedDestAta: PublicKey;
    let blockedDestAta: PublicKey;

    before(async () => {
      airdropSol(svm, destAgent.publicKey, 5 * LAMPORTS_PER_SOL);
      airdropSol(svm, allowedDest.publicKey, 2 * LAMPORTS_PER_SOL);
      airdropSol(svm, blockedDest.publicKey, 2 * LAMPORTS_PER_SOL);

      [destVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), destVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      [destPolicyPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), destVaultPda.toBuffer()],
        program.programId
      );
      [destTrackerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), destVaultPda.toBuffer()],
        program.programId
      );

      // Create vault with destination allowlist
      await program.methods
        .initializeVault(
          destVaultId,
          new BN(500_000_000), // 500 USDC daily cap
          new BN(100_000_000), // 100 USDC max tx
          [makeAllowedToken(usdcMint)],
          [jupiterProgramId],
          new BN(0) as any,
          3,
          0,
          new BN(0), // no timelock
          [allowedDest.publicKey], // only allow transfers to this address
          0, // tracker_tier: Standard
        )
        .accounts({
          owner: owner.publicKey,
          vault: destVaultPda,
          policy: destPolicyPda,
          tracker: destTrackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      await program.methods
        .registerAgent(destAgent.publicKey)
        .accounts({ owner: owner.publicKey, vault: destVaultPda } as any)
        .rpc();

      // Deposit USDC
      destVaultUsdcAta = getAssociatedTokenAddressSync(usdcMint, destVaultPda, true);
      await program.methods
        .depositFunds(new BN(600_000_000)) // 600 USDC
        .accounts({
          owner: owner.publicKey,
          vault: destVaultPda,
          mint: usdcMint,
          ownerTokenAccount: ownerUsdcAta,
          vaultTokenAccount: destVaultUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Create destination ATAs
      allowedDestAta = createAtaHelper(
        svm, (owner as any).payer, usdcMint, allowedDest.publicKey
      );
      blockedDestAta = createAtaHelper(
        svm, (owner as any).payer, usdcMint, blockedDest.publicKey
      );
    });

    it("agent_transfer to allowed destination succeeds", async () => {
      const balBefore = getTokenBalance(svm, allowedDestAta);

      await program.methods
        .agentTransfer(new BN(10_000_000)) // 10 USDC
        .accounts({
          agent: destAgent.publicKey,
          vault: destVaultPda,
          policy: destPolicyPda,
          tracker: destTrackerPda,
          vaultTokenAccount: destVaultUsdcAta,
          destinationTokenAccount: allowedDestAta,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([destAgent])
        .rpc();

      // Transfer is net of fees — protocol fee = 10_000_000 * 20 / 1_000_000 = 200
      // developer fee = 0 (rate is 0), so net = 10_000_000 - 200 = 9_999_800
      const balAfter = getTokenBalance(svm, allowedDestAta);
      expect(Number(balAfter) - Number(balBefore)).to.equal(9_999_800);
    });

    it("agent_transfer to non-allowed destination fails", async () => {
      try {
        await program.methods
          .agentTransfer(new BN(10_000_000))
          .accounts({
            agent: destAgent.publicKey,
            vault: destVaultPda,
            policy: destPolicyPda,
            tracker: destTrackerPda,
            vaultTokenAccount: destVaultUsdcAta,
            destinationTokenAccount: blockedDestAta,
            feeDestinationTokenAccount: null,
            protocolTreasuryTokenAccount: null,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .signers([destAgent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("DestinationNotAllowed");
      }
    });

    it("empty allowlist = any destination allowed", async () => {
      // Create vault with empty allowlist
      const anyDestVaultId = new BN(511);
      const [anyVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), anyDestVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [anyPolicy] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), anyVault.toBuffer()],
        program.programId
      );
      const [anyTracker] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), anyVault.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(
          anyDestVaultId, new BN(500_000_000), new BN(100_000_000),
          [makeAllowedToken(usdcMint)], [jupiterProgramId],
          new BN(0) as any, 3, 0, new BN(0), [], // empty allowlist
          0, // tracker_tier: Standard
        )
        .accounts({
          owner: owner.publicKey,
          vault: anyVault,
          policy: anyPolicy,
          tracker: anyTracker,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      await program.methods
        .registerAgent(destAgent.publicKey)
        .accounts({ owner: owner.publicKey, vault: anyVault } as any)
        .rpc();

      const anyVaultAta = getAssociatedTokenAddressSync(usdcMint, anyVault, true);
      await program.methods
        .depositFunds(new BN(50_000_000))
        .accounts({
          owner: owner.publicKey,
          vault: anyVault,
          mint: usdcMint,
          ownerTokenAccount: ownerUsdcAta,
          vaultTokenAccount: anyVaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Transfer to any destination should work
      await program.methods
        .agentTransfer(new BN(5_000_000))
        .accounts({
          agent: destAgent.publicKey,
          vault: anyVault,
          policy: anyPolicy,
          tracker: anyTracker,
          vaultTokenAccount: anyVaultAta,
          destinationTokenAccount: blockedDestAta,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([destAgent])
        .rpc();
    });

    it("too many destinations on init fails", async () => {
      const badVid = new BN(512);
      const [bv] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), badVid.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [bp] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), bv.toBuffer()],
        program.programId
      );
      const [bt] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), bv.toBuffer()],
        program.programId
      );

      // Generate 11 destinations (max is 10)
      const tooMany = Array.from({ length: 11 }, () => Keypair.generate().publicKey);

      try {
        await program.methods
          .initializeVault(
            badVid, new BN(1000), new BN(1000), [] as any[], [],
            new BN(0) as any, 1, 0, new BN(0), tooMany,
            0, // tracker_tier: Standard
          )
          .accounts({
            owner: owner.publicKey,
            vault: bv,
            policy: bp,
            tracker: bt,
            feeDestination: feeDestination.publicKey,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("TooManyDestinations");
      }
    });

    it("agent_transfer respects daily spending cap", async () => {
      // The destVault has 500 USDC daily cap and 100 USDC max-tx.
      // We already spent 10 USDC. Make 4 more transfers of 100 USDC
      // to bring total to 410 USDC, then try 100 USDC which would
      // push total to 510 USDC (exceeding 500 cap).
      for (let i = 0; i < 4; i++) {
        await program.methods
          .agentTransfer(new BN(100_000_000)) // 100 USDC each
          .accounts({
            agent: destAgent.publicKey,
            vault: destVaultPda,
            policy: destPolicyPda,
            tracker: destTrackerPda,
            vaultTokenAccount: destVaultUsdcAta,
            destinationTokenAccount: allowedDestAta,
            feeDestinationTokenAccount: null,
            protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .signers([destAgent])
          .rpc();
      }
      // Total spent: 10 + 4*100 = 410 USDC. Remaining: 90 USDC.
      // Try 100 USDC → total would be 510 > 500 cap
      try {
        await program.methods
          .agentTransfer(new BN(100_000_000)) // 100 USDC (would push past cap)
          .accounts({
            agent: destAgent.publicKey,
            vault: destVaultPda,
            policy: destPolicyPda,
            tracker: destTrackerPda,
            vaultTokenAccount: destVaultUsdcAta,
            destinationTokenAccount: allowedDestAta,
            feeDestinationTokenAccount: null,
            protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .signers([destAgent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("DailyCapExceeded");
      }
    });

    it("agent_transfer respects per-tx limit", async () => {
      // Max tx size is 100 USDC
      try {
        await program.methods
          .agentTransfer(new BN(101_000_000)) // 101 USDC (exceeds max tx)
          .accounts({
            agent: destAgent.publicKey,
            vault: destVaultPda,
            policy: destPolicyPda,
            tracker: destTrackerPda,
            vaultTokenAccount: destVaultUsdcAta,
            destinationTokenAccount: allowedDestAta,
            feeDestinationTokenAccount: null,
            protocolTreasuryTokenAccount: null,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .signers([destAgent])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.toString()).to.include("TransactionTooLarge");
      }
    });

    it("agent_transfer records in tracker audit log", async () => {
      const tracker = await program.account.spendTracker.fetch(destTrackerPda);
      const records = tracker.recentTransactions as any[];
      const transferRecords = records.filter((r: any) =>
        JSON.stringify(r.actionType).includes("transfer")
      );
      expect(transferRecords.length).to.be.greaterThan(0);
    });

    it("agent_transfer with fees (protocol + developer)", async () => {
      // Create a vault with developer fee
      const feeDestVaultId = new BN(513);
      const [fv] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.publicKey.toBuffer(), feeDestVaultId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const [fp] = PublicKey.findProgramAddressSync(
        [Buffer.from("policy"), fv.toBuffer()],
        program.programId
      );
      const [ft] = PublicKey.findProgramAddressSync(
        [Buffer.from("tracker"), fv.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVault(
          feeDestVaultId, new BN(500_000_000), new BN(100_000_000),
          [makeAllowedToken(usdcMint)], [jupiterProgramId],
          new BN(0) as any, 3, 50, // developer_fee_rate = 50 (0.5 BPS)
          new BN(0), [],
          0, // tracker_tier: Standard
        )
        .accounts({
          owner: owner.publicKey,
          vault: fv,
          policy: fp,
          tracker: ft,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      await program.methods
        .registerAgent(destAgent.publicKey)
        .accounts({ owner: owner.publicKey, vault: fv } as any)
        .rpc();

      const fvAta = getAssociatedTokenAddressSync(usdcMint, fv, true);
      await program.methods
        .depositFunds(new BN(100_000_000))
        .accounts({
          owner: owner.publicKey,
          vault: fv,
          mint: usdcMint,
          ownerTokenAccount: ownerUsdcAta,
          vaultTokenAccount: fvAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();

      // Create fee dest ATA if needed
      try {
        feeDestUsdcAta = createAtaHelper(svm, (owner as any).payer, usdcMint, feeDestination.publicKey);
      } catch {
        feeDestUsdcAta = getAssociatedTokenAddressSync(usdcMint, feeDestination.publicKey);
      }

      const destBalBefore = getTokenBalance(svm, allowedDestAta);

      // Transfer 10 USDC with fees
      // protocol_fee = 10_000_000 * 20 / 1_000_000 = 200
      // developer_fee = 10_000_000 * 50 / 1_000_000 = 500
      // net = 10_000_000 - 200 - 500 = 9_999_300
      await program.methods
        .agentTransfer(new BN(10_000_000))
        .accounts({
          agent: destAgent.publicKey,
          vault: fv,
          policy: fp,
          tracker: ft,
          vaultTokenAccount: fvAta,
          destinationTokenAccount: allowedDestAta,
          feeDestinationTokenAccount: feeDestUsdcAta,
          protocolTreasuryTokenAccount: protocolTreasuryUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([destAgent])
        .rpc();

      const destBalAfter = getTokenBalance(svm, allowedDestAta);
      expect(Number(destBalAfter) - Number(destBalBefore)).to.equal(9_999_300);

      // Check vault fees
      const vault = await program.account.agentVault.fetch(fv);
      expect(vault.totalFeesCollected.toNumber()).to.equal(500);
    });
  });
});
