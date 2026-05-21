/**
 * CAIP-2 Solana chain identifiers + AL4 isMainnet derivation.
 * Phase 9 Batch J (ISC-77..80, 147).
 *
 * Per the CAIP-2 spec (https://chainagnostic.org/CAIPs/caip-2), Solana
 * networks are identified by a `solana:<genesis-hash-prefix>` string. The
 * canonical IDs are registered at
 * https://github.com/ChainAgnostic/namespaces/blob/main/solana/caip2.md.
 *
 * Sigil SDK V2 ships AL4 as a CAIP-2 chain id PLUS a derived `isMainnet`
 * boolean. Per Council ISC-147, exposing the full CAIP-2 string (not just
 * the boolean) preserves the future ability to bind testnet / localnet
 * intents without changing the SealResult shape — collapsing 4 networks
 * into 2 was flagged as a "footgun in waiting".
 */

/** CAIP-2 namespace for Solana. */
export const CAIP2_NAMESPACE_SOLANA = "solana" as const;

/** Mainnet-beta CAIP-2 chain id. */
export const CAIP2_SOLANA_MAINNET =
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;

/** Devnet CAIP-2 chain id. */
export const CAIP2_SOLANA_DEVNET =
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;

/** Testnet CAIP-2 chain id (declared for completeness; not currently produced by `toCaip2`). */
export const CAIP2_SOLANA_TESTNET =
  "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z" as const;

/**
 * The set of CAIP-2 strings the SDK currently emits. The narrower string
 * literal type prevents callers from constructing ad-hoc strings.
 */
export type SigilCaip2Chain =
  | typeof CAIP2_SOLANA_MAINNET
  | typeof CAIP2_SOLANA_DEVNET;

/**
 * Convert the SDK's internal `"devnet" | "mainnet"` network discriminant
 * to its canonical CAIP-2 chain id.
 *
 * @throws if `network` is not one of the two supported values. (Type
 * narrowing prevents this at compile time; the runtime check catches
 * misuse from JS callers or `any`-cast bypasses.)
 */
export function toCaip2(
  network: "devnet" | "mainnet",
): SigilCaip2Chain {
  if (network === "mainnet") return CAIP2_SOLANA_MAINNET;
  if (network === "devnet") return CAIP2_SOLANA_DEVNET;
  throw new Error(
    `toCaip2: network must be 'devnet' or 'mainnet', got ${String(network)}`,
  );
}

/**
 * Derive the AL4 `isMainnet` boolean from a CAIP-2 chain id.
 *
 * `isMainnet === true` ONLY when the chain id matches the canonical
 * mainnet-beta value. Devnet, testnet, localnet — anything else — all
 * return false. This is intentional: `isMainnet` is a SECURITY signal
 * (gate destructive defaults behind it); fuzzy matching would be a
 * footgun.
 */
export function isMainnetCaip2(chain: string): boolean {
  return chain === CAIP2_SOLANA_MAINNET;
}

/**
 * Convenience: combine `toCaip2` + `isMainnetCaip2` from a `"devnet" | "mainnet"`
 * input. Used by `seal()` to populate `SealResult.network` and
 * `SealResult.isMainnet` in a single call.
 */
export function deriveNetworkIdentity(
  network: "devnet" | "mainnet",
): { network: SigilCaip2Chain; isMainnet: boolean } {
  const chain = toCaip2(network);
  return { network: chain, isMainnet: isMainnetCaip2(chain) };
}
