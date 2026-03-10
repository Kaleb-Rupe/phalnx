/**
 * Protocol Resolver — 4-Tier Dispatch + Escalation
 *
 * Determines which tier handles a given protocol request:
 *   T1: API-Mediated (Jupiter REST API)
 *   T2: SDK-Wrapped (Drift, Flash Trade, Kamino)
 *   T3: IDL-Generated (future)
 *   T4: Passthrough (raw instructions + on-chain constraints)
 *   T5: NOT_SUPPORTED (structured escalation to human)
 */

import { PublicKey } from "@solana/web3.js";
import type { ProtocolRegistry } from "./integrations/protocol-registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum ProtocolTier {
  T1_API = 1,
  T2_SDK = 2,
  T3_IDL = 3,
  T4_PASSTHROUGH = 4,
  NOT_SUPPORTED = 5,
}

export interface ProtocolResolution {
  tier: ProtocolTier;
  protocolId: string;
  programId: PublicKey;
  displayName: string;
  reason: string;
  constraintsConfigured?: boolean;
  escalation?: EscalationInfo;
}

export interface EscalationInfo {
  type:
    | "not_in_allowlist"
    | "no_handler_no_constraints"
    | "no_handler_has_constraints"
    | "not_in_allowlist_and_no_handler";
  message: string;
  requiredActions: string[];
  alternatives?: {
    protocolId: string;
    displayName: string;
    tier: ProtocolTier;
  }[];
}

// ---------------------------------------------------------------------------
// T1 protocols (API-mediated)
// ---------------------------------------------------------------------------

const T1_PROTOCOL_IDS = new Set(["jupiter"]);

// ---------------------------------------------------------------------------
// T2 protocols (SDK-wrapped) — keyed by registry protocolId
// ---------------------------------------------------------------------------

const T2_PROTOCOL_IDS = new Set([
  "drift",
  "flash-trade",
  "kamino-lending",
]);

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

/**
 * Check if a program is in the vault's protocol allowlist/denylist.
 */
export function isProtocolAllowed(
  programId: PublicKey,
  policy: { protocolMode: number; protocols: PublicKey[] },
): boolean {
  if (policy.protocolMode === 0) return true;
  const isInList = policy.protocols.some(
    (p) => p.toBase58() === programId.toBase58(),
  );
  if (policy.protocolMode === 1) return isInList; // allowlist
  return !isInList; // denylist
}

/**
 * Resolve the tier and escalation info for a given protocol.
 *
 * Resolution logic:
 * 1. Handler exists + in allowlist → T1 or T2
 * 2. Handler exists + NOT in allowlist → NOT_SUPPORTED ("not_in_allowlist")
 * 3. No handler + in allowlist + constraints → T4_PASSTHROUGH
 * 4. No handler + in allowlist + NO constraints → NOT_SUPPORTED ("no_handler_no_constraints")
 * 5. No handler + NOT in allowlist → NOT_SUPPORTED ("not_in_allowlist_and_no_handler")
 */
export function resolveProtocol(
  programId: PublicKey,
  registry: ProtocolRegistry,
  policy: { protocolMode: number; protocols: PublicKey[] },
  constraintsConfigured: boolean,
): ProtocolResolution {
  const programBase58 = programId.toBase58();

  // Check registry for a handler
  const handler = registry.getByProgramId(programId);
  const allowed = isProtocolAllowed(programId, policy);

  if (handler) {
    const protocolId = handler.metadata.protocolId;
    const displayName = handler.metadata.displayName;

    if (!allowed) {
      // Path 2: Handler exists but not in allowlist
      return {
        tier: ProtocolTier.NOT_SUPPORTED,
        protocolId,
        programId,
        displayName,
        reason: `${displayName} is not in the vault's protocol allowlist`,
        escalation: {
          type: "not_in_allowlist",
          message: `${displayName} (${programBase58}) is not in your vault's protocol allowlist.`,
          requiredActions: [
            `Add program ${programBase58} to the vault's protocol allowlist`,
          ],
        },
      };
    }

    // Path 1: Handler exists + allowed
    const tier = T1_PROTOCOL_IDS.has(protocolId)
      ? ProtocolTier.T1_API
      : T2_PROTOCOL_IDS.has(protocolId)
        ? ProtocolTier.T2_SDK
        : ProtocolTier.T2_SDK;

    return {
      tier,
      protocolId,
      programId,
      displayName,
      reason: `${displayName} handled via ${tier === ProtocolTier.T1_API ? "API" : "SDK"} adapter`,
    };
  }

  // No handler — check allowlist and constraints
  if (allowed && constraintsConfigured) {
    // Path 3: No handler + allowed + constraints → T4 Passthrough
    return {
      tier: ProtocolTier.T4_PASSTHROUGH,
      protocolId: programBase58,
      programId,
      displayName: programBase58,
      reason: "No SDK handler — using on-chain constraint validation (passthrough)",
      constraintsConfigured: true,
    };
  }

  if (allowed && !constraintsConfigured) {
    // Path 4: No handler + allowed + NO constraints
    return {
      tier: ProtocolTier.NOT_SUPPORTED,
      protocolId: programBase58,
      programId,
      displayName: programBase58,
      reason: "Protocol is allowed but no handler or constraints are configured",
      escalation: {
        type: "no_handler_no_constraints",
        message: `Program ${programBase58} is in the allowlist but has no SDK handler and no on-chain instruction constraints configured.`,
        requiredActions: [
          `Configure instruction constraints for program ${programBase58} using createConstraints`,
        ],
        alternatives: buildAlternatives(registry, "lending"),
      },
    };
  }

  // Path 5: No handler + NOT in allowlist
  return {
    tier: ProtocolTier.NOT_SUPPORTED,
    protocolId: programBase58,
    programId,
    displayName: programBase58,
    reason: "Protocol has no handler and is not in the vault's allowlist",
    escalation: {
      type: "not_in_allowlist_and_no_handler",
      message: `Program ${programBase58} is not in the vault's protocol allowlist and has no registered SDK handler.`,
      requiredActions: [
        `Add program ${programBase58} to the vault's protocol allowlist`,
        `Configure instruction constraints for program ${programBase58}`,
      ],
      alternatives: buildAlternatives(registry, "general"),
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAlternatives(
  registry: ProtocolRegistry,
  _category: string,
): EscalationInfo["alternatives"] {
  return registry.listAll().map((meta) => ({
    protocolId: meta.protocolId,
    displayName: meta.displayName,
    tier: T1_PROTOCOL_IDS.has(meta.protocolId)
      ? ProtocolTier.T1_API
      : ProtocolTier.T2_SDK,
  }));
}
