/**
 * @usesigil/kit/dashboard — Mutation functions for OwnerClient.
 *
 * Every mutation: build instruction → buildOwnerTransaction → signAndEncode → sendAndConfirmTransaction.
 * Stateless — no caching, no optimistic updates (v0.2).
 */

import type {
  Address,
  Instruction,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "../kit-adapter.js";
import { getProgramDerivedAddress, getAddressEncoder } from "../kit-adapter.js";
import { getSigilModuleLogger } from "../logger.js";
import type { CapabilityTier, UsdBaseUnits } from "../types.js";
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  addSignersToTransactionMessage,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  type Instruction as KitInstruction,
} from "../kit-adapter.js";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  sendAndConfirmTransaction,
  getBlockhashCache,
} from "../rpc-helpers.js";
import { AccountRole } from "../kit-adapter.js";
import {
  getAgentOverlayPDA,
  getPendingPolicyPDA,
  getPendingCloseConstraintsPDA,
  getPolicyPDA,
} from "../resolve-accounts.js";
import { resolveVaultStateForOwner } from "../state-resolver.js";
import { redactCause } from "../network-errors.js";
import { SIGIL_PROGRAM_ADDRESS, MAX_ALLOWED_PROTOCOLS } from "../types.js";
import type { Network } from "../types.js";
import type { AgentVault } from "../generated/accounts/agentVault.js";
import { fetchAgentVault } from "../generated/accounts/agentVault.js";
import { fetchPolicyConfig } from "../generated/accounts/policyConfig.js";
import { computePolicyPreviewDigest } from "../policy/compute-policy-preview-digest.js";

// Phase 3: Simple mutations
import { getFreezeVaultInstruction } from "../generated/instructions/freezeVault.js";
import { getReactivateVaultInstruction } from "../generated/instructions/reactivateVault.js";
import { getCloseVaultInstructionAsync } from "../generated/instructions/closeVault.js";
import { getPauseAgentInstruction } from "../generated/instructions/pauseAgent.js";
import { getUnpauseAgentInstruction } from "../generated/instructions/unpauseAgent.js";
import { getRevokeAgentInstruction } from "../generated/instructions/revokeAgent.js";
import { getRegisterAgentInstruction } from "../generated/instructions/registerAgent.js";

// Phase 4: Complex mutations
import { getDepositFundsInstructionAsync } from "../generated/instructions/depositFunds.js";
import { getWithdrawFundsInstructionAsync } from "../generated/instructions/withdrawFunds.js";
import { getQueuePolicyUpdateInstructionAsync } from "../generated/instructions/queuePolicyUpdate.js";
import { getApplyPendingPolicyInstructionAsync } from "../generated/instructions/applyPendingPolicy.js";
import { getCancelPendingPolicyInstructionAsync } from "../generated/instructions/cancelPendingPolicy.js";
import { getQueueAgentPermissionsUpdateInstructionAsync } from "../generated/instructions/queueAgentPermissionsUpdate.js";
import { getApplyAgentPermissionsUpdateInstructionAsync } from "../generated/instructions/applyAgentPermissionsUpdate.js";
import { getCancelAgentPermissionsUpdateInstruction } from "../generated/instructions/cancelAgentPermissionsUpdate.js";
import { getApplyConstraintsUpdateInstructionAsync } from "../generated/instructions/applyConstraintsUpdate.js";
import { getCancelConstraintsUpdateInstructionAsync } from "../generated/instructions/cancelConstraintsUpdate.js";
import { getQueueCloseConstraintsInstructionAsync } from "../generated/instructions/queueCloseConstraints.js";
import { getApplyCloseConstraintsInstructionAsync } from "../generated/instructions/applyCloseConstraints.js";
import { getCancelCloseConstraintsInstructionAsync } from "../generated/instructions/cancelCloseConstraints.js";
import { getCreatePostAssertionsInstructionAsync } from "../generated/instructions/createPostAssertions.js";
import { getClosePostAssertionsInstructionAsync } from "../generated/instructions/closePostAssertions.js";
import type { PostAssertionEntry } from "../generated/types/postAssertionEntry.js";
import { validatePostAssertionEntries } from "./post-assertion-validation.js";
import {
  buildCreateConstraintsIxs,
  buildQueueConstraintsUpdateIxs,
} from "./constraint-builders.js";

import type {
  TxResult,
  TxOpts,
  PolicyChanges,
  ConstraintEntry,
} from "./types.js";
import { toDxError } from "./errors.js";

// ─── Shared Helper ───────────────────────────────────────────────────────────

const CU_OWNER_ACTION = 200_000;

/**
 * PEN-CROSS-3 (Phase 2 close-up): compute the post-mutation
 * policy_preview_digest for one of the 4 sibling handlers
 * (create_instruction_constraints, apply_close_constraints,
 * create_post_assertions, close_post_assertions).
 *
 * Reads the live PolicyConfig + AgentVault, applies the caller-specified
 * flag override, then returns the canonical digest the on-chain handler
 * will recompute and assert against. The owner signs this exact digest
 * when calling the ix — defends against blind-sign by forcing explicit
 * attestation of the flag flip.
 */
async function siblingHandlerExpectedDigest(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  override: { hasConstraints?: boolean; hasPostAssertions?: number },
): Promise<Uint8Array> {
  const [policyAddress] = await getPolicyPDA(vault);
  const [livePolicy, liveVault] = await Promise.all([
    fetchPolicyConfig(rpc, policyAddress),
    fetchAgentVault(rpc, vault),
  ]);
  return computePolicyPreviewDigest({
    dailySpendingCapUsd: livePolicy.data.dailySpendingCapUsd,
    maxTransactionSizeUsd: livePolicy.data.maxTransactionSizeUsd,
    maxSlippageBps: livePolicy.data.maxSlippageBps,
    developerFeeRate: livePolicy.data.developerFeeRate,
    protocolMode: livePolicy.data.protocolMode,
    protocols: livePolicy.data.protocols,
    destinationMode: livePolicy.data.destinationMode,
    allowedDestinations: livePolicy.data.allowedDestinations,
    timelockDuration: livePolicy.data.timelockDuration,
    sessionExpirySeconds: livePolicy.data.sessionExpirySeconds,
    observeOnly: liveVault.data.observeOnly,
    hasConstraints:
      override.hasConstraints !== undefined
        ? override.hasConstraints
        : livePolicy.data.hasConstraints,
    hasPostAssertions:
      override.hasPostAssertions !== undefined
        ? override.hasPostAssertions
        : livePolicy.data.hasPostAssertions,
    createdAtSlot: livePolicy.data.createdAtSlot,
    // TA-05 (Phase 3): operating_hours is policy-owned. Sibling handlers
    // (constraints/post-assertions) never mutate it — pass through.
    operatingHours: livePolicy.data.operatingHours,
    // TA-07/17 (Phase 3): also pass-through from live policy.
    autoPromoteGrays: livePolicy.data.autoPromoteGrays,
    autoRevokeThreshold: livePolicy.data.autoRevokeThreshold,
  });
}

async function run(
  rpc: Rpc<SolanaRpcApi>,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  instructions: Instruction[],
  opts: TxOpts = {},
): Promise<TxResult> {
  try {
    const cu = opts.computeUnits ?? CU_OWNER_ACTION;
    const allIx: KitInstruction[] = [
      getSetComputeUnitLimitInstruction({
        units: cu,
      }) as unknown as KitInstruction,
      ...(opts.priorityFeeMicroLamports
        ? [
            getSetComputeUnitPriceInstruction({
              microLamports: BigInt(opts.priorityFeeMicroLamports),
            }) as unknown as KitInstruction,
          ]
        : []),
      ...(instructions as unknown as KitInstruction[]),
    ];

    const cache = getBlockhashCache(rpc);
    const blockhash = await cache.get(rpc);
    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(owner.address, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash as any, tx),
      (tx) => appendTransactionMessageInstructions(allIx, tx),
    );

    const txWithSigners = addSignersToTransactionMessage(
      [owner],
      txMessage as any,
    );
    const signedTx = await signTransactionMessageWithSigners(
      txWithSigners as any,
    );
    const wire = getBase64EncodedWireTransaction(signedTx as any);
    const signature = await sendAndConfirmTransaction(rpc, wire);

    return { signature, toJSON: () => ({ signature }) };
  } catch (err: unknown) {
    throw toDxError(err);
  }
}

// toDxError is now in ./errors.ts (shared with reads.ts)

// ─── Client-Side Validation ──────────────────────────────────────────────────
// Fail fast with clear errors instead of burning RPC round-trips.

const U64_MAX = (1n << 64n) - 1n;

function requirePositiveAmount(amount: bigint, field: string): void {
  if (amount <= 0n)
    throw toDxError(new Error(`${field} must be positive, got ${amount}`));
  if (amount > U64_MAX)
    throw toDxError(new Error(`${field} exceeds u64 maximum (${U64_MAX})`));
}

function requireValidAddress(addr: string, field: string): void {
  if (!addr || addr.length < 32 || addr.length > 44)
    throw toDxError(
      new Error(
        `${field} is not a valid Solana address (got ${addr?.length ?? 0} chars)`,
      ),
    );
}

const MAX_CAPABILITY = 2; // 0=Disabled, 1=Observer, 2=Operator

function requireValidPermissions(perms: bigint): void {
  if (perms < 0n) throw toDxError(new Error(`Capability cannot be negative`));
  if (perms === 0n)
    throw toDxError(
      new Error(
        `Capability is 0 (Disabled) — agent would have no permissions. Use 1 (Observer) or 2 (Operator).`,
      ),
    );
  if (perms > BigInt(MAX_CAPABILITY))
    throw toDxError(
      new Error(
        `Capability exceeds maximum (${MAX_CAPABILITY}). Valid values: 0=Disabled, 1=Observer, 2=Operator.`,
      ),
    );
}

function requireU8(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw toDxError(
      new Error(`${field} must be an integer 0-255, got ${value}`),
    );
  }
}

function mapProtocolMode(mode: string): number {
  const map: Record<string, number> = {
    unrestricted: 0,
    whitelist: 1,
    blacklist: 2,
  };
  if (!(mode in map))
    throw toDxError(
      new Error(
        `Invalid protocolMode: "${mode}". Must be "unrestricted", "whitelist", or "blacklist".`,
      ),
    );
  return map[mode];
}

/** Derive pendingAgentPerms PDA: seeds = ["pending_agent_perms", vault, agent] */
async function derivePendingAgentPermsPDA(
  vault: Address,
  agent: Address,
): Promise<Address> {
  const encoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: SIGIL_PROGRAM_ADDRESS,
    seeds: [
      new TextEncoder().encode("pending_agent_perms"),
      encoder.encode(vault),
      encoder.encode(agent),
    ],
  });
  return pda;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3: Simple mutations
// ═══════════════════════════════════════════════════════════════════════════════

export async function freezeVault(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  opts?: TxOpts,
): Promise<TxResult> {
  const ix = getFreezeVaultInstruction({ owner, vault });
  return run(rpc, owner, network, [ix], opts);
}

export async function resumeVault(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  newAgent?: { address: Address; permissions: CapabilityTier },
  opts?: TxOpts,
): Promise<TxResult> {
  const ix = getReactivateVaultInstruction({
    owner,
    vault,
    newAgent: newAgent?.address ?? null,
    newAgentCapability: newAgent ? Number(newAgent.permissions) : null,
  });
  return run(rpc, owner, network, [ix], opts);
}

/**
 * Permanently closes vault and reclaims rent.
 *
 * TOCTOU note: vault state is read before TX is built. If pending PDAs are
 * created/destroyed between the read and TX execution, the on-chain program
 * will reject the TX. This is a known race window — retry on failure.
 */
export async function closeVault(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  opts?: TxOpts,
): Promise<TxResult> {
  const net: Network = network === "mainnet" ? "mainnet-beta" : "devnet";

  // Resolve vault state to determine which remaining_accounts are needed
  const state = await resolveVaultStateForOwner(rpc, vault, undefined, net);
  const policy = state.policy as any;
  const vaultData = state.vault as AgentVault;

  const [overlayPda] = await getAgentOverlayPDA(vault, 0);
  const ix = await getCloseVaultInstructionAsync({
    owner,
    vault,
    agentSpendOverlay: overlayPda,
  });

  // Build remaining_accounts for pending PDA cleanup (close_vault.rs:68-142)
  // All accounts verified via getAccountInfo before inclusion — no blind trust.
  const remainingAccounts: { address: Address; role: AccountRole }[] = [];

  // Derive all PDAs that MIGHT exist, then check them in parallel
  const [pendingPolicyPda] = await getPendingPolicyPDA(vault);

  const agents = vaultData.agents || [];
  const agentPdaDerivations = await Promise.all(
    agents.map((agent) => derivePendingAgentPermsPDA(vault, agent.pubkey)),
  );

  const [pendingCloseConstraintsPda] =
    await getPendingCloseConstraintsPDA(vault);

  // Check all PDAs in parallel (E4 fix — batch instead of sequential)
  const allPdas = [
    pendingPolicyPda,
    ...agentPdaDerivations,
    pendingCloseConstraintsPda,
  ];

  const existenceChecks = await Promise.all(
    allPdas.map(async (pda) => {
      try {
        const info = await rpc
          .getAccountInfo(pda, { encoding: "base64" })
          .send();
        return info?.value ? pda : null;
      } catch (err: unknown) {
        // RPC failure is NOT the same as "account absent" — logging it
        // here makes a transient outage observable rather than silently
        // omitting the PDA from remaining_accounts, which would surface
        // downstream as an opaque "AccountMissing" from close_vault.
        const cause = redactCause(err);
        getSigilModuleLogger().warn(
          `[close_vault] existence check failed for ${pda} — treating as absent: ${cause.message ?? cause.name ?? cause.code ?? "unknown"}`,
        );
        return null;
      }
    }),
  );

  // Add existing PDAs as remaining_accounts in order:
  // 1. pending_policy (if exists) — must be first per close_vault.rs:95-98
  if (existenceChecks[0]) {
    remainingAccounts.push({
      address: existenceChecks[0],
      role: AccountRole.WRITABLE,
    });
  }
  // 2. pending_agent_perms (one per agent that has a pending update)
  for (let i = 0; i < agents.length; i++) {
    if (existenceChecks[1 + i]) {
      remainingAccounts.push({
        address: existenceChecks[1 + i]!,
        role: AccountRole.WRITABLE,
      });
    }
  }
  // 3. pending_close_constraints (if exists) — E1 fix: correct seed "pending_close_constraints"
  const constraintsIdx = 1 + agents.length;
  if (existenceChecks[constraintsIdx]) {
    remainingAccounts.push({
      address: existenceChecks[constraintsIdx]!,
      role: AccountRole.WRITABLE,
    });
  }

  // Append remaining accounts to instruction if any exist
  const finalIx =
    remainingAccounts.length > 0
      ? {
          ...ix,
          accounts: [
            ...(ix as any).accounts,
            ...remainingAccounts.map((a) => ({
              address: a.address,
              role: a.role,
            })),
          ],
        }
      : ix;

  return run(rpc, owner, network, [finalIx], {
    computeUnits: opts?.computeUnits ?? 400_000,
    priorityFeeMicroLamports: opts?.priorityFeeMicroLamports,
  });
}

// syncPositions mutation DELETED — position counter system removed per council
// decision (9-1 vote, 2026-04-19). See Plans/we-need-to-plan-serialized-summit.md.

export async function pauseAgent(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  agent: Address,
  opts?: TxOpts,
): Promise<TxResult> {
  requireValidAddress(agent, "Agent address");
  const ix = getPauseAgentInstruction({ owner, vault, agentToPause: agent });
  return run(rpc, owner, network, [ix], opts);
}

export async function unpauseAgent(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  agent: Address,
  opts?: TxOpts,
): Promise<TxResult> {
  requireValidAddress(agent, "Agent address");
  const ix = getUnpauseAgentInstruction({
    owner,
    vault,
    agentToUnpause: agent,
  });
  return run(rpc, owner, network, [ix], opts);
}

export async function revokeAgent(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  agent: Address,
  opts?: TxOpts,
): Promise<TxResult> {
  requireValidAddress(agent, "Agent address");
  const [overlayPda] = await getAgentOverlayPDA(vault, 0);
  const ix = getRevokeAgentInstruction({
    owner,
    vault,
    agentSpendOverlay: overlayPda,
    agentToRemove: agent,
  });
  return run(rpc, owner, network, [ix], opts);
}

export async function addAgent(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  agent: Address,
  permissions: CapabilityTier,
  spendingLimit: UsdBaseUnits,
  opts?: TxOpts,
): Promise<TxResult> {
  requireValidAddress(agent, "Agent address");
  requireValidPermissions(permissions);
  const [overlayPda] = await getAgentOverlayPDA(vault, 0);
  const ix = getRegisterAgentInstruction({
    owner,
    vault,
    agentSpendOverlay: overlayPda,
    agent,
    capability: Number(permissions),
    spendingLimitUsd: spendingLimit,
  });
  return run(rpc, owner, network, [ix], opts);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4: Complex mutations
// ═══════════════════════════════════════════════════════════════════════════════

export async function deposit(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  mint: Address,
  amount: bigint,
  opts?: TxOpts,
): Promise<TxResult> {
  requirePositiveAmount(amount, "Deposit amount");
  requireValidAddress(mint, "Token mint");
  const ix = await getDepositFundsInstructionAsync({
    owner,
    vault,
    mint,
    amount,
  });
  return run(rpc, owner, network, [ix], opts);
}

export async function withdraw(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  mint: Address,
  amount: bigint,
  opts?: TxOpts,
): Promise<TxResult> {
  requirePositiveAmount(amount, "Withdraw amount");
  requireValidAddress(mint, "Token mint");
  const ix = await getWithdrawFundsInstructionAsync({
    owner,
    vault,
    mint,
    amount,
  });
  return run(rpc, owner, network, [ix], opts);
}

/**
 * Queue a policy update. Client-side pre-validation catches the most common
 * mistakes before an RPC round-trip, but is not exhaustive — on-chain remains
 * the source of truth for all rejections.
 *
 * Client-validated (throws before sending):
 *   - `timelock` >= 1800s (30 min)
 *   - `dailyCap`, `maxPerTrade` > 0n
 *   - `developerFeeRate` <= 500 BPS
 *   - `approvedApps.length` <= MAX_ALLOWED_PROTOCOLS
 *
 * On-chain-only (silent pass through SDK, may fail on-chain):
 *   - `allowedDestinations.length` (MAX_ALLOWED_DESTINATIONS on-chain)
 *   - `protocolCaps.length` must equal `approvedApps.length` when has_protocol_caps
 *   - `maxSlippageBps` <= MAX_SLIPPAGE_BPS on-chain
 *   - `sessionExpirySeconds` range (5..=90 when > 0; audit F5-H1)
 */
export async function queuePolicyUpdate(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  changes: PolicyChanges,
  opts?: TxOpts,
): Promise<TxResult> {
  if (Object.keys(changes).length === 0) {
    throw toDxError(new Error("At least one policy change is required"));
  }
  if (changes.timelock != null && changes.timelock < 1800) {
    throw toDxError(
      new Error(
        `Timelock must be >= 1800 seconds (30 minutes). Got ${changes.timelock}. On-chain rejects TimelockTooShort.`,
      ),
    );
  }
  if (changes.dailyCap != null)
    requirePositiveAmount(changes.dailyCap, "Daily cap");
  if (changes.maxPerTrade != null)
    requirePositiveAmount(changes.maxPerTrade, "Max per trade");
  if (changes.developerFeeRate != null && changes.developerFeeRate > 500) {
    throw toDxError(
      new Error(
        `Developer fee rate cannot exceed 500 BPS (0.05%). Got ${changes.developerFeeRate}.`,
      ),
    );
  }
  if (
    changes.approvedApps &&
    changes.approvedApps.length > MAX_ALLOWED_PROTOCOLS
  ) {
    throw toDxError(
      new Error(
        `approvedApps length exceeds on-chain MAX_ALLOWED_PROTOCOLS (${MAX_ALLOWED_PROTOCOLS}). Got ${changes.approvedApps.length}. On-chain rejects TooManyAllowedProtocols.`,
      ),
    );
  }
  // Phase 2 TA-19: fetch live policy + vault state to compute the digest of
  // the merged-effective policy that WILL result if this update is applied.
  // The on-chain handler re-asserts the same digest at queue time, so any
  // owner blind-sign that diverges from the SDK-projected update is rejected.
  const [policyPda] = await getPolicyPDA(vault);
  const livePolicy = await fetchPolicyConfig(rpc, policyPda);
  const liveVault = await fetchAgentVault(rpc, vault);

  const newProtocolMode = changes.protocolMode
    ? mapProtocolMode(changes.protocolMode)
    : null;
  const effProtocolMode = newProtocolMode ?? livePolicy.data.protocolMode;
  const effProtocols = changes.approvedApps ?? livePolicy.data.protocols;
  const effDestinationMode =
    changes.destinationMode ?? livePolicy.data.destinationMode;
  const effDestinations =
    changes.allowedDestinations ?? livePolicy.data.allowedDestinations;
  const effDaily = changes.dailyCap ?? livePolicy.data.dailySpendingCapUsd;
  const effMaxTx =
    changes.maxPerTrade ?? livePolicy.data.maxTransactionSizeUsd;
  const effMaxSlip =
    changes.maxSlippageBps ?? livePolicy.data.maxSlippageBps;
  // PEN-CROSS-6: developer_fee_rate is now part of the digest. Project the
  // merged-effective value the same way as other Option<…> fields.
  const effDeveloperFeeRate =
    changes.developerFeeRate ?? livePolicy.data.developerFeeRate;
  const effTimelock =
    changes.timelock != null
      ? BigInt(changes.timelock)
      : livePolicy.data.timelockDuration;
  const effSessionExpiry =
    changes.sessionExpirySeconds ?? livePolicy.data.sessionExpirySeconds;

  const newPolicyPreviewDigest = computePolicyPreviewDigest({
    dailySpendingCapUsd: effDaily,
    maxTransactionSizeUsd: effMaxTx,
    maxSlippageBps: effMaxSlip,
    developerFeeRate: effDeveloperFeeRate,
    protocolMode: effProtocolMode,
    protocols: effProtocols,
    destinationMode: effDestinationMode,
    allowedDestinations: effDestinations,
    timelockDuration: effTimelock,
    sessionExpirySeconds: effSessionExpiry,
    observeOnly: liveVault.data.observeOnly,
    hasConstraints: livePolicy.data.hasConstraints,
    hasPostAssertions: livePolicy.data.hasPostAssertions,
    // PEN-CROSS-2: created_at_slot is immutable post-init — read from live.
    createdAtSlot: livePolicy.data.createdAtSlot,
    // TA-05 (Phase 3): operating_hours is policy-owned and bound by TA-19.
    // queueAgentPermissions does not currently mutate it through the
    // dashboard mutation surface — read from live policy.
    operatingHours: livePolicy.data.operatingHours,
    // TA-07/17 (Phase 3): same — not mutated by this dashboard surface.
    autoPromoteGrays: livePolicy.data.autoPromoteGrays,
    autoRevokeThreshold: livePolicy.data.autoRevokeThreshold,
  });

  const ix = await getQueuePolicyUpdateInstructionAsync({
    owner,
    vault,
    dailySpendingCapUsd: changes.dailyCap ?? null,
    maxTransactionAmountUsd: changes.maxPerTrade ?? null,
    protocolMode: newProtocolMode,
    protocols: changes.approvedApps ?? null,
    developerFeeRate: changes.developerFeeRate ?? null,
    maxSlippageBps: changes.maxSlippageBps ?? null,
    timelockDuration:
      changes.timelock != null ? BigInt(changes.timelock) : null,
    allowedDestinations: changes.allowedDestinations ?? null,
    sessionExpirySeconds: changes.sessionExpirySeconds ?? null,
    hasProtocolCaps: changes.hasProtocolCaps ?? null,
    protocolCaps: changes.protocolCaps ?? null,
    destinationMode: changes.destinationMode ?? null,
    // TA-05 (Phase 3): operating_hours is not mutated by this mutation
    // surface — pass null to fall through to live policy at on-chain merge.
    operatingHours: null,
    // TA-09 (Phase 3): non-elevated path by default — pass the
    // System Program / zero-pubkey ("11111111111111111111111111111111").
    // Elevated mutations through this dashboard surface require a
    // follow-on `queuePolicyElevated()` helper (not yet exposed).
    cosignSession:
      "11111111111111111111111111111111" as unknown as Address,
    newPolicyPreviewDigest,
  });
  return run(rpc, owner, network, [ix], opts);
}

export async function applyPendingPolicy(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  opts?: TxOpts,
): Promise<TxResult> {
  const ix = await getApplyPendingPolicyInstructionAsync({ owner, vault });
  return run(rpc, owner, network, [ix], opts);
}

export async function cancelPendingPolicy(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  opts?: TxOpts,
): Promise<TxResult> {
  const ix = await getCancelPendingPolicyInstructionAsync({ owner, vault });
  return run(rpc, owner, network, [ix], opts);
}

export async function queueAgentPermissions(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  agent: Address,
  permissions: CapabilityTier,
  spendingLimit: UsdBaseUnits,
  opts?: TxOpts,
  // TA-06 (Phase 3): per-agent cooldown_seconds. 0 = disabled. Optional so
  // existing dashboard callers continue compiling; pass non-zero when
  // configuring agents that need pacing.
  cooldownSeconds: bigint = 0n,
): Promise<TxResult> {
  requireValidAddress(agent, "Agent address");
  requireValidPermissions(permissions);
  const ix = await getQueueAgentPermissionsUpdateInstructionAsync({
    owner,
    vault,
    agent,
    newCapability: Number(permissions),
    spendingLimitUsd: spendingLimit,
    cooldownSeconds,
  });
  return run(rpc, owner, network, [ix], opts);
}

export async function applyAgentPermissions(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  agent: Address,
  opts?: TxOpts,
): Promise<TxResult> {
  requireValidAddress(agent, "Agent address");
  const [overlayPda] = await getAgentOverlayPDA(vault, 0);
  const pendingPda = await derivePendingAgentPermsPDA(vault, agent);
  const ix = await getApplyAgentPermissionsUpdateInstructionAsync({
    owner,
    vault,
    agentSpendOverlay: overlayPda,
    pendingAgentPerms: pendingPda,
  });
  return run(rpc, owner, network, [ix], opts);
}

export async function cancelAgentPermissions(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  agent: Address,
  opts?: TxOpts,
): Promise<TxResult> {
  requireValidAddress(agent, "Agent address");
  const pendingPda = await derivePendingAgentPermsPDA(vault, agent);
  const ix = getCancelAgentPermissionsUpdateInstruction({
    owner,
    vault,
    pendingAgentPerms: pendingPda,
  });
  return run(rpc, owner, network, [ix], opts);
}

/**
 * Allocate the constraints PDA and write the entries.
 *
 * Day-0 fix: this used to send only the `create_instruction_constraints`
 * instruction, which always failed because the PDA needs to be pre-allocated
 * to `InstructionConstraints::SIZE` (35,888 bytes) before the populate handler
 * runs. We now send the full 5-instruction chain (allocate + 3 extends +
 * populate) in one atomic transaction. See `constraint-builders.ts` for the
 * tx-size guardrail (~3 fully-populated entries per call).
 */
export async function createConstraints(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  entries: ConstraintEntry[],
  opts?: TxOpts,
): Promise<TxResult> {
  if (!entries || entries.length === 0)
    throw toDxError(new Error("Constraint entries must be a non-empty array"));
  try {
    const [policy] = await getPolicyPDA(vault);
    // PEN-CROSS-3: bind the post-mutation digest (`has_constraints=true`).
    const expectedDigest = await siblingHandlerExpectedDigest(rpc, vault, {
      hasConstraints: true,
    });
    const ixs = await buildCreateConstraintsIxs({
      owner,
      vault,
      policy,
      entries,
      expectedDigest,
    });
    return run(rpc, owner, network, ixs, opts);
  } catch (err: unknown) {
    throw toDxError(err);
  }
}

/**
 * Allocate the pending constraints PDA and queue an update.
 *
 * Same Day-0 fix as `createConstraints` but targets the `pending_constraints`
 * PDA at 35,904 bytes (16 more than `InstructionConstraints` for the extra
 * timestamp fields in `PendingConstraintsUpdate`).
 */
export async function queueConstraintsUpdate(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  entries: ConstraintEntry[],
  opts?: TxOpts,
): Promise<TxResult> {
  if (!entries || entries.length === 0)
    throw toDxError(new Error("Constraint entries must be a non-empty array"));
  try {
    const [policy] = await getPolicyPDA(vault);
    const ixs = await buildQueueConstraintsUpdateIxs({
      owner,
      vault,
      policy,
      entries,
    });
    return run(rpc, owner, network, ixs, opts);
  } catch (err: unknown) {
    throw toDxError(err);
  }
}

export async function applyConstraintsUpdate(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  opts?: TxOpts,
): Promise<TxResult> {
  const ix = await getApplyConstraintsUpdateInstructionAsync({ owner, vault });
  return run(rpc, owner, network, [ix], opts);
}

export async function cancelConstraintsUpdate(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  opts?: TxOpts,
): Promise<TxResult> {
  const ix = await getCancelConstraintsUpdateInstructionAsync({ owner, vault });
  return run(rpc, owner, network, [ix], opts);
}

export async function queueCloseConstraints(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  opts?: TxOpts,
): Promise<TxResult> {
  const ix = await getQueueCloseConstraintsInstructionAsync({ owner, vault });
  return run(rpc, owner, network, [ix], opts);
}

export async function applyCloseConstraints(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  opts?: TxOpts,
): Promise<TxResult> {
  // PEN-CROSS-3: bind the post-mutation digest (`has_constraints=false`)
  // into the ix. Handler rejects on mismatch — defends owner blind-sign.
  const expectedDigest = await siblingHandlerExpectedDigest(rpc, vault, {
    hasConstraints: false,
  });
  const ix = await getApplyCloseConstraintsInstructionAsync({
    owner,
    vault,
    expectedDigest,
  });
  return run(rpc, owner, network, [ix], opts);
}

export async function cancelCloseConstraints(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  opts?: TxOpts,
): Promise<TxResult> {
  const ix = await getCancelCloseConstraintsInstructionAsync({ owner, vault });
  return run(rpc, owner, network, [ix], opts);
}

// ─── Post-execution assertions (Phase 2) ─────────────────────────────────────
// Composes with pre-execution InstructionConstraints — NOT a replacement.
//
// Pre-execution (createConstraints above): validates instruction args BEFORE
// the DeFi call runs. Fails closed on disallowed instructions.
//
// Post-execution (createPostAssertions below): snapshots account bytes before
// finalize_session, compares against the on-chain PostExecutionAssertions PDA
// after the DeFi call completes, reverts the whole tx on mismatch. Used for
// leverage caps (CrossFieldLte) and similar "state-after-is-bounded" checks.
//
// Both wrappers auto-derive their respective PDAs — callers pass only the
// vault. Validation runs client-side so the caller never burns a round-trip
// on an entry the on-chain validate_entries would reject. See
// `post-assertion-validation.ts` and Phase 2 PRD ISC-6..9.

/**
 * Create the PostExecutionAssertions PDA for a vault and write the entries.
 *
 * Every entry is validated client-side first (see `validatePostAssertionEntries`).
 * A mid-batch rejection throws a DxError with a message pointing at the
 * offending index; the transaction is never built.
 *
 * Idempotency: calling this twice on the same vault without an intervening
 * close returns an Anchor `AccountAlreadyExists` (3010) — Anchor's `init`
 * constraint enforces this at the program boundary. Phase 2 ISC-45.
 *
 * Rent: destination on close is the vault's owner (Anchor `close = owner`
 * on the account), so `closePostAssertions` refunds to the owner signer.
 *
 * @param rpc      RPC client for blockhash resolution + tx submission.
 * @param vault    Vault PDA this assertions set belongs to.
 * @param owner    Owner signer — must match the vault's `owner` field.
 * @param network  Cluster selector (devnet / mainnet).
 * @param entries  1..=4 PostAssertionEntry values. Validated before send.
 * @param opts     Optional TxOpts (compute budget, priority fee).
 * @returns        TxResult with the confirmed signature.
 */
export async function createPostAssertions(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  entries: PostAssertionEntry[],
  opts?: TxOpts,
): Promise<TxResult> {
  // Client-side check mirrors on-chain validate_entries. Throws
  // PostAssertionValidationError, which is structurally a DxError (numeric
  // `code`, `message`, `recovery: string[]`) AND carries the typed
  // `validationCode` + `entryIndex` for FE branching. We intentionally do
  // NOT wrap via toDxError — that would collapse the typed fields into
  // DX_ERROR_CODE_UNMAPPED (7999) and break ISC-19's "pinpoint the bad
  // entry" promise. See post-assertion-validation.ts docblock.
  validatePostAssertionEntries(entries);

  // PEN-CROSS-3: bind the post-mutation digest (`has_post_assertions=1`).
  const expectedDigest = await siblingHandlerExpectedDigest(rpc, vault, {
    hasPostAssertions: 1,
  });
  const ix = await getCreatePostAssertionsInstructionAsync({
    owner,
    vault,
    entries,
    expectedDigest,
  });
  return run(rpc, owner, network, [ix], opts);
}

/**
 * Close the PostExecutionAssertions PDA for a vault. Rent refunds to owner.
 *
 * No-op if the PDA does not exist — Anchor's `close` attribute will reject
 * the instruction with `AccountNotInitialized` if there's nothing to close;
 * the DxError surface communicates this cleanly.
 *
 * After close, `has_post_assertions` on PolicyConfig flips 0 and
 * finalize_session skips the post-assertion scan on future agent txs.
 *
 * @param rpc      RPC client for blockhash resolution + tx submission.
 * @param vault    Vault PDA whose assertions set should be closed.
 * @param owner    Owner signer — receives the rent refund.
 * @param network  Cluster selector.
 * @param opts     Optional TxOpts.
 * @returns        TxResult with the confirmed signature.
 */
export async function closePostAssertions(
  rpc: Rpc<SolanaRpcApi>,
  vault: Address,
  owner: TransactionSigner,
  network: "devnet" | "mainnet",
  opts?: TxOpts,
): Promise<TxResult> {
  // PEN-CROSS-3: bind the post-mutation digest (`has_post_assertions=0`).
  const expectedDigest = await siblingHandlerExpectedDigest(rpc, vault, {
    hasPostAssertions: 0,
  });
  const ix = await getClosePostAssertionsInstructionAsync({
    owner,
    vault,
    expectedDigest,
  });
  return run(rpc, owner, network, [ix], opts);
}
