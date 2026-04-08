/**
 * @usesigil/kit/dashboard — Error normalization for OwnerClient operations.
 *
 * Centralizes the toDxError helper used by both reads.ts and mutations.ts to
 * map any thrown error into the DxError type defined in types.ts. The optional
 * `context` argument prepends an "OwnerClient.<method>: " prefix to the message
 * so callers can tell which read/mutation produced the error.
 */

import { toAgentError } from "../agent-errors.js";
import type { DxError } from "./types.js";

/** Normalize any error into a DxError with code, message, and recovery actions. */
export function toDxError(err: unknown, context?: string): DxError {
  try {
    const agentErr = toAgentError(err);
    const code = (() => {
      const n = Number(agentErr.code);
      return Number.isFinite(n) ? n : 7000;
    })();
    return {
      code,
      message: context ? `${context}: ${agentErr.message}` : agentErr.message,
      recovery:
        agentErr.recovery_actions?.map(
          (a: { description?: string; action?: string }) =>
            a.description ?? a.action ?? "",
        ) ?? [],
    };
  } catch {
    // toAgentError itself failed — wrap the original error.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      code: 7999,
      message: context ? `${context}: ${msg}` : msg,
      recovery: ["Check transaction logs for details"],
    };
  }
}
