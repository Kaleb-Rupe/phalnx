/**
 * Anchor CPI event log parser for Phalnx.
 *
 * Parses "Program data: " log lines from transaction logs to extract
 * Anchor events. Uses the IDL-provided event discriminators (first 8 bytes
 * of SHA256 of "event:<EventName>").
 */

// ─── Event Discriminators from IDL ───────────────────────────────────────────
// These are the first 8 bytes of SHA256("event:<EventName>"), provided by
// the Anchor IDL. We store them as hex strings for fast map lookup.

const EVENT_DISCRIMINATOR_MAP: Record<string, string> = {
  "555a3bda7e08b33f": "ActionAuthorized",
  "274a945ec6a67917": "AgentPausedEvent",
  "cb6ef99533f1f63f": "AgentPermissionsUpdated",
  "bf4ed936e864bd55": "AgentRegistered",
  "0cfbf9a67a53a274": "AgentRevoked",
  "6b803c90a3532dd7": "AgentSpendLimitChecked",
  "583475456098a728": "AgentTransferExecuted",
  "dabbfd7c4fc02ab5": "AgentUnpausedEvent",
  "70966f7df3852337": "ConstraintsChangeApplied",
  "0f4b68de68c14191": "ConstraintsChangeCancelled",
  "6fdd649534175884": "ConstraintsChangeQueued",
  "3b9e8e31a474dc08": "DelegationRevoked",
  "467f69665c6107ad": "EscrowCreated",
  "84d1316d878a1c51": "EscrowRefunded",
  "611b9637cbb3ad17": "EscrowSettled",
  "e91775e16bb2fe08": "FeesCollected",
  "9dd1645f3b640344": "FundsDeposited",
  "3882e69a235c0b76": "FundsWithdrawn",
  "6b6b5a08519e8256": "InstructionConstraintsClosed",
  "08aa63e81fd8391a": "InstructionConstraintsCreated",
  "9f3f94c296d12b81": "InstructionConstraintsUpdated",
  "685905640bca3449": "PolicyChangeApplied",
  "c89ee2ff19d31e97": "PolicyChangeCancelled",
  "49e7b6888d782050": "PolicyChangeQueued",
  "e1707043f5ecf5a1": "PolicyUpdated",
  "532190c9a80d005f": "PositionsSynced",
  "210cf25bce2aa3eb": "SessionFinalized",
  "ee8126e4e376f9d7": "VaultClosed",
  "751978fe4bec4e73": "VaultCreated",
  "0dc7ac6f580a97f7": "VaultFrozen",
  "c534a0939f595a1c": "VaultReactivated",
};

/** All known Phalnx event names */
export type PhalnxEventName = (typeof EVENT_DISCRIMINATOR_MAP)[string];

/** Parsed event from transaction logs */
export interface PhalnxEvent {
  /** Event name (e.g. "VaultCreated", "ActionAuthorized") */
  name: PhalnxEventName;
  /** Raw event data bytes (after discriminator) */
  data: Uint8Array;
}

/**
 * Parse Phalnx Anchor events from transaction logs.
 *
 * Anchor emits events as "Program data: <base64>" log lines.
 * The first 8 bytes are the event discriminator (SHA256 prefix).
 *
 * @param logs - Array of log strings from a transaction
 * @returns Array of parsed events with name and raw data
 */
export function parsePhalnxEvents(logs: string[]): PhalnxEvent[] {
  const events: PhalnxEvent[] = [];
  const PROGRAM_DATA_PREFIX = "Program data: ";

  for (const log of logs) {
    if (!log.includes(PROGRAM_DATA_PREFIX)) continue;

    const dataStart = log.indexOf(PROGRAM_DATA_PREFIX);
    if (dataStart === -1) continue;

    const base64Data = log.slice(dataStart + PROGRAM_DATA_PREFIX.length);

    try {
      const bytes = base64ToBytes(base64Data);
      if (bytes.length < 8) continue;

      // First 8 bytes = discriminator
      const discHex = bytesToHex(bytes.slice(0, 8));
      const eventName = EVENT_DISCRIMINATOR_MAP[discHex];

      if (eventName) {
        events.push({
          name: eventName,
          data: bytes.slice(8),
        });
      }
    } catch {
      // Skip unparseable log lines
    }
  }

  return events;
}

/**
 * Extract events of a specific type from transaction logs.
 */
export function filterEvents(
  logs: string[],
  eventName: PhalnxEventName,
): PhalnxEvent[] {
  return parsePhalnxEvents(logs).filter((e) => e.name === eventName);
}

/** Get all known event names */
export function getEventNames(): PhalnxEventName[] {
  return Object.values(EVENT_DISCRIMINATOR_MAP);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
