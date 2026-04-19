/**
 * custodyAdapterToTransactionSigner — bridge helper for the SAK plugin.
 *
 * Previously lived in `@usesigil/kit`'s root barrel. Moved here so the
 * kit does not carry plugin-specific custody glue. Consumers of the SAK
 * plugin who need a Sigil vault client constructed from a
 * `CustodyAdapter` call this helper to produce the `TransactionSigner`
 * that `createSigilClient` / `Sigil.fromVault` expect.
 *
 * Contract: thin wrapper. Unchanged from the kit-originated version.
 */

import type { Address, TransactionSigner } from "@solana/kit";
import type { AttestationResult } from "@usesigil/kit";
import { SigilSdkDomainError } from "@usesigil/kit";
import { SIGIL_ERROR__SDK__SIGNATURE_INVALID } from "@usesigil/kit/errors";

/**
 * Standardized interface for custody providers. Implementors:
 *   - `@usesigil/custody/turnkey` — TEE + Ed25519
 *   - `@usesigil/custody/crossmint` — API-verified TEE
 *   - `@usesigil/custody/privy` — Embedded wallets
 *
 * Three-method contract:
 *   - `getPublicKey()` — Address of the custody-managed signing key
 *   - `sign()` — Raw Ed25519 signature over arbitrary bytes
 *   - `attestation()` (optional) — TEE attestation proof
 */
export interface CustodyAdapter {
  /** Get the public key (address) of the custody-managed signing key. */
  getPublicKey(): Address;

  /**
   * Sign arbitrary bytes. Returns a 64-byte Ed25519 signature. The
   * adapter handles key access (TEE, MPC, HSM, etc.) internally.
   */
  sign(bytes: Uint8Array): Promise<Uint8Array>;

  /**
   * Optional: retrieve TEE attestation proof for the custody key.
   * Returns null if the provider doesn't support attestation.
   */
  attestation?(): Promise<AttestationResult | null>;
}

/**
 * Bridge a `CustodyAdapter` to Kit's `TransactionSigner` interface.
 * Returns a `TransactionPartialSigner` — custody adapters do pure
 * signing (no transaction modification).
 */
export function custodyAdapterToTransactionSigner(
  adapter: CustodyAdapter,
): TransactionSigner {
  const address = adapter.getPublicKey();

  return {
    address,
    async signTransactions<T extends { messageBytes: Uint8Array }>(
      transactions: readonly T[],
    ): Promise<readonly Record<string, Uint8Array>[]> {
      const results: Record<string, Uint8Array>[] = [];

      for (const tx of transactions) {
        const sig = await adapter.sign(tx.messageBytes);
        if (!(sig instanceof Uint8Array)) {
          throw new SigilSdkDomainError(
            SIGIL_ERROR__SDK__SIGNATURE_INVALID,
            `Custody adapter signature must be Uint8Array, got ${typeof sig}`,
            { context: { reason: `wrong-type:${typeof sig}` } },
          );
        }
        if (sig.length !== 64) {
          throw new SigilSdkDomainError(
            SIGIL_ERROR__SDK__SIGNATURE_INVALID,
            `Custody adapter returned invalid signature: expected 64 bytes, got ${sig.length}`,
            { context: { reason: `wrong-length:${sig.length}` } },
          );
        }
        results.push({ [address]: sig });
      }

      return results;
    },
  } as TransactionSigner;
}
