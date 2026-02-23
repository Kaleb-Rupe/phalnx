/**
 * Devnet Edge Case Tests — 16 tests (V2)
 *
 * Boundary conditions, vector capacity limits, developer fee caps,
 * state machine edges, and reactivation scenarios. Confirms the
 * deployed binary's constraint checks match the source code.
 */
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";
import {
  getDevnetProvider,
  nextVaultId,
  derivePDAs,
  deriveSessionPda,
  deriveOracleRegistryPda,
  initializeOracleRegistry,
  updateOracleRegistry,
  makeOracleEntry,
  createFullVault,
  authorize,
  fundKeypair,
  createTestMint,
  expectError,
  FullVaultResult,
} from "./helpers/devnet-setup";

describe("devnet-edge-cases", () => {
  const { provider, program, connection, owner } = getDevnetProvider();
  const payer = (owner as any).payer;

  const agent = Keypair.generate();
  const attacker = Keypair.generate();
  const feeDestination = Keypair.generate();
  const jupiterProgramId = Keypair.generate().publicKey;

  let mint1: PublicKey;
  let mint2: PublicKey;
  let oracleRegistryPda: PublicKey;

  before(async () => {
    await fundKeypair(provider, agent.publicKey);
    await fundKeypair(provider, attacker.publicKey);

    mint1 = await createTestMint(connection, payer, owner.publicKey, 6);
    mint2 = await createTestMint(connection, payer, owner.publicKey, 6);

    // Initialize or update oracle registry with both mints as stablecoins
    const entries = [
      makeOracleEntry(mint1, PublicKey.default, true, PublicKey.default),
      makeOracleEntry(mint2, PublicKey.default, true, PublicKey.default),
    ];

    try {
      oracleRegistryPda = await initializeOracleRegistry(
        program,
        owner,
        entries,
      );
    } catch {
      const [pda] = deriveOracleRegistryPda(program.programId);
      oracleRegistryPda = pda;
      await updateOracleRegistry(program, owner, entries);
    }

    console.log("  Edge case setup: 2 mints registered as stablecoins");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Protocol Mode Tests (4 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  it("1. protocolMode=0 (all-allowed) accepts any protocol", async () => {
    const vault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint: mint1,
      vaultId: nextVaultId(10),
      protocolMode: 0, // all allowed
      allowedProtocols: [],
      depositAmount: new BN(100_000_000),
    });

    const randomProtocol = Keypair.generate().publicKey;
    const sessionPda = deriveSessionPda(
      vault.vaultPda,
      agent.publicKey,
      mint1,
      program.programId,
    );

    await authorize({
      program,
      agent,
      vaultPda: vault.vaultPda,
      policyPda: vault.policyPda,
      trackerPda: vault.trackerPda,
      oracleRegistryPda,
      sessionPda,
      vaultTokenAta: vault.vaultTokenAta,
      mint: mint1,
      amount: new BN(1_000_000),
      protocol: randomProtocol,
    });

    console.log("    protocolMode=0: any protocol accepted");
  });

  it("2. protocolMode=2 (denylist) blocks denied protocol", async () => {
    const deniedProtocol = Keypair.generate().publicKey;
    const vault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint: mint1,
      vaultId: nextVaultId(10),
      protocolMode: 2, // denylist
      allowedProtocols: [deniedProtocol], // this is the DENIED list
      depositAmount: new BN(100_000_000),
    });

    const sessionPda = deriveSessionPda(
      vault.vaultPda,
      agent.publicKey,
      mint1,
      program.programId,
    );

    try {
      await authorize({
        program,
        agent,
        vaultPda: vault.vaultPda,
        policyPda: vault.policyPda,
        trackerPda: vault.trackerPda,
        oracleRegistryPda,
        sessionPda,
        vaultTokenAta: vault.vaultTokenAta,
        mint: mint1,
        amount: new BN(1_000_000),
        protocol: deniedProtocol,
      });
      expect.fail("Should have thrown ProtocolNotAllowed");
    } catch (err: any) {
      expectError(err, "ProtocolNotAllowed", "not allowed");
    }
    console.log("    protocolMode=2: denied protocol blocked");
  });

  it("3. protocolMode=2 (denylist) allows non-denied protocol", async () => {
    const deniedProtocol = Keypair.generate().publicKey;
    const vault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint: mint1,
      vaultId: nextVaultId(10),
      protocolMode: 2, // denylist
      allowedProtocols: [deniedProtocol],
      depositAmount: new BN(100_000_000),
    });

    const allowedProtocol = Keypair.generate().publicKey; // not in deny list
    const sessionPda = deriveSessionPda(
      vault.vaultPda,
      agent.publicKey,
      mint1,
      program.programId,
    );

    await authorize({
      program,
      agent,
      vaultPda: vault.vaultPda,
      policyPda: vault.policyPda,
      trackerPda: vault.trackerPda,
      oracleRegistryPda,
      sessionPda,
      vaultTokenAta: vault.vaultTokenAta,
      mint: mint1,
      amount: new BN(1_000_000),
      protocol: allowedProtocol,
    });

    console.log("    protocolMode=2: non-denied protocol allowed");
  });

  it("4. protocolMode=1 (allowlist) blocks non-listed protocol", async () => {
    const allowedProtocol = Keypair.generate().publicKey;
    const vault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint: mint1,
      vaultId: nextVaultId(10),
      protocolMode: 1, // allowlist
      allowedProtocols: [allowedProtocol],
      depositAmount: new BN(100_000_000),
    });

    const blockedProtocol = Keypair.generate().publicKey; // not in allowlist
    const sessionPda = deriveSessionPda(
      vault.vaultPda,
      agent.publicKey,
      mint1,
      program.programId,
    );

    try {
      await authorize({
        program,
        agent,
        vaultPda: vault.vaultPda,
        policyPda: vault.policyPda,
        trackerPda: vault.trackerPda,
        oracleRegistryPda,
        sessionPda,
        vaultTokenAta: vault.vaultTokenAta,
        mint: mint1,
        amount: new BN(1_000_000),
        protocol: blockedProtocol,
      });
      expect.fail("Should have thrown ProtocolNotAllowed");
    } catch (err: any) {
      expectError(err, "ProtocolNotAllowed", "not allowed");
    }
    console.log("    protocolMode=1: non-listed protocol blocked");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Vector Capacity Tests (3 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  it("5. initializeVault with 11 protocols → TooManyAllowedProtocols", async () => {
    const protocols = Array.from({ length: 11 }, () =>
      Keypair.generate().publicKey,
    );
    const vaultId = nextVaultId(10);
    const pdas = derivePDAs(owner.publicKey, vaultId, program.programId);

    try {
      await program.methods
        .initializeVault(
          vaultId,
          new BN(500_000_000),
          new BN(100_000_000),
          1,
          protocols,
          new BN(0) as any,
          3,
          0,
          new BN(0),
          [],
        )
        .accounts({
          owner: owner.publicKey,
          vault: pdas.vaultPda,
          policy: pdas.policyPda,
          tracker: pdas.trackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
      expect.fail("Should have thrown TooManyAllowedProtocols");
    } catch (err: any) {
      expectError(err, "TooManyAllowedProtocols", "too many");
    }
    console.log("    11 protocols correctly rejected");
  });

  it("6. initializeVault with 11 destinations → TooManyDestinations", async () => {
    const destinations = Array.from({ length: 11 }, () =>
      Keypair.generate().publicKey,
    );
    const vaultId = nextVaultId(10);
    const pdas = derivePDAs(owner.publicKey, vaultId, program.programId);

    try {
      await program.methods
        .initializeVault(
          vaultId,
          new BN(500_000_000),
          new BN(100_000_000),
          0,
          [],
          new BN(0) as any,
          3,
          0,
          new BN(0),
          destinations,
        )
        .accounts({
          owner: owner.publicKey,
          vault: pdas.vaultPda,
          policy: pdas.policyPda,
          tracker: pdas.trackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
      expect.fail("Should have thrown TooManyDestinations");
    } catch (err: any) {
      expectError(err, "TooManyDestinations", "too many");
    }
    console.log("    11 destinations correctly rejected");
  });

  it("7. updatePolicy with 11 protocols → TooManyAllowedProtocols", async () => {
    const vault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint: mint1,
      vaultId: nextVaultId(10),
      protocolMode: 0,
      allowedProtocols: [],
      depositAmount: new BN(100_000_000),
    });

    const protocols = Array.from({ length: 11 }, () =>
      Keypair.generate().publicKey,
    );

    try {
      await program.methods
        .updatePolicy(
          null,
          null,
          null,
          protocols,
          null,
          null,
          null,
          null,
          null,
          null,
        )
        .accounts({
          owner: owner.publicKey,
          vault: vault.vaultPda,
          policy: vault.policyPda,
        } as any)
        .rpc();
      expect.fail("Should have thrown TooManyAllowedProtocols");
    } catch (err: any) {
      expectError(err, "TooManyAllowedProtocols", "too many");
    }
    console.log("    updatePolicy with 11 protocols rejected");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Developer Fee Boundary Tests (2 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  it("8. initializeVault devFeeRate=501 → DeveloperFeeTooHigh", async () => {
    const vaultId = nextVaultId(10);
    const pdas = derivePDAs(owner.publicKey, vaultId, program.programId);

    try {
      await program.methods
        .initializeVault(
          vaultId,
          new BN(500_000_000),
          new BN(100_000_000),
          0,
          [],
          new BN(0) as any,
          3,
          501, // 1 over MAX_DEVELOPER_FEE_RATE (500)
          new BN(0),
          [],
        )
        .accounts({
          owner: owner.publicKey,
          vault: pdas.vaultPda,
          policy: pdas.policyPda,
          tracker: pdas.trackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
      expect.fail("Should have thrown DeveloperFeeTooHigh");
    } catch (err: any) {
      expectError(err, "DeveloperFeeTooHigh", "fee");
    }
    console.log("    devFeeRate=501 correctly rejected on init");
  });

  it("9. updatePolicy devFeeRate=501 → DeveloperFeeTooHigh", async () => {
    const vault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint: mint1,
      vaultId: nextVaultId(10),
      protocolMode: 0,
      allowedProtocols: [],
      devFeeRate: 0,
      depositAmount: new BN(100_000_000),
    });

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
          501, // 1 over limit
          null,
          null,
        )
        .accounts({
          owner: owner.publicKey,
          vault: vault.vaultPda,
          policy: vault.policyPda,
        } as any)
        .rpc();
      expect.fail("Should have thrown DeveloperFeeTooHigh");
    } catch (err: any) {
      expectError(err, "DeveloperFeeTooHigh", "fee");
    }
    console.log("    devFeeRate=501 correctly rejected on update");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // State Machine Edge Tests (5 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  it("10. reactivate active vault → VaultNotFrozen", async () => {
    const vault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint: mint1,
      vaultId: nextVaultId(10),
      protocolMode: 0,
      allowedProtocols: [],
      depositAmount: new BN(100_000_000),
    });

    try {
      await program.methods
        .reactivateVault(null)
        .accounts({ owner: owner.publicKey, vault: vault.vaultPda } as any)
        .rpc();
      expect.fail("Should have thrown VaultNotFrozen");
    } catch (err: any) {
      expectError(err, "VaultNotFrozen", "not frozen");
    }
    console.log("    Reactivate active vault correctly rejected");
  });

  it("11. registerAgent with owner pubkey → AgentIsOwner", async () => {
    const vault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint: mint1,
      vaultId: nextVaultId(10),
      protocolMode: 0,
      allowedProtocols: [],
      skipAgent: true,
      depositAmount: new BN(100_000_000),
    });

    try {
      await program.methods
        .registerAgent(owner.publicKey)
        .accounts({ owner: owner.publicKey, vault: vault.vaultPda } as any)
        .rpc();
      expect.fail("Should have thrown AgentIsOwner");
    } catch (err: any) {
      expectError(err, "AgentIsOwner", "owner");
    }
    console.log("    registerAgent with owner pubkey rejected");
  });

  it("12. registerAgent with Pubkey.default → InvalidAgentKey", async () => {
    const vault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint: mint1,
      vaultId: nextVaultId(10),
      protocolMode: 0,
      allowedProtocols: [],
      skipAgent: true,
      depositAmount: new BN(100_000_000),
    });

    try {
      await program.methods
        .registerAgent(PublicKey.default)
        .accounts({ owner: owner.publicKey, vault: vault.vaultPda } as any)
        .rpc();
      expect.fail("Should have thrown InvalidAgentKey");
    } catch (err: any) {
      expectError(err, "InvalidAgentKey", "zero", "invalid");
    }
    console.log("    registerAgent with zero address rejected");
  });

  it("13. registerAgent when already set → AgentAlreadyRegistered", async () => {
    const vault = await createFullVault({
      program,
      connection,
      owner,
      agent,
      feeDestination: feeDestination.publicKey,
      mint: mint1,
      vaultId: nextVaultId(10),
      protocolMode: 0,
      allowedProtocols: [],
      depositAmount: new BN(100_000_000),
    });

    const newAgent = Keypair.generate();
    try {
      await program.methods
        .registerAgent(newAgent.publicKey)
        .accounts({ owner: owner.publicKey, vault: vault.vaultPda } as any)
        .rpc();
      expect.fail("Should have thrown AgentAlreadyRegistered");
    } catch (err: any) {
      expectError(err, "AgentAlreadyRegistered", "already");
    }
    console.log("    registerAgent when already set rejected");
  });

  it("14. initializeVault protocolMode=3 → InvalidProtocolMode", async () => {
    const vaultId = nextVaultId(10);
    const pdas = derivePDAs(owner.publicKey, vaultId, program.programId);

    try {
      await program.methods
        .initializeVault(
          vaultId,
          new BN(500_000_000),
          new BN(100_000_000),
          3, // invalid mode
          [],
          new BN(0) as any,
          3,
          0,
          new BN(0),
          [],
        )
        .accounts({
          owner: owner.publicKey,
          vault: pdas.vaultPda,
          policy: pdas.policyPda,
          tracker: pdas.trackerPda,
          feeDestination: feeDestination.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .rpc();
      expect.fail("Should have thrown InvalidProtocolMode");
    } catch (err: any) {
      expectError(err, "InvalidProtocolMode", "protocol mode");
    }
    console.log("    protocolMode=3 correctly rejected");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Reactivation Tests (2 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  it("15. reactivate with new agent key rotates agent", async () => {
    const originalAgent = Keypair.generate();
    await fundKeypair(provider, originalAgent.publicKey);

    const vault = await createFullVault({
      program,
      connection,
      owner,
      agent: originalAgent,
      feeDestination: feeDestination.publicKey,
      mint: mint1,
      vaultId: nextVaultId(10),
      protocolMode: 0,
      allowedProtocols: [],
      depositAmount: new BN(100_000_000),
    });

    // Freeze
    await program.methods
      .revokeAgent()
      .accounts({ owner: owner.publicKey, vault: vault.vaultPda } as any)
      .rpc();

    const frozen = await program.account.agentVault.fetch(vault.vaultPda);
    expect(JSON.stringify(frozen.status)).to.include("frozen");

    // Reactivate with new agent
    const newAgent = Keypair.generate();
    await program.methods
      .reactivateVault(newAgent.publicKey)
      .accounts({ owner: owner.publicKey, vault: vault.vaultPda } as any)
      .rpc();

    const reactivated = await program.account.agentVault.fetch(vault.vaultPda);
    expect(JSON.stringify(reactivated.status)).to.include("active");
    expect(reactivated.agent.toString()).to.equal(
      newAgent.publicKey.toString(),
    );
    console.log("    Reactivate with agent rotation succeeded");
  });

  it("16. reactivate without new agent after revoke → NoAgentRegistered", async () => {
    const tempAgent = Keypair.generate();
    await fundKeypair(provider, tempAgent.publicKey);

    const vault = await createFullVault({
      program,
      connection,
      owner,
      agent: tempAgent,
      feeDestination: feeDestination.publicKey,
      mint: mint1,
      vaultId: nextVaultId(10),
      protocolMode: 0,
      allowedProtocols: [],
      depositAmount: new BN(100_000_000),
    });

    // Revoke clears agent to Pubkey.default
    await program.methods
      .revokeAgent()
      .accounts({ owner: owner.publicKey, vault: vault.vaultPda } as any)
      .rpc();

    // Reactivate with null (no new agent) — should fail because agent is default
    try {
      await program.methods
        .reactivateVault(null)
        .accounts({ owner: owner.publicKey, vault: vault.vaultPda } as any)
        .rpc();
      expect.fail("Should have thrown NoAgentRegistered");
    } catch (err: any) {
      expectError(err, "NoAgentRegistered", "InvalidAgentKey", "no agent", "zero", "invalid");
    }
    console.log("    Reactivate without agent after revoke rejected");
  });
});
