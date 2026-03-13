/**
 * Protocol Handler Registry — Kit-native
 *
 * Simple Map-backed registry for protocol handlers. Protocols register
 * when their module is explicitly imported (lazy — keeps optional deps
 * from being loaded until needed).
 *
 * Lookup by protocol ID ("drift") or by on-chain program ID (Address).
 * Address is a branded string in Kit — no .toBase58() needed.
 *
 * Includes freeze() method (H-5 audit fix) to prevent mutation after init.
 */

import type { Address } from "@solana/kit";
import type {
  ProtocolHandler,
  ProtocolHandlerMetadata,
} from "./protocol-handler.js";

export class ProtocolRegistry {
  /** Protocol ID → handler */
  private readonly handlers = new Map<string, ProtocolHandler>();
  /** Program ID (Address string) → protocol ID — reverse index */
  private readonly programIndex = new Map<string, string>();
  /** Once frozen, no mutations allowed (H-5 audit fix) */
  private frozen = false;

  /**
   * Register a protocol handler.
   * @throws if a handler with the same protocolId is already registered
   * @throws if the registry has been frozen
   */
  register(handler: ProtocolHandler): void {
    if (this.frozen) {
      throw new Error("Registry is frozen — no further registration allowed");
    }
    const id = handler.metadata.protocolId;
    if (this.handlers.has(id)) {
      throw new Error(`Protocol handler already registered: ${id}`);
    }
    this.handlers.set(id, handler);

    // Index all program IDs for reverse lookup — Address IS a string
    for (const programId of handler.metadata.programIds) {
      this.programIndex.set(programId, id);
    }
  }

  /**
   * Deregister a protocol handler by ID.
   * @returns true if the handler was found and removed
   * @throws if the registry has been frozen
   */
  deregister(protocolId: string): boolean {
    if (this.frozen) {
      throw new Error("Registry is frozen — no further deregistration allowed");
    }
    const handler = this.handlers.get(protocolId);
    if (!handler) return false;

    // Remove program ID index entries — Address is just a string
    for (const programId of handler.metadata.programIds) {
      this.programIndex.delete(programId);
    }

    this.handlers.delete(protocolId);
    return true;
  }

  /**
   * Freeze the registry, preventing any further register/deregister calls.
   * This is a one-way operation — once frozen, cannot be unfrozen.
   */
  freeze(): void {
    this.frozen = true;
  }

  /** Look up a handler by protocol ID (e.g. "drift"). */
  getByProtocolId(protocolId: string): ProtocolHandler | undefined {
    return this.handlers.get(protocolId);
  }

  /** Look up a handler by one of its on-chain program IDs. */
  getByProgramId(programId: Address): ProtocolHandler | undefined {
    // Address IS a string — direct Map lookup, no .toBase58()
    const protocolId = this.programIndex.get(programId);
    if (!protocolId) return undefined;
    return this.handlers.get(protocolId);
  }

  /** List metadata for all registered handlers. */
  listAll(): ProtocolHandlerMetadata[] {
    return Array.from(this.handlers.values()).map((h) => h.metadata);
  }

  /** Check if a protocol ID is registered. */
  has(protocolId: string): boolean {
    return this.handlers.has(protocolId);
  }

  /** Whether the registry has been frozen. */
  get isFrozen(): boolean {
    return this.frozen;
  }

  /** Number of registered handlers. */
  get size(): number {
    return this.handlers.size;
  }
}

/** Global singleton registry. Handlers register here on module import. */
export const globalProtocolRegistry = new ProtocolRegistry();
