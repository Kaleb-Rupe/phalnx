/**
 * Drift Protocol compose functions — Kit-native via compat bridge.
 *
 * Uses dynamic import for @drift-labs/sdk (optional dependency).
 * Each function: takes Kit-native types → converts via compat bridge →
 * calls Drift SDK → converts result back via toKitInstruction().
 *
 * Reference: sdk/typescript/src/integrations/drift.ts (715 lines)
 */

import type { Instruction } from "@solana/kit";
import type {
  ProtocolContext,
  ProtocolComposeResult,
} from "./protocol-handler.js";
import { createRequireField } from "./compose-errors.js";
import { toKitInstruction } from "../compat.js";

// ─── Precision Constants ────────────────────────────────────────────────────

/** USDC/quote precision: 10^6 */
export const DRIFT_QUOTE_PRECISION = 1_000_000;
/** Perp base asset precision: 10^9 */
export const DRIFT_BASE_PRECISION = 1_000_000_000;
/** Price precision: 10^6 */
export const DRIFT_PRICE_PRECISION = 1_000_000;

// ─── Typed Param Interfaces ─────────────────────────────────────────────────

interface DriftAmountParams {
  amount: string;
  marketIndex: number;
  subAccountId?: number;
}

interface DriftOrderParams {
  marketIndex: number;
  side: "long" | "short";
  amount: string;
  price?: string;
  orderType: string;
}

interface DriftCancelParams {
  orderId: number;
}

// ─── Lazy SDK Import ────────────────────────────────────────────────────────

let _driftSdk: any = null;

async function getDriftSdk(): Promise<any> {
  if (!_driftSdk) {
    try {
      // Dynamic import — @drift-labs/sdk is optional, may not be installed
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — optional dependency, resolved at runtime
      _driftSdk = await import("@drift-labs/sdk");
    } catch {
      throw new Error(
        "@drift-labs/sdk is not installed. Run: npm install @drift-labs/sdk",
      );
    }
  }
  return _driftSdk;
}

// ─── DriftClient Cache ──────────────────────────────────────────────────────

/** Per-context cache keyed on `agent:network` to avoid cross-agent contamination. */
const _clientCache = new Map<string, any>();
const MAX_CACHED_CLIENTS = 50;

/** Clear all cached DriftClients. Call on shutdown or between test runs. */
export function clearDriftClientCache(): void {
  _clientCache.clear();
}

async function getOrCreateDriftClient(ctx: ProtocolContext): Promise<any> {
  const cacheKey = `${ctx.agent}:${ctx.network}`;
  const cached = _clientCache.get(cacheKey);
  if (cached) return cached;

  // Evict oldest entry if at capacity
  if (_clientCache.size >= MAX_CACHED_CLIENTS) {
    const oldest = _clientCache.keys().next().value;
    if (oldest !== undefined) _clientCache.delete(oldest);
  }

  const sdk = await getDriftSdk();

  // We need a web3.js Connection for the Drift SDK. Import dynamically.
  let Connection: any;
  try {
    // @ts-ignore — optional dependency, resolved at runtime
    const web3 = await import("@solana/web3.js");
    Connection = web3.Connection;
  } catch {
    throw new Error(
      "@solana/web3.js is required for Drift integration. It should be installed as an optional dependency.",
    );
  }

  const endpoint =
    ctx.network === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com";

  const connection = new Connection(endpoint);
  const env = ctx.network === "devnet" ? "devnet" : "mainnet-beta";
  sdk.initialize({ env });

  // Minimal wallet adapter for Drift SDK
  const wallet = {
    publicKey: { toBase58: () => ctx.agent },
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any[]) => txs,
  };

  const client = new sdk.DriftClient({
    connection,
    wallet,
    env,
    accountSubscription: {
      type: "polling",
      accountLoader: new sdk.BulkAccountLoader(connection, "confirmed", 5000),
    },
  });

  await client.subscribe();
  _clientCache.set(cacheKey, client);
  return client;
}

// ─── Helper: Build Drift Types ──────────────────────────────────────────────

function buildDriftOrderType(sdk: any, type: string): any {
  switch (type) {
    case "market":
      return sdk.OrderType.MARKET;
    case "limit":
      return sdk.OrderType.LIMIT;
    case "triggerMarket":
      return sdk.OrderType.TRIGGER_MARKET;
    case "triggerLimit":
      return sdk.OrderType.TRIGGER_LIMIT;
    default:
      throw new Error(`Unknown Drift order type: ${type}`);
  }
}

function buildDriftDirection(sdk: any, side: "long" | "short"): any {
  return side === "long"
    ? sdk.PositionDirection.LONG
    : sdk.PositionDirection.SHORT;
}

// ─── Param Validation ───────────────────────────────────────────────────────

const requireField = createRequireField(
  (field) => new Error(`Missing required Drift parameter: ${field}`),
);

function parseAmountParams(params: Record<string, unknown>): DriftAmountParams {
  return {
    amount: requireField<string>(params, "amount"),
    marketIndex: requireField<number>(params, "marketIndex"),
    subAccountId: params.subAccountId as number | undefined,
  };
}

function parseOrderParams(params: Record<string, unknown>): DriftOrderParams {
  return {
    marketIndex: requireField<number>(params, "marketIndex"),
    side: requireField<"long" | "short">(params, "side"),
    amount: requireField<string>(params, "amount"),
    price: params.price as string | undefined,
    orderType: requireField<string>(params, "orderType"),
  };
}

function parseCancelParams(params: Record<string, unknown>): DriftCancelParams {
  return {
    orderId: requireField<number>(params, "orderId"),
  };
}

// ─── Compose Functions ──────────────────────────────────────────────────────

async function composeDriftDeposit(
  sdk: any,
  client: any,
  p: DriftAmountParams,
): Promise<ProtocolComposeResult> {
  const ix = await client.getDepositIx(
    new sdk.BN(p.amount),
    p.marketIndex,
    undefined, // userTokenAccount — SDK resolves
    p.subAccountId ?? 0,
  );

  return { instructions: [toKitInstruction(ix)] };
}

async function composeDriftWithdraw(
  sdk: any,
  client: any,
  p: DriftAmountParams,
): Promise<ProtocolComposeResult> {
  const ix = await client.getWithdrawIx(
    new sdk.BN(p.amount),
    p.marketIndex,
    undefined,
    false, // reduceOnly
    p.subAccountId ?? 0,
  );

  return { instructions: [toKitInstruction(ix)] };
}

async function composeDriftPlacePerpOrder(
  sdk: any,
  client: any,
  p: DriftOrderParams,
): Promise<ProtocolComposeResult> {
  const orderParams = {
    orderType: buildDriftOrderType(sdk, p.orderType),
    marketIndex: p.marketIndex,
    direction: buildDriftDirection(sdk, p.side),
    baseAssetAmount: new sdk.BN(p.amount),
    price: p.price ? new sdk.BN(p.price) : undefined,
    marketType: sdk.MarketType.PERP,
  };

  const ix = await client.getPlacePerpOrderIx(orderParams);
  return { instructions: [toKitInstruction(ix)] };
}

async function composeDriftPlaceSpotOrder(
  sdk: any,
  client: any,
  p: DriftOrderParams,
): Promise<ProtocolComposeResult> {
  const orderParams = {
    orderType: buildDriftOrderType(sdk, p.orderType),
    marketIndex: p.marketIndex,
    direction: buildDriftDirection(sdk, p.side),
    baseAssetAmount: new sdk.BN(p.amount),
    price: p.price ? new sdk.BN(p.price) : undefined,
    marketType: sdk.MarketType.SPOT,
  };

  const ix = await client.getPlaceSpotOrderIx(orderParams);
  return { instructions: [toKitInstruction(ix)] };
}

async function composeDriftCancelOrder(
  sdk: any,
  client: any,
  p: DriftCancelParams,
): Promise<ProtocolComposeResult> {
  const ix = await client.getCancelOrderIx(p.orderId);
  return { instructions: [toKitInstruction(ix)] };
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

const SUPPORTED_ACTIONS = [
  "deposit",
  "withdraw",
  "placePerpOrder",
  "placeSpotOrder",
  "cancelOrder",
];

/**
 * Dispatch a Drift action to the correct compose function.
 * Called by DriftHandler.compose().
 */
export async function dispatchDriftCompose(
  ctx: ProtocolContext,
  action: string,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  // Validate action before loading SDK (sync check first)
  if (!SUPPORTED_ACTIONS.includes(action)) {
    throw new Error(
      `Unsupported Drift action: ${action}. Supported: ${SUPPORTED_ACTIONS.join(", ")}`,
    );
  }

  // Resolve SDK + client once (throws if @drift-labs/sdk not installed)
  const sdk = await getDriftSdk();
  const client = await getOrCreateDriftClient(ctx);

  switch (action) {
    case "deposit":
      return composeDriftDeposit(sdk, client, parseAmountParams(params));
    case "withdraw":
      return composeDriftWithdraw(sdk, client, parseAmountParams(params));
    case "placePerpOrder":
      return composeDriftPlacePerpOrder(sdk, client, parseOrderParams(params));
    case "placeSpotOrder":
      return composeDriftPlaceSpotOrder(sdk, client, parseOrderParams(params));
    case "cancelOrder":
      return composeDriftCancelOrder(sdk, client, parseCancelParams(params));
    default:
      // Unreachable — covered by guard above
      throw new Error(`Unsupported Drift action: ${action}`);
  }
}
