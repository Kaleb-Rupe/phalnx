/**
 * S21 — `buildUnsigned()` composer.
 *
 * Public composer that wraps {@link buildOwnerTransaction} to give SDK
 * consumers an offline-signing path. The only structural difference from
 * `buildOwnerTransaction` is that `feePayer` is a plain {@link Address}, not
 * a {@link TransactionSigner}; this composer wraps it in `createNoopSigner`
 * internally so the caller never needs to construct a signer object.
 *
 * # Three use cases
 *
 *  1. **Squads multisig.** The caller submits the returned `unsignedTxBytes`
 *     buffer to a Squads proposal; signers from the multisig sign
 *     asynchronously, then the assembled signed tx is broadcast.
 *
 *  2. **CLI tools.** The caller pipes the `unsignedTxBytes` buffer to
 *     `solana sign-tx` (or any cold-key signing tool) for offline signing.
 *
 *  3. **Cost preview.** The caller decodes `unsignedTxBytes` client-side via
 *     {@link getCompiledTransactionMessageDecoder} to estimate CU + fee
 *     before submission. Pass `simulate: true` to additionally fetch the
 *     RPC's `unitsConsumed` estimate via `simulateTransaction`.
 *
 * # Why a separate function instead of `buildOwnerTransaction`?
 *
 * `buildOwnerTransaction` requires a {@link TransactionSigner} for the
 * `owner` field. Callers without a wired-up signer (e.g. a CLI receiving
 * just a pubkey via flag, or a Squads-flow UI that never holds the key) had
 * to construct a `createNoopSigner(addr)` themselves AND know the function
 * returns a `wireBase64` string they then have to base64-decode. This
 * composer hands back a `Uint8Array` directly + a structured object with
 * the original {@link Instruction}[] for inspection, in one call.
 *
 * The unsigned bytes have the standard Solana wire layout:
 *   `[num_sigs:u8][signatures:64*num_sigs][messageBytes]`
 * where every signature slot is zero-filled (caller hasn't signed yet).
 */

import type {
  Address,
  Instruction,
  Rpc,
  SolanaRpcApi,
  AddressesByLookupTableAddress,
  ReadonlyUint8Array,
  Base64EncodedWireTransaction,
} from "./kit-adapter.js";
import {
  createNoopSigner,
  getCompiledTransactionMessageDecoder,
} from "./kit-adapter.js";
import { buildOwnerTransaction } from "./owner-transaction.js";
import type { Blockhash } from "./rpc-helpers.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BuildUnsignedInput {
  /** RPC client for blockhash + ALT resolution (and optional simulation). */
  rpc: Rpc<SolanaRpcApi>;
  /**
   * Fee payer address. Plain {@link Address} — NOT a {@link TransactionSigner}.
   * This is the contract delta vs `buildOwnerTransaction`. The address is
   * wrapped in `createNoopSigner` internally so the message-header byte
   * (`numRequiredSignatures`) and `staticAccounts[0]` slot are populated
   * correctly without the caller needing to build a signer.
   */
  feePayer: Address;
  /** One or more instructions to include in the transaction. */
  instructions: Instruction[];
  /**
   * Network used for Sigil ALT resolution. Defaults to `"devnet"` to keep
   * the minimum-input call site terse; pass `"mainnet"` for production.
   * Ignored entirely when `addressLookupTables` is pre-supplied.
   */
  network?: "devnet" | "mainnet";
  /** Override compute units. Default: `CU_OWNER_ACTION` (200,000). */
  computeUnitLimit?: number;
  /** Priority fee in microLamports per CU. Default: 0 (no priority fee). */
  computeUnitPrice?: number;
  /**
   * Pre-resolved ALTs. If omitted, resolves the Sigil ALT for the chosen
   * `network` automatically. Pass `{}` to skip ALT compression.
   */
  addressLookupTables?: AddressesByLookupTableAddress;
  /** Pre-fetched blockhash. If omitted, fetches via `rpc`. */
  blockhash?: Blockhash;
  /**
   * If `true`, runs `simulateTransaction` on the unsigned bytes to fetch a
   * server-side `unitsConsumed` estimate, returned as
   * {@link BuildUnsignedResult.estimatedComputeUnits}. Defaults to `false`.
   * Simulation is best-effort — failures and missing `unitsConsumed` are
   * swallowed so the unsigned bytes still flow through to the caller.
   */
  simulate?: boolean;
}

export interface BuildUnsignedResult {
  /**
   * Wire-encoded versioned transaction with empty signature placeholders.
   * Length-prefixed signature count followed by 64-byte zero slots, then
   * the compiled message bytes. Pass to a wallet adapter, Squads proposal,
   * or `solana sign-tx` for offline signing.
   */
  unsignedTxBytes: Uint8Array;
  /**
   * The original {@link Instruction}[] in the order they were embedded in
   * the transaction (after compute-budget prefix instructions). Returned
   * by-reference for cheap inspection — do NOT mutate.
   */
  instructions: Instruction[];
  /**
   * RPC's `unitsConsumed` from `simulateTransaction` when
   * {@link BuildUnsignedInput.simulate} is `true` AND simulation succeeded
   * AND the response included `unitsConsumed`. Otherwise `undefined`.
   */
  estimatedComputeUnits?: number;
  /** Echoes back the input `feePayer` for ergonomic destructuring. */
  feePayer: Address;
  /** The blockhash baked into the unsigned bytes. */
  recentBlockhash: string;
  /**
   * `lastValidBlockHeight` from the same blockhash baked into
   * `unsignedTxBytes`. Sourced from `buildOwnerTransaction`'s return — no
   * second cache read (which would race against TTL refresh).
   */
  lastValidBlockHeight: bigint;
  /**
   * Decoded compiled transaction message. The shape comes from
   * `@solana/transaction-messages` `getCompiledTransactionMessageDecoder`.
   * Useful for cost-preview UIs that want to enumerate `staticAccounts`,
   * `addressTableLookups`, or `instructions[].programAddressIndex` without
   * a second decode pass. Cast to a more-specific type at the call site if
   * narrower typing is needed.
   */
  message: ReturnType<
    ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]
  >;
}

// ─── buildUnsigned ──────────────────────────────────────────────────────────

/**
 * Build an unsigned versioned transaction for offline signing.
 *
 * @see {@link BuildUnsignedInput} for input fields.
 * @see {@link BuildUnsignedResult} for the returned shape and the three use
 *      cases this composer was added for (Squads, CLI, cost preview).
 *
 * @example Squads multisig
 * ```ts
 * const { unsignedTxBytes } = await buildUnsigned({
 *   rpc, feePayer: squad.address, instructions: [transferIx],
 * });
 * await squads.createProposal({ transaction: unsignedTxBytes });
 * ```
 *
 * @example CLI cold-key signing
 * ```ts
 * const { unsignedTxBytes } = await buildUnsigned({ rpc, feePayer, instructions });
 * await fs.writeFile("tx.bin", unsignedTxBytes);
 * // then: solana sign-tx tx.bin
 * ```
 *
 * @example Cost preview with on-chain simulation
 * ```ts
 * const { estimatedComputeUnits, message } = await buildUnsigned({
 *   rpc, feePayer, instructions, simulate: true,
 * });
 * console.log(`Estimated CU: ${estimatedComputeUnits}`);
 * console.log(`Static accounts: ${message.staticAccounts.length}`);
 * ```
 */
export async function buildUnsigned(
  input: BuildUnsignedInput,
): Promise<BuildUnsignedResult> {
  const ownerSigner = createNoopSigner(input.feePayer);

  const ownerTx = await buildOwnerTransaction({
    rpc: input.rpc,
    owner: ownerSigner,
    instructions: input.instructions,
    network: input.network ?? "devnet",
    ...(input.computeUnitLimit !== undefined
      ? { computeUnits: input.computeUnitLimit }
      : {}),
    ...(input.computeUnitPrice !== undefined
      ? { priorityFeeMicroLamports: input.computeUnitPrice }
      : {}),
    ...(input.addressLookupTables !== undefined
      ? { addressLookupTables: input.addressLookupTables }
      : {}),
    ...(input.blockhash !== undefined ? { blockhash: input.blockhash } : {}),
  });

  const unsignedTxBytes = base64ToUint8Array(ownerTx.wireBase64);

  // Decode the compiled message portion for inspection.
  // Wire layout: [num_sigs:u8][signatures:64*num_sigs][messageBytes].
  // Versioned-tx with this composer always has exactly 1 required signer
  // (the fee payer), so the message starts at offset 65 — but read
  // num_sigs defensively in case future changes add co-signers.
  const numSigs = unsignedTxBytes[0] ?? 0;
  const messageBytes = unsignedTxBytes.slice(1 + 64 * numSigs);
  const message = getCompiledTransactionMessageDecoder().decode(
    messageBytes as ReadonlyUint8Array,
  );

  let estimatedComputeUnits: number | undefined;
  if (input.simulate) {
    estimatedComputeUnits = await safeSimulateUnitsConsumed(
      input.rpc,
      ownerTx.wireBase64 as Base64EncodedWireTransaction,
    );
  }

  return {
    unsignedTxBytes,
    instructions: input.instructions,
    ...(estimatedComputeUnits !== undefined ? { estimatedComputeUnits } : {}),
    feePayer: input.feePayer,
    recentBlockhash: ownerTx.blockhash.blockhash,
    lastValidBlockHeight: ownerTx.blockhash.lastValidBlockHeight,
    message,
  };
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Decode base64 → Uint8Array via `atob` (built-in Node ≥ 16 + browser).
 * Same pattern as `preview-create-vault.ts` — kept private here to avoid
 * a cross-file dependency on a private helper.
 */
function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Run `simulateTransaction` and return `unitsConsumed` as a number.
 * Best-effort — any failure (RPC error, missing `unitsConsumed`, sim error)
 * returns `undefined` so the caller still gets the unsigned bytes. The
 * simulate flag is for cost preview, not for blocking the build.
 */
async function safeSimulateUnitsConsumed(
  rpc: Rpc<SolanaRpcApi>,
  wireBase64: Base64EncodedWireTransaction,
): Promise<number | undefined> {
  try {
    const result = await rpc
      .simulateTransaction(wireBase64, {
        encoding: "base64",
        replaceRecentBlockhash: true,
        sigVerify: false,
        commitment: "confirmed",
      } as Parameters<typeof rpc.simulateTransaction>[1])
      .send();
    const value = result.value as {
      err: unknown;
      unitsConsumed: bigint | null;
    } | null;
    if (!value || value.err || value.unitsConsumed == null) return undefined;
    return Number(value.unitsConsumed);
  } catch {
    return undefined;
  }
}
