/**
 * Shared formatting utilities for V2 MCP tools.
 */

import type { AgentError, RecoveryAction } from "@phalnx/sdk";

/**
 * Format an AgentError for MCP tool response.
 * Shows error details with numbered recovery steps.
 */
export function formatAgentError(err: AgentError): string {
  const lines: string[] = [];
  lines.push(`## Error: ${err.message}`);
  lines.push("");
  lines.push(`**Code:** ${err.code}`);
  lines.push(`**Category:** ${err.category}`);
  lines.push(`**Retryable:** ${err.retryable ? "yes" : "no"}`);

  if (err.retryable && err.retry_after_ms) {
    lines.push(`**Retry after:** ${err.retry_after_ms}ms`);
  }

  if (err.recovery_actions.length > 0) {
    lines.push("");
    lines.push("### Recovery Steps:");
    err.recovery_actions.forEach((action: RecoveryAction, i: number) => {
      lines.push(`${i + 1}. **${action.action}**: ${action.description}`);
      if (action.tool) {
        lines.push(`   Tool: \`${action.tool}\``);
      }
    });
  }

  if (Object.keys(err.context).length > 0) {
    lines.push("");
    lines.push("### Context:");
    for (const [key, value] of Object.entries(err.context)) {
      if (key === "IMPORTANT") {
        lines.push(`\n**${key}:** ${value}\n`);
      } else {
        lines.push(`- ${key}: ${JSON.stringify(value)}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Format a Tier 5 escalation error for MCP tool response.
 * Produces agent-readable text with TELL THE USER formatting.
 */
export function formatEscalation(err: AgentError): string {
  const lines: string[] = [];
  lines.push("## Cannot Execute: Protocol Escalation Required");
  lines.push("");
  lines.push(err.message);
  lines.push("");

  if (err.recovery_actions.length > 0) {
    lines.push("### Required Actions (for the vault owner):");
    for (const action of err.recovery_actions) {
      lines.push(`- **${action.action.toUpperCase()}**: ${action.description}`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push(
    "**Do NOT silently switch to an alternative protocol. The user explicitly requested this protocol.**",
  );

  return lines.join("\n");
}

/**
 * Format an ExecuteResult for MCP tool response.
 */
export function formatExecuteResult(result: {
  signature: string;
  summary: string;
  precheck?: { riskFlags?: string[] };
}): string {
  const lines: string[] = [];
  lines.push("## Transaction Executed Successfully");
  lines.push("");
  lines.push(`**Signature:** \`${result.signature}\``);
  lines.push(`**Summary:** ${result.summary}`);

  if (result.precheck?.riskFlags && result.precheck.riskFlags.length > 0) {
    lines.push("");
    lines.push("### Risk Flags:");
    for (const flag of result.precheck.riskFlags) {
      lines.push(`- ${flag}`);
    }
  }

  return lines.join("\n");
}
