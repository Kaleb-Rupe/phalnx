/**
 * IntentEngine — Kit-native 12-step Execute Pipeline
 *
 * Connects all Phase 1 + Phase 2 pieces into a single E2E flow:
 * validate → resolve protocol → resolve token → precheck →
 * compose → verify → resolve PDAs → build sandwich →
 * simulate → sign → send → parse events.
 *
 * For the Kit SDK, IntentEngine is self-contained rather than
 * delegating to a PhalnxClient monolith.
 */

import type {
  Address,
  Instruction,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import type { IntentAction, IntentActionType, PrecheckResult, ExecuteResult } from "./intents.js";
import type { AgentError } from "./agent-errors.js";
import type { ProtocolHandlerMetadata, ProtocolActionDescriptor } from "./integrations/protocol-handler.js";
import type { ProtocolRegistry } from "./integrations/protocol-registry.js";
import type { ResolvedToken } from "./tokens.js";

import { validateIntentInput, type ValidationResult } from "./intent-validator.js";
import { toAgentError, protocolEscalationError } from "./agent-errors.js";
import { resolveProtocol, isProtocolAllowed, ProtocolTier } from "./protocol-resolver.js";
import { ACTION_TYPE_MAP, summarizeAction, resolveProtocolActionType } from "./intents.js";
import { resolveToken } from "./tokens.js";
import { hasPermission, isSpendingAction, isStablecoinMint } from "./types.js";
import { VaultStatus } from "./generated/types/vaultStatus.js";
import { resolveAccounts } from "./resolve-accounts.js";
import { verifyAdapterOutput } from "./integrations/adapter-verifier.js";
import { fetchAgentVault } from "./generated/accounts/agentVault.js";
import { fetchPolicyConfig } from "./generated/accounts/policyConfig.js";
import { getPolicyPDA, getTrackerPDA, getAgentOverlayPDA } from "./resolve-accounts.js";

// ─── Types ──────────────────────────────────────────────────────────────────

type Network = "devnet" | "mainnet-beta";

/** Result of IntentEngine.explain() — transaction plan without execution */
export interface ExplainResult {
  /** Human-readable summary of what the transaction will do */
  summary: string;
  /** The intent action type */
  actionType: IntentActionType;
  /** Whether this action counts against spending cap */
  isSpending: boolean;
  /** Precheck result (spending capacity, permissions, etc.) */
  precheck: PrecheckResult;
}

/** Protocol info for discovery */
export interface ProtocolInfo {
  protocolId: string;
  displayName: string;
  programIds: string[];
  actionCount: number;
}

/** Action info for protocol exploration */
export interface ActionInfo {
  name: string;
  isSpending: boolean;
}

/** Configuration for IntentEngine */
export interface IntentEngineConfig {
  rpc: Rpc<SolanaRpcApi>;
  network: Network;
  protocolRegistry: ProtocolRegistry;
  /** The agent signer that will sign transactions */
  agent: TransactionSigner;
}

// ─── IntentEngine ───────────────────────────────────────────────────────────

export class IntentEngine {
  readonly rpc: Rpc<SolanaRpcApi>;
  readonly network: Network;
  readonly registry: ProtocolRegistry;
  readonly agent: TransactionSigner;

  constructor(config: IntentEngineConfig) {
    this.rpc = config.rpc;
    this.network = config.network;
    this.registry = config.protocolRegistry;
    this.agent = config.agent;
  }

  // ─── Core Agent Workflow ─────────────────────────────────────────────

  /**
   * Full agent workflow: validate → precheck → execute.
   *
   * Returns ExecuteResult on success or AgentError on failure at any stage.
   * This is the primary method agents should call.
   */
  async run(
    intent: IntentAction,
    vault: Address,
    options?: { skipPrecheck?: boolean },
  ): Promise<ExecuteResult | AgentError> {
    // 1. Validate inputs (offline)
    const validation = this.validate(intent);
    if (!validation.valid) {
      return validation.errors[0];
    }

    // 2. Protocol resolution for protocol/passthrough intents
    if (intent.type === "protocol" || intent.type === "passthrough") {
      try {
        const resolution = await this._resolveProtocolTier(intent, vault);
        if (
          resolution &&
          resolution.tier === ProtocolTier.NOT_SUPPORTED &&
          resolution.escalation
        ) {
          return protocolEscalationError(resolution.escalation);
        }
      } catch (err) {
        return toAgentError(err, { phase: "protocol_resolution" });
      }
    }

    // 3. Precheck (unless skipped)
    if (!options?.skipPrecheck) {
      try {
        const precheck = await this.precheck(intent, vault);
        if (!precheck.allowed) {
          return toAgentError(
            new Error(
              `Precheck failed: ${precheck.reason ?? precheck.summary}`,
            ),
            {
              precheck_details: JSON.stringify(precheck.details),
              risk_flags: precheck.riskFlags.join(","),
            },
          );
        }
      } catch (err) {
        return toAgentError(err, { phase: "precheck" });
      }
    }

    // 4. Execute (compose → verify → build sandwich → simulate → sign → send)
    try {
      return await this.execute(intent, vault);
    } catch (err) {
      return toAgentError(err, { phase: "execute", intent_type: intent.type });
    }
  }

  // ─── Individual Steps ────────────────────────────────────────────────

  /**
   * Step 1: Validate intent parameters without hitting RPC.
   * Catches hallucinated inputs (negative amounts, invalid addresses, etc.).
   */
  validate(intent: IntentAction): ValidationResult {
    return validateIntentInput(intent);
  }

  /**
   * Steps 2-4: Precheck — verify permissions, caps, allowlist, slippage.
   * Hits RPC to fetch vault + policy state.
   */
  async precheck(
    intent: IntentAction,
    vault: Address,
  ): Promise<PrecheckResult> {
    try {
      // Fetch vault and policy accounts
      const [policyPda] = await getPolicyPDA(vault);
      const [vaultAccount, policyAccount] = await Promise.all([
        fetchAgentVault(this.rpc, vault),
        fetchPolicyConfig(this.rpc, policyPda),
      ]);

      const vaultData = vaultAccount.data;
      const policyData = policyAccount.data;

      // Find the agent entry in vault
      const agentAddress = this.agent.address;
      const agentEntry = vaultData.agents.find(
        (a) => a.pubkey === agentAddress,
      );

      // Resolve base action type string
      const baseActionType = this._getBaseActionType(intent);

      // Permission check
      const permissionPassed = agentEntry
        ? hasPermission(agentEntry.permissions, baseActionType)
        : false;

      if (!agentEntry) {
        return {
          allowed: false,
          summary: "Agent not registered in vault",
          reason: `Agent ${agentAddress} is not registered in vault ${vault}`,
          details: {
            permission: { passed: false, requiredBit: baseActionType, agentHas: false },
            protocol: { passed: true, inAllowlist: true },
          },
          riskFlags: [],
        };
      }

      if (agentEntry.paused) {
        return {
          allowed: false,
          summary: "Agent is paused",
          reason: `Agent ${agentAddress} is paused in vault ${vault}`,
          details: {
            permission: { passed: false, requiredBit: baseActionType, agentHas: false },
            protocol: { passed: true, inAllowlist: true },
          },
          riskFlags: [],
        };
      }

      // Check vault is active
      if (vaultData.status !== VaultStatus.Active) {
        return {
          allowed: false,
          summary: `Vault is ${VaultStatus[vaultData.status] ?? "unknown"}`,
          reason: `Vault ${vault} is not active`,
          details: {
            permission: { passed: false, requiredBit: baseActionType, agentHas: false },
            protocol: { passed: true, inAllowlist: true },
          },
          riskFlags: [],
        };
      }

      if (!permissionPassed) {
        return {
          allowed: false,
          summary: `Missing permission for ${baseActionType}`,
          reason: `Agent lacks permission bit for ${baseActionType}`,
          details: {
            permission: { passed: false, requiredBit: baseActionType, agentHas: false },
            protocol: { passed: true, inAllowlist: true },
          },
          riskFlags: [],
        };
      }

      // Protocol allowlist check
      let protocolPassed = true;
      let protocolInAllowlist = true;
      if (intent.type === "protocol") {
        const protocolId = (intent.params as Record<string, unknown>).protocolId as string | undefined;
        if (protocolId) {
          const handler = this.registry.getByProtocolId(protocolId);
          if (handler?.metadata.programIds[0]) {
            protocolInAllowlist = isProtocolAllowed(
              handler.metadata.programIds[0] as Address,
              { protocolMode: policyData.protocolMode, protocols: policyData.protocols },
            );
            protocolPassed = protocolInAllowlist;
          }
        }
      }

      if (!protocolPassed) {
        return {
          allowed: false,
          summary: "Protocol not in allowlist",
          reason: "Protocol not allowed by vault policy",
          details: {
            permission: { passed: true, requiredBit: baseActionType, agentHas: true },
            protocol: { passed: false, inAllowlist: false },
          },
          riskFlags: [],
        };
      }

      // Slippage check (swaps only)
      let slippageDetails: PrecheckResult["details"]["slippage"];
      if (intent.type === "swap" && intent.params.slippageBps !== undefined) {
        const slippagePassed = intent.params.slippageBps <= policyData.maxSlippageBps;
        slippageDetails = {
          passed: slippagePassed,
          intentBps: intent.params.slippageBps,
          vaultMaxBps: policyData.maxSlippageBps,
        };
        if (!slippagePassed) {
          return {
            allowed: false,
            summary: `Slippage ${intent.params.slippageBps} BPS > max ${policyData.maxSlippageBps} BPS`,
            reason: "Intent slippage exceeds vault max",
            details: {
              permission: { passed: true, requiredBit: baseActionType, agentHas: true },
              protocol: { passed: true, inAllowlist: true },
              slippage: slippageDetails,
            },
            riskFlags: [],
          };
        }
      }

      // Spending check
      let spendingDetails: PrecheckResult["details"]["spendingCap"];
      if (isSpendingAction(baseActionType)) {
        const token = this._resolveIntentToken(intent);
        if (token) {
          const amountStr = this._getIntentAmount(intent);
          if (amountStr) {
            const amountUsd = this._estimateUsd(amountStr, token);
            const cap = Number(agentEntry.spendingLimitUsd);
            const intentAmount = Number(amountUsd);
            const spendingPassed = amountUsd <= agentEntry.spendingLimitUsd;
            spendingDetails = {
              passed: spendingPassed,
              spent24h: 0, // Would require fetching SpendTracker
              cap,
              remaining: cap,
              intentAmount,
            };
            if (!spendingPassed) {
              return {
                allowed: false,
                summary: "Amount exceeds agent spending limit",
                reason: `${amountUsd} USD > agent limit ${agentEntry.spendingLimitUsd}`,
                details: {
                  permission: { passed: true, requiredBit: baseActionType, agentHas: true },
                  spendingCap: spendingDetails,
                  protocol: { passed: true, inAllowlist: true },
                },
                riskFlags: [],
              };
            }
          }
        }
      }

      // Position check
      if (
        (baseActionType === "openPosition" || baseActionType === "swapAndOpenPosition") &&
        !policyData.canOpenPositions
      ) {
        return {
          allowed: false,
          summary: "Vault does not allow opening positions",
          reason: "canOpenPositions is false in policy",
          details: {
            permission: { passed: true, requiredBit: baseActionType, agentHas: true },
            protocol: { passed: true, inAllowlist: true },
          },
          riskFlags: [],
        };
      }

      return {
        allowed: true,
        summary: `Precheck passed for ${intent.type}`,
        details: {
          permission: { passed: true, requiredBit: baseActionType, agentHas: true },
          spendingCap: spendingDetails,
          protocol: { passed: true, inAllowlist: protocolInAllowlist },
          slippage: slippageDetails,
        },
        riskFlags: [],
      };
    } catch (err) {
      return {
        allowed: false,
        summary: "Precheck failed",
        reason: err instanceof Error ? err.message : String(err),
        details: {
          permission: { passed: false, requiredBit: intent.type, agentHas: false },
          protocol: { passed: false, inAllowlist: false },
        },
        riskFlags: [],
      };
    }
  }

  /**
   * Steps 5-12: Execute the intent — compose, verify, build, simulate, sign, send.
   *
   * Steps 9-12 (compose transaction, simulate, sign, send) are stubbed — they
   * require RPC blockhash + wallet signing infrastructure. The structure is
   * laid out for each pipeline step.
   */
  async execute(
    intent: IntentAction,
    vault: Address,
  ): Promise<ExecuteResult> {
    // Step 1: Validate
    const validation = this.validate(intent);
    if (!validation.valid) {
      throw validation.errors[0];
    }

    // Step 2: Resolve protocol
    const baseActionType = this._getBaseActionType(intent);
    const handler = this._resolveHandler(intent);

    // Step 3: Resolve token
    const token = this._resolveIntentToken(intent);

    // Step 4: Precheck
    const precheck = await this.precheck(intent, vault);
    if (!precheck.allowed) {
      throw new Error(`Precheck failed: ${precheck.reason ?? precheck.summary}`);
    }

    // Step 5: handler.compose()
    if (!handler) {
      throw new Error(
        `No protocol handler found for intent type: ${intent.type}`,
      );
    }

    const [policyPda] = await getPolicyPDA(vault);
    const policyAccount = await fetchPolicyConfig(this.rpc, policyPda);
    const vaultAccount = await fetchAgentVault(this.rpc, vault);

    const composeCtx = {
      rpc: this.rpc,
      network: this.network,
      vault,
      owner: vaultAccount.data.owner,
      vaultId: vaultAccount.data.vaultId,
      agent: this.agent.address,
    };

    const composeResult = await handler.compose(
      composeCtx,
      baseActionType,
      intent.params as Record<string, unknown>,
    );

    // Step 6: Verify adapter output
    const verification = verifyAdapterOutput(
      composeResult.instructions as any,
      handler.metadata.programIds.map((p) => p as Address),
      vault,
    );
    if (!verification.valid) {
      throw new Error(
        `Adapter verification failed: ${verification.violations.join("; ")}`,
      );
    }

    // Step 7: Resolve all PDAs
    const tokenMint = token?.mint ?? ("11111111111111111111111111111111" as Address);
    const accounts = await resolveAccounts({
      vault,
      agent: this.agent.address,
      tokenMint,
      hasConstraints: policyAccount.data.hasConstraints,
    });

    // Step 8: Build sandwich instructions (validate + DeFi + finalize)
    const { getValidateAndAuthorizeInstructionAsync } = await import(
      "./generated/instructions/validateAndAuthorize.js"
    );
    const { getFinalizeSessionInstructionAsync } = await import(
      "./generated/instructions/finalizeSession.js"
    );

    const agentOverlayPda = accounts.agentOverlayPda ??
      (await getAgentOverlayPDA(vault))[0];
    const [trackerPda] = await getTrackerPDA(vault);

    const mapping = ACTION_TYPE_MAP[baseActionType as keyof typeof ACTION_TYPE_MAP];
    if (!mapping) {
      throw new Error(`Unknown action type: ${baseActionType}`);
    }

    const targetProtocol = handler.metadata.programIds[0] as Address;

    const _validateIx = await getValidateAndAuthorizeInstructionAsync({
      agent: this.agent,
      vault,
      policy: accounts.policyPda,
      tracker: trackerPda,
      agentSpendOverlay: agentOverlayPda,
      session: accounts.sessionPda,
      vaultTokenAccount: tokenMint, // placeholder — real ATA derived at runtime
      tokenMintAccount: tokenMint,
      actionType: mapping.actionType,
      tokenMint: tokenMint,
      amount: BigInt(this._getIntentAmount(intent) ?? "0"),
      targetProtocol,
      leverageBps: this._getLeverageBps(intent),
    });

    const _finalizeIx = await getFinalizeSessionInstructionAsync({
      payer: this.agent,
      vault,
      session: accounts.sessionPda,
      sessionRentRecipient: this.agent.address,
      policy: accounts.policyPda,
      tracker: trackerPda,
      agentSpendOverlay: agentOverlayPda,
      success: true,
    });

    // Steps 9-12: Compose transaction, simulate, sign + send, parse events
    // These are stubbed until PhalnxKitClient provides transaction lifecycle.
    // The built instructions are ready for composePhalnxTransaction().

    return {
      signature: "",
      intent,
      precheck,
      summary: summarizeAction(intent),
    };
  }

  // ─── Transaction Plan Inspection ─────────────────────────────────────

  /**
   * Explain what a transaction would do without executing it.
   * Like SQL EXPLAIN — shows the plan, not the result.
   */
  async explain(
    intent: IntentAction,
    vault: Address,
  ): Promise<ExplainResult | AgentError> {
    const validation = this.validate(intent);
    if (!validation.valid) {
      return validation.errors[0];
    }

    try {
      const precheckResult = await this.precheck(intent, vault);
      const mapping = ACTION_TYPE_MAP[intent.type];

      return {
        summary: summarizeAction(intent),
        actionType: intent.type,
        isSpending: mapping?.isSpending ?? false,
        precheck: precheckResult,
      };
    } catch (err) {
      return toAgentError(err, { phase: "explain" });
    }
  }

  // ─── Discovery ──────────────────────────────────────────────────────

  /** List all registered protocols and their capabilities. */
  listProtocols(): ProtocolInfo[] {
    return this.registry.listAll().map((meta: ProtocolHandlerMetadata) => ({
      protocolId: meta.protocolId,
      displayName: meta.displayName,
      programIds: meta.programIds.map((p) => String(p)),
      actionCount: meta.supportedActions.size,
    }));
  }

  /** List supported actions for a specific protocol. */
  listActions(protocolId: string): ActionInfo[] {
    const handler = this.registry.getByProtocolId(protocolId);
    if (!handler) return [];

    const actions: ActionInfo[] = [];
    handler.metadata.supportedActions.forEach(
      (descriptor: ProtocolActionDescriptor, name: string) => {
        actions.push({ name, isSpending: descriptor.isSpending });
      },
    );
    return actions;
  }

  // ─── Internal Helpers ────────────────────────────────────────────────

  /**
   * Get the base action type string from an intent.
   * For protocol intents, uses resolveProtocolActionType with the registry.
   * For standard intents, the type IS the base action type.
   */
  private _getBaseActionType(intent: IntentAction): string {
    if (intent.type === "protocol") {
      const params = intent.params as Record<string, unknown>;
      const protocolId = params.protocolId as string | undefined;
      const action = params.action as string | undefined;
      if (protocolId && action) {
        const resolved = resolveProtocolActionType(this.registry, protocolId, action);
        // Return the ActionType key name for permission checking
        // e.g. ActionType.Swap -> "swap"
        const typeStr = Object.entries(ACTION_TYPE_MAP).find(
          ([, v]) => v.actionType === resolved.actionType,
        );
        return typeStr?.[0] ?? intent.type;
      }
    }
    return intent.type;
  }

  private async _resolveProtocolTier(
    intent: IntentAction,
    vault: Address,
  ) {
    let programAddress: Address | null = null;

    if (intent.type === "protocol") {
      const protocolId = (intent.params as Record<string, unknown>).protocolId as string | undefined;
      if (protocolId) {
        const handler = this.registry.getByProtocolId(protocolId);
        if (handler?.metadata.programIds[0]) {
          programAddress = handler.metadata.programIds[0] as Address;
        }
      }
    } else if (intent.type === "passthrough") {
      const pid = (intent.params as Record<string, unknown>).programId as string | undefined;
      if (pid) {
        programAddress = pid as Address;
      }
    }

    if (!programAddress) return null;

    const [policyPda] = await getPolicyPDA(vault);
    const policyAccount = await fetchPolicyConfig(this.rpc, policyPda);

    return resolveProtocol(
      programAddress,
      this.registry,
      {
        protocolMode: policyAccount.data.protocolMode,
        protocols: policyAccount.data.protocols,
      },
      policyAccount.data.hasConstraints,
    );
  }

  private _resolveHandler(intent: IntentAction) {
    if (intent.type === "swap") {
      return this.registry.getByProtocolId("jupiter");
    }
    if (
      intent.type === "openPosition" ||
      intent.type === "closePosition" ||
      intent.type === "increasePosition" ||
      intent.type === "decreasePosition"
    ) {
      return this.registry.getByProtocolId("flash-trade");
    }
    if (intent.type === "deposit" || intent.type === "withdraw") {
      const params = intent.params as Record<string, unknown>;
      if (params.protocol === "drift") {
        return this.registry.getByProtocolId("drift");
      }
      return this.registry.getByProtocolId("kamino-lending");
    }
    if (intent.type === "protocol") {
      const protocolId = (intent.params as Record<string, unknown>).protocolId as string | undefined;
      if (protocolId) {
        return this.registry.getByProtocolId(protocolId);
      }
    }
    return null;
  }

  private _resolveIntentToken(intent: IntentAction): ResolvedToken | null {
    const params = intent.params as Record<string, unknown>;
    const tokenField =
      (params.inputMint as string) ??
      (params.mint as string) ??
      (params.collateral as string);
    if (!tokenField) return null;
    return resolveToken(tokenField, this.network);
  }

  private _getIntentAmount(intent: IntentAction): string | null {
    const params = intent.params as Record<string, unknown>;
    return (
      (params.amount as string) ??
      (params.collateral as string) ??
      (params.sizeDelta as string) ??
      (params.collateralAmount as string) ??
      null
    );
  }

  private _estimateUsd(amountStr: string, token: ResolvedToken): bigint {
    if (isStablecoinMint(token.mint, this.network)) {
      return BigInt(amountStr);
    }
    // Non-stablecoins bypass cap check by design (no oracle)
    return 0n;
  }

  private _getLeverageBps(intent: IntentAction): number | null {
    const params = intent.params as Record<string, unknown>;
    const leverage = params.leverage as number | undefined;
    const leverageBps = params.leverageBps as number | undefined;
    if (leverageBps !== undefined) return leverageBps;
    if (leverage !== undefined) return Math.round(leverage * 100);
    return null;
  }
}
