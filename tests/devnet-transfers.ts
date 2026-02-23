/**
 * Devnet Transfer Tests — 10 tests (V2)
 *
 * Exercises agent_transfer: destination allowlist enforcement,
 * fee correctness, access control, spending cap interaction,
 * dynamic destination updates, and frozen vault behavior.
 *
 * V2: No makeAllowedToken. Tokens via OracleRegistry.
 *     agentTransfer requires oracleRegistry + tokenMintAccount accounts.
 *     Removed per-token max_tx_base test (V1 concept not in V2).
 */
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";
import {
  getDevnetProvider,
  nextVaultId,
  deriveOracleRegistryPda,
  initializeOracleRegistry,
  updateOracleRegistry,
  makeOracleEntry,
  createFullVault,
  fundKeypair,
  createTestMint,
  getTokenBalance,
  calculateFees,
  expectError,
  FullVaultResult,
} from "./helpers/devnet-setup";

describe("devnet-transfers", () => {
  const { provider, program, connection, owner } = getDevnetProvider();
  const payer = (owner as any).payer;

  const agent = Keypair.generate();
  const feeDestination = Keypair.generate();
  const jupiterProgramId = Keypair.generate().publicKey;
  const attacker = Keypair.generate();

  const destA = Keypair.generate();
  const destB = Keypair.generate();

  let mint: PublicKey;
  let destAAta: PublicKey;
  let destBAta: PublicKey;
  let oracleRegistryPda: PublicKey;

  // Vault with allowlist = [destA]
  let vaultAllowlist: FullVaultResult;
  // Vault with empty allowlist (any dest)
  let vaultAnyDest: FullVaultResult;

  before(async () => {
    await fundKeypair(provider, agent.publicKey);
    await fundKeypair(provider, attacker.publicKey);

    mint = await createTestMint(connection, payer, owner.publicKey, 6);

    // Initialize oracle registry with mint as stablecoin
    oracleRegistryPda = await initializeOracleRegistry(program, owner, [
      makeOracleEntry(mint),
    ]);

    // Create destination ATAs
    const ataA = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      destA.publicKey,
    );
    destAAta = ataA.address;
    const ataB = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      destB.publicKey,
    );
    destBAta = ataB.address;

    // Vault with destination allowlist
    vaultAllowlist = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint,
      vaultId: nextVaultId(6),
      dailyCap: new BN(500_000_000),
      maxTx: new BN(200_000_000),
      allowedProtocols: [jupiterProgramId],
      allowedDestinations: [destA.publicKey],
      devFeeRate: 500,
      depositAmount: new BN(1_000_000_000),
    });

    // Vault with empty allowlist (any destination)
    vaultAnyDest = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint,
      vaultId: nextVaultId(6),
      dailyCap: new BN(500_000_000),
      maxTx: new BN(200_000_000),
      allowedProtocols: [jupiterProgramId],
      allowedDestinations: [],
      depositAmount: new BN(1_000_000_000),
    });

    console.log("  Vault (allowlist):", vaultAllowlist.vaultPda.toString());
    console.log("  Vault (any dest):", vaultAnyDest.vaultPda.toString());
  });

  it("1. agent_transfer to allowed destination succeeds", async () => {
    const amount = 10_000_000; // 10 USDC
    const destBefore = await getTokenBalance(connection, destAAta);

    await program.methods
      .agentTransfer(new BN(amount))
      .accounts({
        agent: agent.publicKey,
        vault: vaultAllowlist.vaultPda,
        policy: vaultAllowlist.policyPda,
        tracker: vaultAllowlist.trackerPda,
        oracleRegistry: vaultAllowlist.oracleRegistryPda,
        vaultTokenAccount: vaultAllowlist.vaultTokenAta,
        tokenMintAccount: mint,
        destinationTokenAccount: destAAta,
        feeDestinationTokenAccount: vaultAllowlist.feeDestinationAta,
        protocolTreasuryTokenAccount: vaultAllowlist.protocolTreasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([agent])
      .rpc();

    const destAfter = await getTokenBalance(connection, destAAta);
    const { netAmount } = calculateFees(amount, 500);
    expect(destAfter - destBefore).to.equal(netAmount);
    console.log(`    Transfer to allowed destination: net=${netAmount}`);
  });

  it("2. agent_transfer to non-allowed destination fails", async () => {
    try {
      await program.methods
        .agentTransfer(new BN(10_000_000))
        .accounts({
          agent: agent.publicKey,
          vault: vaultAllowlist.vaultPda,
          policy: vaultAllowlist.policyPda,
          tracker: vaultAllowlist.trackerPda,
          oracleRegistry: vaultAllowlist.oracleRegistryPda,
          vaultTokenAccount: vaultAllowlist.vaultTokenAta,
          tokenMintAccount: mint,
          destinationTokenAccount: destBAta, // destB not in allowlist
          feeDestinationTokenAccount: vaultAllowlist.feeDestinationAta,
          protocolTreasuryTokenAccount: vaultAllowlist.protocolTreasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([agent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expectError(err, "DestinationNotAllowed", "not in allowed");
    }
    console.log("    Non-allowed destination correctly rejected");
  });

  it("3. empty allowlist means any destination works", async () => {
    const randomDest = Keypair.generate();
    const randomDestAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      randomDest.publicKey,
    );

    await program.methods
      .agentTransfer(new BN(10_000_000))
      .accounts({
        agent: agent.publicKey,
        vault: vaultAnyDest.vaultPda,
        policy: vaultAnyDest.policyPda,
        tracker: vaultAnyDest.trackerPda,
        oracleRegistry: vaultAnyDest.oracleRegistryPda,
        vaultTokenAccount: vaultAnyDest.vaultTokenAta,
        tokenMintAccount: mint,
        destinationTokenAccount: randomDestAta.address,
        feeDestinationTokenAccount: null,
        protocolTreasuryTokenAccount: vaultAnyDest.protocolTreasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([agent])
      .rpc();

    const balance = await getTokenBalance(connection, randomDestAta.address);
    expect(balance).to.be.greaterThan(0);
    console.log("    Empty allowlist: any destination accepted");
  });

  it("4. agent_transfer developer + protocol fees correct", async () => {
    const amount = 100_000_000; // 100 USDC
    const { protocolFee, developerFee, netAmount } = calculateFees(
      amount,
      500,
    );

    const treasuryBefore = await getTokenBalance(
      connection,
      vaultAllowlist.protocolTreasuryAta,
    );
    const feeDestBefore = await getTokenBalance(
      connection,
      vaultAllowlist.feeDestinationAta!,
    );
    const destBefore = await getTokenBalance(connection, destAAta);

    await program.methods
      .agentTransfer(new BN(amount))
      .accounts({
        agent: agent.publicKey,
        vault: vaultAllowlist.vaultPda,
        policy: vaultAllowlist.policyPda,
        tracker: vaultAllowlist.trackerPda,
        oracleRegistry: vaultAllowlist.oracleRegistryPda,
        vaultTokenAccount: vaultAllowlist.vaultTokenAta,
        tokenMintAccount: mint,
        destinationTokenAccount: destAAta,
        feeDestinationTokenAccount: vaultAllowlist.feeDestinationAta,
        protocolTreasuryTokenAccount: vaultAllowlist.protocolTreasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([agent])
      .rpc();

    const treasuryAfter = await getTokenBalance(
      connection,
      vaultAllowlist.protocolTreasuryAta,
    );
    const feeDestAfter = await getTokenBalance(
      connection,
      vaultAllowlist.feeDestinationAta!,
    );
    const destAfter = await getTokenBalance(connection, destAAta);

    expect(treasuryAfter - treasuryBefore).to.equal(protocolFee);
    expect(feeDestAfter - feeDestBefore).to.equal(developerFee);
    expect(destAfter - destBefore).to.equal(netAmount);
    console.log(
      `    Fees verified: protocol=${protocolFee}, dev=${developerFee}, net=${netAmount}`,
    );
  });

  it("5. non-agent cannot call agent_transfer", async () => {
    try {
      await program.methods
        .agentTransfer(new BN(10_000_000))
        .accounts({
          agent: attacker.publicKey,
          vault: vaultAllowlist.vaultPda,
          policy: vaultAllowlist.policyPda,
          tracker: vaultAllowlist.trackerPda,
          oracleRegistry: vaultAllowlist.oracleRegistryPda,
          vaultTokenAccount: vaultAllowlist.vaultTokenAta,
          tokenMintAccount: mint,
          destinationTokenAccount: destAAta,
          feeDestinationTokenAccount: vaultAllowlist.feeDestinationAta,
          protocolTreasuryTokenAccount: vaultAllowlist.protocolTreasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([attacker])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expectError(err, "UnauthorizedAgent", "unauthorized", "constraint");
    }
    console.log("    Non-agent agent_transfer rejected");
  });

  it("6. agent_transfer respects daily spending cap", async () => {
    // Create vault with 200 USDC cap
    const smallCapVault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint,
      vaultId: nextVaultId(6),
      dailyCap: new BN(200_000_000),
      maxTx: new BN(200_000_000),
      allowedProtocols: [jupiterProgramId],
      allowedDestinations: [],
      depositAmount: new BN(1_000_000_000),
    });

    // Transfer 200 USDC (at cap)
    await program.methods
      .agentTransfer(new BN(200_000_000))
      .accounts({
        agent: agent.publicKey,
        vault: smallCapVault.vaultPda,
        policy: smallCapVault.policyPda,
        tracker: smallCapVault.trackerPda,
        oracleRegistry: smallCapVault.oracleRegistryPda,
        vaultTokenAccount: smallCapVault.vaultTokenAta,
        tokenMintAccount: mint,
        destinationTokenAccount: destAAta,
        feeDestinationTokenAccount: null,
        protocolTreasuryTokenAccount: smallCapVault.protocolTreasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([agent])
      .rpc();

    // 1 more should fail
    try {
      await program.methods
        .agentTransfer(new BN(1_000_000))
        .accounts({
          agent: agent.publicKey,
          vault: smallCapVault.vaultPda,
          policy: smallCapVault.policyPda,
          tracker: smallCapVault.trackerPda,
          oracleRegistry: smallCapVault.oracleRegistryPda,
          vaultTokenAccount: smallCapVault.vaultTokenAta,
          tokenMintAccount: mint,
          destinationTokenAccount: destAAta,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: smallCapVault.protocolTreasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([agent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expectError(err, "DailyCapExceeded", "cap");
    }
    console.log("    agent_transfer respects daily cap");
  });

  // ─── Tests 7-10: Added for devnet edge coverage ─────────────────────────

  it("7. updatePolicy adds new destination, transfer to new dest succeeds", async () => {
    // Vault with allowedDestinations=[destA]
    const destVault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint,
      vaultId: nextVaultId(6),
      dailyCap: new BN(500_000_000),
      maxTx: new BN(200_000_000),
      allowedProtocols: [jupiterProgramId],
      allowedDestinations: [destA.publicKey],
      depositAmount: new BN(500_000_000),
    });

    // Confirm destB is blocked before update
    try {
      await program.methods
        .agentTransfer(new BN(1_000_000))
        .accounts({
          agent: agent.publicKey,
          vault: destVault.vaultPda,
          policy: destVault.policyPda,
          tracker: destVault.trackerPda,
          oracleRegistry: destVault.oracleRegistryPda,
          vaultTokenAccount: destVault.vaultTokenAta,
          tokenMintAccount: mint,
          destinationTokenAccount: destBAta,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: destVault.protocolTreasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([agent])
        .rpc();
      expect.fail("destB should be blocked before update");
    } catch (err: any) {
      expectError(err, "DestinationNotAllowed", "not in allowed");
    }

    // Update policy to add destB
    await program.methods
      .updatePolicy(
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        [destA.publicKey, destB.publicKey],
      )
      .accounts({
        owner: owner.publicKey,
        vault: destVault.vaultPda,
        policy: destVault.policyPda,
      } as any)
      .rpc();

    // Now transfer to destB should succeed
    const destBBefore = await getTokenBalance(connection, destBAta);
    await program.methods
      .agentTransfer(new BN(5_000_000))
      .accounts({
        agent: agent.publicKey,
        vault: destVault.vaultPda,
        policy: destVault.policyPda,
        tracker: destVault.trackerPda,
        oracleRegistry: destVault.oracleRegistryPda,
        vaultTokenAccount: destVault.vaultTokenAta,
        tokenMintAccount: mint,
        destinationTokenAccount: destBAta,
        feeDestinationTokenAccount: null,
        protocolTreasuryTokenAccount: destVault.protocolTreasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([agent])
      .rpc();

    const destBAfter = await getTokenBalance(connection, destBAta);
    expect(destBAfter).to.be.greaterThan(destBBefore);
    console.log("    updatePolicy added destB, transfer succeeded");
  });

  it("8. updatePolicy to empty destinations allows any dest", async () => {
    // Vault with allowedDestinations=[destA]
    const restrictedVault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint,
      vaultId: nextVaultId(6),
      dailyCap: new BN(500_000_000),
      maxTx: new BN(200_000_000),
      allowedProtocols: [jupiterProgramId],
      allowedDestinations: [destA.publicKey],
      depositAmount: new BN(500_000_000),
    });

    // Update to empty destinations (any dest allowed)
    await program.methods
      .updatePolicy(
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        [],
      )
      .accounts({
        owner: owner.publicKey,
        vault: restrictedVault.vaultPda,
        policy: restrictedVault.policyPda,
      } as any)
      .rpc();

    // Transfer to random dest should now work
    const randomDest = Keypair.generate();
    const randomDestAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      randomDest.publicKey,
    );

    await program.methods
      .agentTransfer(new BN(5_000_000))
      .accounts({
        agent: agent.publicKey,
        vault: restrictedVault.vaultPda,
        policy: restrictedVault.policyPda,
        tracker: restrictedVault.trackerPda,
        oracleRegistry: restrictedVault.oracleRegistryPda,
        vaultTokenAccount: restrictedVault.vaultTokenAta,
        tokenMintAccount: mint,
        destinationTokenAccount: randomDestAta.address,
        feeDestinationTokenAccount: null,
        protocolTreasuryTokenAccount: restrictedVault.protocolTreasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([agent])
      .rpc();

    const balance = await getTokenBalance(connection, randomDestAta.address);
    expect(balance).to.be.greaterThan(0);
    console.log("    Empty destinations allows any dest");
  });

  it("9. updatePolicy with 11 destinations → TooManyDestinations", async () => {
    const vault11 = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint,
      vaultId: nextVaultId(6),
      dailyCap: new BN(500_000_000),
      maxTx: new BN(200_000_000),
      allowedProtocols: [jupiterProgramId],
      allowedDestinations: [],
      depositAmount: new BN(100_000_000),
    });

    const destinations = Array.from({ length: 11 }, () =>
      Keypair.generate().publicKey,
    );

    try {
      await program.methods
        .updatePolicy(
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          destinations,
        )
        .accounts({
          owner: owner.publicKey,
          vault: vault11.vaultPda,
          policy: vault11.policyPda,
        } as any)
        .rpc();
      expect.fail("Should have thrown TooManyDestinations");
    } catch (err: any) {
      expectError(err, "TooManyDestinations", "too many");
    }
    console.log("    updatePolicy with 11 destinations rejected");
  });

  it("10. agent_transfer on frozen vault fails", async () => {
    const frozenAgent = Keypair.generate();
    await fundKeypair(provider, frozenAgent.publicKey);

    const frozenVault = await createFullVault({
      program,
      connection,
      owner,
      agent: frozenAgent,
      feeDestination: feeDestination.publicKey,
      mint,
      vaultId: nextVaultId(6),
      dailyCap: new BN(500_000_000),
      maxTx: new BN(200_000_000),
      allowedProtocols: [jupiterProgramId],
      allowedDestinations: [],
      depositAmount: new BN(500_000_000),
    });

    // Freeze vault (revokeAgent sets status=Frozen and clears agent)
    await program.methods
      .revokeAgent()
      .accounts({
        owner: owner.publicKey,
        vault: frozenVault.vaultPda,
      } as any)
      .rpc();

    try {
      await program.methods
        .agentTransfer(new BN(10_000_000))
        .accounts({
          agent: frozenAgent.publicKey,
          vault: frozenVault.vaultPda,
          policy: frozenVault.policyPda,
          tracker: frozenVault.trackerPda,
          oracleRegistry: frozenVault.oracleRegistryPda,
          vaultTokenAccount: frozenVault.vaultTokenAta,
          tokenMintAccount: mint,
          destinationTokenAccount: destAAta,
          feeDestinationTokenAccount: null,
          protocolTreasuryTokenAccount: frozenVault.protocolTreasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([frozenAgent])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      // revokeAgent clears agent, so constraint hit is UnauthorizedAgent
      expectError(
        err,
        "UnauthorizedAgent",
        "VaultNotActive",
        "unauthorized",
      );
    }
    console.log("    agent_transfer on frozen vault rejected");
  });
});
