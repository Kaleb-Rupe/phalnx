/**
 * Kit SDK Devnet — Vault Lifecycle Tests
 *
 * Proves Codama-generated instruction builders, account decoders,
 * and PhalnxKitClient work against the real deployed program.
 */

import { expect } from "chai";
import type { Address, Rpc, SolanaRpcApi, KeyPairSigner } from "@solana/kit";

import {
  createDevnetRpc,
  loadOwnerSigner,
  createFundedAgent,
  ensureStablecoinBalance,
  provisionVault,
  sendKitTransaction,
  type ProvisionVaultResult,
} from "../helpers/devnet-setup.js";

import { resolveVaultState } from "../../src/state-resolver.js";
import { PhalnxKitClient } from "../../src/client.js";
import { getUpdatePolicyInstructionAsync } from "../../src/generated/instructions/updatePolicy.js";
import {
  USDC_MINT_DEVNET,
  FULL_PERMISSIONS,
} from "../../src/types.js";
import type { IntentAction } from "../../src/intents.js";
import type { Instruction } from "@solana/kit";

// Skip entire file if no devnet env
const SKIP = !process.env.ANCHOR_PROVIDER_URL;

describe("Kit SDK Devnet — Vault Lifecycle", function () {
  if (SKIP) return;

  this.timeout(300_000);

  let rpc: Rpc<SolanaRpcApi>;
  let owner: KeyPairSigner;
  let agent: KeyPairSigner;
  let vault: ProvisionVaultResult;
  let rpcUrl: string;

  before(async function () {
    rpc = createDevnetRpc();
    rpcUrl = process.env.ANCHOR_PROVIDER_URL!;
    const { signer, bytes } = await loadOwnerSigner();
    owner = signer;

    agent = await createFundedAgent(rpc, owner);
    await ensureStablecoinBalance(rpcUrl, bytes, USDC_MINT_DEVNET, 2_000_000_000);
  });

  it("provisions vault via Codama instruction builders", async function () {
    vault = await provisionVault(rpc, owner, agent, USDC_MINT_DEVNET, {
      skipDeposit: false,
      dailySpendingCapUsd: 500_000_000n,
      maxTransactionSizeUsd: 100_000_000n,
      protocolMode: 0, // allow all
    });

    // Verify the vault account exists on-chain
    const accountInfo = await rpc
      .getAccountInfo(vault.vaultAddress, { encoding: "base64" })
      .send();
    expect(accountInfo.value).to.not.be.null;
  });

  it("resolveVaultState() decodes on-chain accounts", async function () {
    const state = await resolveVaultState(
      rpc,
      vault.vaultAddress,
      agent.address,
    );

    expect(state.vault).to.exist;
    expect(state.policy).to.exist;

    // Check owner matches
    const ownerFromVault = state.vault.owner;
    expect(ownerFromVault).to.equal(owner.address);

    // Check agent is registered with FULL_PERMISSIONS
    const agentEntry = state.vault.agents.find(
      (a) => a.pubkey === agent.address,
    );
    expect(agentEntry).to.exist;
    expect(agentEntry!.permissions).to.equal(FULL_PERMISSIONS);

    // Check daily spending cap
    expect(Number(state.policy.dailySpendingCapUsd)).to.equal(500_000_000);
  });

  it("PhalnxKitClient.fetchVault() returns decoded vault", async function () {
    const client = new PhalnxKitClient({
      rpc,
      network: "devnet",
      agent,
    });

    const fetchedVault = await client.fetchVault(vault.vaultAddress);
    expect(fetchedVault.data.owner).to.equal(owner.address);

    const agentEntry = fetchedVault.data.agents.find(
      (a) => a.pubkey === agent.address,
    );
    expect(agentEntry).to.exist;
  });

  it("PhalnxKitClient.resolveState() returns budget info", async function () {
    const client = new PhalnxKitClient({
      rpc,
      network: "devnet",
      agent,
    });

    const state = await client.resolveState(vault.vaultAddress);

    expect(Number(state.globalBudget.cap)).to.be.greaterThan(0);
    expect(state.globalBudget.spent24h).to.equal(0n);
    expect(state.globalBudget.remaining).to.deep.equal(state.globalBudget.cap);
  });

  it("PhalnxKitClient.precheck() passes for valid swap", async function () {
    const client = new PhalnxKitClient({
      rpc,
      network: "devnet",
      agent,
    });

    const intent: IntentAction = {
      type: "swap",
      params: {
        inputMint: USDC_MINT_DEVNET,
        outputMint: "So11111111111111111111111111111111111111112",
        amount: "1000000",
      },
    };

    const result = await client.precheck(intent, vault.vaultAddress);

    expect(result.allowed).to.be.true;
    expect(result.details.permission.passed).to.be.true;
  });

  it("updatePolicy via Codama builder", async function () {
    const newCap = 1_000_000_000n; // $1000

    const updateIx = await getUpdatePolicyInstructionAsync({
      owner,
      vault: vault.vaultAddress,
      dailySpendingCapUsd: newCap,
      maxTransactionSizeUsd: null,
      protocolMode: null,
      protocols: null,
      maxLeverageBps: null,
      canOpenPositions: null,
      maxConcurrentPositions: null,
      developerFeeRate: null,
      maxSlippageBps: null,
      timelockDuration: null,
      allowedDestinations: null,
      sessionExpirySlots: null,
      hasProtocolCaps: null,
      protocolCaps: null,
    });

    await sendKitTransaction(rpc, owner, [updateIx as Instruction]);

    // Verify the policy was updated
    const state = await resolveVaultState(
      rpc,
      vault.vaultAddress,
      agent.address,
    );
    expect(Number(state.policy.dailySpendingCapUsd)).to.equal(Number(newCap));
  });
});
