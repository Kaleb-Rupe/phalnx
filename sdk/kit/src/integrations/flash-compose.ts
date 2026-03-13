/**
 * Flash Trade compose functions — Kit-native via Codama pre-generated builders.
 *
 * Zero runtime dependency on flash-sdk or web3.js.
 * Each function: resolves accounts from static config → calls Codama-generated
 * instruction builder → returns Kit-native instructions.
 *
 * 14 actions: openPosition, closePosition, increasePosition, decreasePosition,
 * addCollateral, removeCollateral, placeTriggerOrder, editTriggerOrder,
 * cancelTriggerOrder, placeLimitOrder, editLimitOrder, cancelLimitOrder,
 * swapAndOpen, closeAndSwap.
 */

import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import { generateKeyPairSigner } from "@solana/kit";
import type { ProtocolContext, ProtocolComposeResult } from "./protocol-handler.js";
import { FlashTradeComposeError } from "./compose-errors.js";
import {
  resolveFlashAccounts,
  FLASH_PERPETUALS,
  FLASH_POOL,
  FLASH_TRANSFER_AUTHORITY,
  FLASH_EVENT_AUTHORITY,
  FLASH_CUSTODY_MAP,
  IX_SYSVAR,
  TOKEN_PROGRAM,
  SYSTEM_PROGRAM,
  PERPETUALS_PROGRAM,
  type FlashCustodyConfig,
} from "./config/flash-trade-markets.js";
import { Privilege } from "../generated/protocols/flash-trade/types/privilege.js";
import type { OraclePriceArgs } from "../generated/protocols/flash-trade/types/oraclePrice.js";

// ─── Generated Instruction Builders ──────────────────────────────────────────
import { getOpenPositionInstruction } from "../generated/protocols/flash-trade/instructions/openPosition.js";
import { getClosePositionInstruction } from "../generated/protocols/flash-trade/instructions/closePosition.js";
import { getIncreaseSizeInstruction } from "../generated/protocols/flash-trade/instructions/increaseSize.js";
import { getDecreaseSizeInstruction } from "../generated/protocols/flash-trade/instructions/decreaseSize.js";
import { getAddCollateralInstruction } from "../generated/protocols/flash-trade/instructions/addCollateral.js";
import { getRemoveCollateralInstruction } from "../generated/protocols/flash-trade/instructions/removeCollateral.js";
import { getPlaceTriggerOrderInstruction } from "../generated/protocols/flash-trade/instructions/placeTriggerOrder.js";
import { getEditTriggerOrderInstruction } from "../generated/protocols/flash-trade/instructions/editTriggerOrder.js";
import { getCancelTriggerOrderInstruction } from "../generated/protocols/flash-trade/instructions/cancelTriggerOrder.js";
import { getPlaceLimitOrderInstruction } from "../generated/protocols/flash-trade/instructions/placeLimitOrder.js";
import { getEditLimitOrderInstruction } from "../generated/protocols/flash-trade/instructions/editLimitOrder.js";
import { getSwapAndOpenInstruction } from "../generated/protocols/flash-trade/instructions/swapAndOpen.js";
import { getCloseAndSwapInstruction } from "../generated/protocols/flash-trade/instructions/closeAndSwap.js";

// ─── Param Validation ────────────────────────────────────────────────────────

function requireField<T>(params: Record<string, unknown>, field: string): T {
  const val = params[field];
  if (val === undefined || val === null) {
    throw new FlashTradeComposeError("MISSING_PARAM", `Missing required parameter: ${field}`);
  }
  return val as T;
}

function parseOraclePrice(price: { price: string; exponent: number }): OraclePriceArgs {
  return { price: BigInt(price.price), exponent: price.exponent };
}

function parseSide(side: string): "long" | "short" {
  if (side !== "long" && side !== "short") {
    throw new FlashTradeComposeError("INVALID_SIDE", `Invalid side: ${side}. Must be "long" or "short".`);
  }
  return side;
}

// ─── Signer Helpers ──────────────────────────────────────────────────────────

/**
 * Create a fake TransactionSigner from an Address for compose-time account resolution.
 * The actual signing happens at transaction execution time.
 */
function addressAsSigner(address: Address): TransactionSigner {
  return {
    address,
    signTransactions: async () => { throw new Error("addressAsSigner is for compose-time only"); },
  } as unknown as TransactionSigner;
}

// ─── Compose: Core Perps (6 actions) ─────────────────────────────────────────

async function composeOpenPosition(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const targetSymbol = requireField<string>(params, "targetSymbol");
  const collateralSymbol = requireField<string>(params, "collateralSymbol");
  const side = parseSide(requireField<string>(params, "side"));
  const priceWithSlippage = requireField<{ price: string; exponent: number }>(params, "priceWithSlippage");
  const collateralAmount = requireField<string>(params, "collateralAmount");
  const sizeAmount = requireField<string>(params, "sizeAmount");

  const accts = resolveFlashAccounts(targetSymbol, collateralSymbol, side);
  const positionKp = await generateKeyPairSigner();

  const ix = getOpenPositionInstruction({
    owner: addressAsSigner(ctx.vault),
    feePayer: addressAsSigner(ctx.agent),
    fundingAccount: ctx.vault, // Vault's token account (resolved by caller)
    transferAuthority: accts.transferAuthority,
    perpetuals: accts.perpetuals,
    pool: accts.pool,
    position: positionKp.address,
    market: accts.market.market,
    targetCustody: accts.targetCustody.custody,
    targetOracleAccount: accts.targetCustody.oracle,
    collateralCustody: accts.collateralCustody.custody,
    collateralOracleAccount: accts.collateralCustody.oracle,
    collateralCustodyTokenAccount: accts.collateralCustody.tokenAccount,
    systemProgram: SYSTEM_PROGRAM,
    fundingTokenProgram: TOKEN_PROGRAM,
    eventAuthority: accts.eventAuthority,
    program: PERPETUALS_PROGRAM,
    ixSysvar: accts.ixSysvar,
    fundingMint: accts.collateralCustody.mint,
    priceWithSlippage: parseOraclePrice(priceWithSlippage),
    collateralAmount: BigInt(collateralAmount),
    sizeAmount: BigInt(sizeAmount),
    privilege: Privilege.None,
  });

  return { instructions: [ix as Instruction], additionalSigners: [positionKp] };
}

async function composeClosePosition(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const targetSymbol = requireField<string>(params, "targetSymbol");
  const collateralSymbol = requireField<string>(params, "collateralSymbol");
  const side = parseSide(requireField<string>(params, "side"));
  const priceWithSlippage = requireField<{ price: string; exponent: number }>(params, "priceWithSlippage");

  const accts = resolveFlashAccounts(targetSymbol, collateralSymbol, side);

  const ix = getClosePositionInstruction({
    owner: addressAsSigner(ctx.vault),
    feePayer: addressAsSigner(ctx.agent),
    receivingAccount: ctx.vault,
    transferAuthority: accts.transferAuthority,
    perpetuals: accts.perpetuals,
    pool: accts.pool,
    position: requireField<string>(params, "positionPubKey") as Address,
    market: accts.market.market,
    targetCustody: accts.targetCustody.custody,
    targetOracleAccount: accts.targetCustody.oracle,
    collateralCustody: accts.collateralCustody.custody,
    collateralOracleAccount: accts.collateralCustody.oracle,
    collateralCustodyTokenAccount: accts.collateralCustody.tokenAccount,
    collateralTokenProgram: TOKEN_PROGRAM,
    eventAuthority: accts.eventAuthority,
    program: PERPETUALS_PROGRAM,
    ixSysvar: accts.ixSysvar,
    collateralMint: accts.collateralCustody.mint,
    priceWithSlippage: parseOraclePrice(priceWithSlippage),
    privilege: Privilege.None,
  });

  return { instructions: [ix as Instruction] };
}

async function composeIncreasePosition(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const targetSymbol = requireField<string>(params, "targetSymbol");
  const collateralSymbol = requireField<string>(params, "collateralSymbol");
  const side = parseSide(requireField<string>(params, "side"));
  const priceWithSlippage = requireField<{ price: string; exponent: number }>(params, "priceWithSlippage");
  const sizeDelta = requireField<string>(params, "sizeDelta");

  const accts = resolveFlashAccounts(targetSymbol, collateralSymbol, side);

  const ix = getIncreaseSizeInstruction({
    owner: addressAsSigner(ctx.vault),
    transferAuthority: accts.transferAuthority,
    perpetuals: accts.perpetuals,
    pool: accts.pool,
    position: requireField<string>(params, "positionPubKey") as Address,
    market: accts.market.market,
    targetCustody: accts.targetCustody.custody,
    targetOracleAccount: accts.targetCustody.oracle,
    collateralCustody: accts.collateralCustody.custody,
    collateralOracleAccount: accts.collateralCustody.oracle,
    collateralCustodyTokenAccount: accts.collateralCustody.tokenAccount,
    collateralTokenProgram: TOKEN_PROGRAM,
    eventAuthority: accts.eventAuthority,
    program: PERPETUALS_PROGRAM,
    ixSysvar: accts.ixSysvar,
    collateralMint: accts.collateralCustody.mint,
    priceWithSlippage: parseOraclePrice(priceWithSlippage),
    sizeDelta: BigInt(sizeDelta),
    privilege: Privilege.None,
  });

  return { instructions: [ix as Instruction] };
}

async function composeDecreasePosition(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const targetSymbol = requireField<string>(params, "targetSymbol");
  const collateralSymbol = requireField<string>(params, "collateralSymbol");
  const side = parseSide(requireField<string>(params, "side"));
  const priceWithSlippage = requireField<{ price: string; exponent: number }>(params, "priceWithSlippage");
  const sizeDelta = requireField<string>(params, "sizeDelta");

  const accts = resolveFlashAccounts(targetSymbol, collateralSymbol, side);

  const ix = getDecreaseSizeInstruction({
    owner: addressAsSigner(ctx.vault),
    transferAuthority: accts.transferAuthority,
    perpetuals: accts.perpetuals,
    pool: accts.pool,
    position: requireField<string>(params, "positionPubKey") as Address,
    market: accts.market.market,
    targetCustody: accts.targetCustody.custody,
    targetOracleAccount: accts.targetCustody.oracle,
    collateralCustody: accts.collateralCustody.custody,
    collateralOracleAccount: accts.collateralCustody.oracle,
    collateralCustodyTokenAccount: accts.collateralCustody.tokenAccount,
    collateralTokenProgram: TOKEN_PROGRAM,
    eventAuthority: accts.eventAuthority,
    program: PERPETUALS_PROGRAM,
    ixSysvar: accts.ixSysvar,
    collateralMint: accts.collateralCustody.mint,
    priceWithSlippage: parseOraclePrice(priceWithSlippage),
    sizeDelta: BigInt(sizeDelta),
    privilege: Privilege.None,
  });

  return { instructions: [ix as Instruction] };
}

async function composeAddCollateral(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const targetSymbol = requireField<string>(params, "targetSymbol");
  const collateralSymbol = requireField<string>(params, "collateralSymbol");
  const side = parseSide(requireField<string>(params, "side"));
  const amount = requireField<string>(params, "amount");

  const accts = resolveFlashAccounts(targetSymbol, collateralSymbol, side);

  const ix = getAddCollateralInstruction({
    owner: addressAsSigner(ctx.vault),
    fundingAccount: ctx.vault,
    perpetuals: accts.perpetuals,
    pool: accts.pool,
    position: requireField<string>(params, "positionPubKey") as Address,
    market: accts.market.market,
    targetCustody: accts.targetCustody.custody,
    targetOracleAccount: accts.targetCustody.oracle,
    collateralCustody: accts.collateralCustody.custody,
    collateralOracleAccount: accts.collateralCustody.oracle,
    collateralCustodyTokenAccount: accts.collateralCustody.tokenAccount,
    fundingTokenProgram: TOKEN_PROGRAM,
    eventAuthority: accts.eventAuthority,
    program: PERPETUALS_PROGRAM,
    ixSysvar: accts.ixSysvar,
    fundingMint: accts.collateralCustody.mint,
    collateralDelta: BigInt(amount),
  });

  return { instructions: [ix as Instruction] };
}

async function composeRemoveCollateral(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const targetSymbol = requireField<string>(params, "targetSymbol");
  const collateralSymbol = requireField<string>(params, "collateralSymbol");
  const side = parseSide(requireField<string>(params, "side"));
  const amount = requireField<string>(params, "amount");

  const accts = resolveFlashAccounts(targetSymbol, collateralSymbol, side);

  const ix = getRemoveCollateralInstruction({
    owner: addressAsSigner(ctx.vault),
    receivingAccount: ctx.vault,
    transferAuthority: accts.transferAuthority,
    perpetuals: accts.perpetuals,
    pool: accts.pool,
    position: requireField<string>(params, "positionPubKey") as Address,
    market: accts.market.market,
    targetCustody: accts.targetCustody.custody,
    targetOracleAccount: accts.targetCustody.oracle,
    collateralCustody: accts.collateralCustody.custody,
    collateralOracleAccount: accts.collateralCustody.oracle,
    collateralCustodyTokenAccount: accts.collateralCustody.tokenAccount,
    receivingTokenProgram: TOKEN_PROGRAM,
    eventAuthority: accts.eventAuthority,
    program: PERPETUALS_PROGRAM,
    ixSysvar: accts.ixSysvar,
    receivingMint: accts.collateralCustody.mint,
    collateralDeltaUsd: BigInt(amount),
  });

  return { instructions: [ix as Instruction] };
}

// ─── Compose: Trigger Orders (3 actions) ─────────────────────────────────────

async function composePlaceTriggerOrder(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const targetSymbol = requireField<string>(params, "targetSymbol");
  const collateralSymbol = requireField<string>(params, "collateralSymbol");
  const receiveSymbol = requireField<string>(params, "receiveSymbol");
  const side = parseSide(requireField<string>(params, "side"));
  const triggerPrice = requireField<{ price: string; exponent: number }>(params, "triggerPrice");
  const deltaSizeAmount = requireField<string>(params, "deltaSizeAmount");
  const isStopLoss = requireField<boolean>(params, "isStopLoss");

  const accts = resolveFlashAccounts(targetSymbol, collateralSymbol, side);
  const receiveCustody = FLASH_CUSTODY_MAP[receiveSymbol];
  if (!receiveCustody) throw new Error(`Unknown receive symbol: ${receiveSymbol}`);

  const orderKp = await generateKeyPairSigner();

  const ix = getPlaceTriggerOrderInstruction({
    owner: addressAsSigner(ctx.vault),
    feePayer: addressAsSigner(ctx.agent),
    perpetuals: accts.perpetuals,
    pool: accts.pool,
    position: requireField<string>(params, "positionPubKey") as Address,
    order: orderKp.address,
    market: accts.market.market,
    targetCustody: accts.targetCustody.custody,
    targetOracleAccount: accts.targetCustody.oracle,
    collateralCustody: accts.collateralCustody.custody,
    collateralOracleAccount: accts.collateralCustody.oracle,
    receiveCustody: receiveCustody.custody,
    systemProgram: SYSTEM_PROGRAM,
    eventAuthority: accts.eventAuthority,
    program: PERPETUALS_PROGRAM,
    ixSysvar: accts.ixSysvar,
    triggerPrice: parseOraclePrice(triggerPrice),
    deltaSizeAmount: BigInt(deltaSizeAmount),
    isStopLoss,
  });

  return { instructions: [ix as Instruction], additionalSigners: [orderKp] };
}

async function composeEditTriggerOrder(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const targetSymbol = requireField<string>(params, "targetSymbol");
  const collateralSymbol = requireField<string>(params, "collateralSymbol");
  const receiveSymbol = requireField<string>(params, "receiveSymbol");
  const side = parseSide(requireField<string>(params, "side"));
  const orderId = requireField<number>(params, "orderId");
  const triggerPrice = requireField<{ price: string; exponent: number }>(params, "triggerPrice");
  const deltaSizeAmount = requireField<string>(params, "deltaSizeAmount");
  const isStopLoss = requireField<boolean>(params, "isStopLoss");

  const accts = resolveFlashAccounts(targetSymbol, collateralSymbol, side);
  const receiveCustody = FLASH_CUSTODY_MAP[receiveSymbol];
  if (!receiveCustody) throw new Error(`Unknown receive symbol: ${receiveSymbol}`);

  const ix = getEditTriggerOrderInstruction({
    owner: addressAsSigner(ctx.vault),
    perpetuals: accts.perpetuals,
    pool: accts.pool,
    position: requireField<string>(params, "positionPubKey") as Address,
    order: requireField<string>(params, "orderPubKey") as Address,
    market: accts.market.market,
    targetCustody: accts.targetCustody.custody,
    targetOracleAccount: accts.targetCustody.oracle,
    collateralCustody: accts.collateralCustody.custody,
    collateralOracleAccount: accts.collateralCustody.oracle,
    receiveCustody: receiveCustody.custody,
    eventAuthority: accts.eventAuthority,
    program: PERPETUALS_PROGRAM,
    ixSysvar: accts.ixSysvar,
    orderId,
    triggerPrice: parseOraclePrice(triggerPrice),
    deltaSizeAmount: BigInt(deltaSizeAmount),
    isStopLoss,
  });

  return { instructions: [ix as Instruction] };
}

async function composeCancelTriggerOrder(
  _ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const orderId = requireField<number>(params, "orderId");
  const isStopLoss = requireField<boolean>(params, "isStopLoss");
  const orderPubKey = requireField<string>(params, "orderPubKey") as Address;

  const ix = getCancelTriggerOrderInstruction({
    owner: addressAsSigner(_ctx.vault),
    order: orderPubKey,
    eventAuthority: FLASH_EVENT_AUTHORITY,
    program: PERPETUALS_PROGRAM,
    orderId,
    isStopLoss,
  });

  return { instructions: [ix as Instruction] };
}

// ─── Compose: Limit Orders (3 actions) ───────────────────────────────────────

async function composePlaceLimitOrder(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const targetSymbol = requireField<string>(params, "targetSymbol");
  const collateralSymbol = requireField<string>(params, "collateralSymbol");
  const reserveSymbol = requireField<string>(params, "reserveSymbol");
  const receiveSymbol = requireField<string>(params, "receiveSymbol");
  const side = parseSide(requireField<string>(params, "side"));
  const limitPrice = requireField<{ price: string; exponent: number }>(params, "limitPrice");
  const reserveAmount = requireField<string>(params, "reserveAmount");
  const sizeAmount = requireField<string>(params, "sizeAmount");
  const stopLossPrice = requireField<{ price: string; exponent: number }>(params, "stopLossPrice");
  const takeProfitPrice = requireField<{ price: string; exponent: number }>(params, "takeProfitPrice");

  const accts = resolveFlashAccounts(targetSymbol, collateralSymbol, side);
  const reserveCustody = FLASH_CUSTODY_MAP[reserveSymbol];
  if (!reserveCustody) throw new Error(`Unknown reserve symbol: ${reserveSymbol}`);
  const receiveCustody = FLASH_CUSTODY_MAP[receiveSymbol];
  if (!receiveCustody) throw new Error(`Unknown receive symbol: ${receiveSymbol}`);

  const orderKp = await generateKeyPairSigner();
  const positionKp = await generateKeyPairSigner();

  const ix = getPlaceLimitOrderInstruction({
    owner: addressAsSigner(ctx.vault),
    feePayer: addressAsSigner(ctx.agent),
    fundingAccount: ctx.vault,
    perpetuals: accts.perpetuals,
    pool: accts.pool,
    position: positionKp.address,
    order: orderKp.address,
    market: accts.market.market,
    targetCustody: accts.targetCustody.custody,
    targetOracleAccount: accts.targetCustody.oracle,
    reserveCustody: reserveCustody.custody,
    reserveOracleAccount: reserveCustody.oracle,
    reserveCustodyTokenAccount: reserveCustody.tokenAccount,
    receiveCustody: receiveCustody.custody,
    systemProgram: SYSTEM_PROGRAM,
    fundingTokenProgram: TOKEN_PROGRAM,
    eventAuthority: accts.eventAuthority,
    program: PERPETUALS_PROGRAM,
    ixSysvar: accts.ixSysvar,
    fundingMint: reserveCustody.mint,
    limitPrice: parseOraclePrice(limitPrice),
    reserveAmount: BigInt(reserveAmount),
    sizeAmount: BigInt(sizeAmount),
    stopLossPrice: parseOraclePrice(stopLossPrice),
    takeProfitPrice: parseOraclePrice(takeProfitPrice),
  });

  return { instructions: [ix as Instruction], additionalSigners: [positionKp, orderKp] };
}

async function composeEditLimitOrder(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const targetSymbol = requireField<string>(params, "targetSymbol");
  const collateralSymbol = requireField<string>(params, "collateralSymbol");
  const reserveSymbol = requireField<string>(params, "reserveSymbol");
  const receiveSymbol = requireField<string>(params, "receiveSymbol");
  const side = parseSide(requireField<string>(params, "side"));
  const orderId = requireField<number>(params, "orderId");
  const limitPrice = requireField<{ price: string; exponent: number }>(params, "limitPrice");
  const sizeAmount = requireField<string>(params, "sizeAmount");
  const stopLossPrice = requireField<{ price: string; exponent: number }>(params, "stopLossPrice");
  const takeProfitPrice = requireField<{ price: string; exponent: number }>(params, "takeProfitPrice");

  const accts = resolveFlashAccounts(targetSymbol, collateralSymbol, side);
  const reserveCustody = FLASH_CUSTODY_MAP[reserveSymbol];
  if (!reserveCustody) throw new Error(`Unknown reserve symbol: ${reserveSymbol}`);
  const receiveCustody = FLASH_CUSTODY_MAP[receiveSymbol];
  if (!receiveCustody) throw new Error(`Unknown receive symbol: ${receiveSymbol}`);

  const ix = getEditLimitOrderInstruction({
    owner: addressAsSigner(ctx.vault),
    feePayer: addressAsSigner(ctx.agent),
    receivingAccount: ctx.vault,
    transferAuthority: accts.transferAuthority,
    perpetuals: accts.perpetuals,
    pool: accts.pool,
    position: requireField<string>(params, "positionPubKey") as Address,
    order: requireField<string>(params, "orderPubKey") as Address,
    market: accts.market.market,
    targetCustody: accts.targetCustody.custody,
    targetOracleAccount: accts.targetCustody.oracle,
    reserveCustody: reserveCustody.custody,
    reserveOracleAccount: reserveCustody.oracle,
    reserveCustodyTokenAccount: reserveCustody.tokenAccount,
    receiveCustody: receiveCustody.custody,
    receivingTokenProgram: TOKEN_PROGRAM,
    eventAuthority: accts.eventAuthority,
    program: PERPETUALS_PROGRAM,
    ixSysvar: accts.ixSysvar,
    receivingMint: reserveCustody.mint,
    orderId,
    limitPrice: parseOraclePrice(limitPrice),
    sizeAmount: BigInt(sizeAmount),
    stopLossPrice: parseOraclePrice(stopLossPrice),
    takeProfitPrice: parseOraclePrice(takeProfitPrice),
  });

  return { instructions: [ix as Instruction] };
}

/**
 * Flash Trade has no native cancelLimitOrder.
 * Uses editLimitOrder with sizeAmount=0 (matches flash-sdk pattern).
 */
async function composeCancelLimitOrder(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const zeroPrice = { price: "0", exponent: 0 };
  return composeEditLimitOrder(ctx, {
    ...params,
    sizeAmount: "0",
    limitPrice: zeroPrice,
    stopLossPrice: zeroPrice,
    takeProfitPrice: zeroPrice,
  });
}

// ─── Compose: Cross-Actions (2 actions) ──────────────────────────────────────

async function composeSwapAndOpen(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const targetSymbol = requireField<string>(params, "targetSymbol");
  const collateralSymbol = requireField<string>(params, "collateralSymbol");
  const side = parseSide(requireField<string>(params, "side"));
  const priceWithSlippage = requireField<{ price: string; exponent: number }>(params, "priceWithSlippage");
  const collateralAmount = requireField<string>(params, "collateralAmount");
  const sizeAmount = requireField<string>(params, "sizeAmount");
  const swapInstructions = (params.swapInstructions ?? []) as Instruction[];

  const accts = resolveFlashAccounts(targetSymbol, collateralSymbol, side);
  // For swapAndOpen: receivingCustody = the custody that receives the swap output
  const receivingCustody = FLASH_CUSTODY_MAP[collateralSymbol];
  if (!receivingCustody) throw new Error(`Unknown collateral symbol: ${collateralSymbol}`);

  const positionKp = await generateKeyPairSigner();

  const ix = getSwapAndOpenInstruction({
    owner: addressAsSigner(ctx.vault),
    feePayer: addressAsSigner(ctx.agent),
    fundingAccount: ctx.vault,
    transferAuthority: accts.transferAuthority,
    perpetuals: accts.perpetuals,
    pool: accts.pool,
    receivingCustody: receivingCustody.custody,
    receivingCustodyOracleAccount: receivingCustody.oracle,
    receivingCustodyTokenAccount: receivingCustody.tokenAccount,
    position: positionKp.address,
    market: accts.market.market,
    targetCustody: accts.targetCustody.custody,
    targetOracleAccount: accts.targetCustody.oracle,
    collateralCustody: accts.collateralCustody.custody,
    collateralOracleAccount: accts.collateralCustody.oracle,
    collateralCustodyTokenAccount: accts.collateralCustody.tokenAccount,
    systemProgram: SYSTEM_PROGRAM,
    fundingTokenProgram: TOKEN_PROGRAM,
    eventAuthority: accts.eventAuthority,
    program: PERPETUALS_PROGRAM,
    ixSysvar: accts.ixSysvar,
    fundingMint: receivingCustody.mint,
    collateralMint: accts.collateralCustody.mint,
    collateralTokenProgram: TOKEN_PROGRAM,
    priceWithSlippage: parseOraclePrice(priceWithSlippage),
    amountIn: BigInt(collateralAmount),
    sizeAmount: BigInt(sizeAmount),
    privilege: Privilege.None,
  });

  return {
    instructions: [...swapInstructions, ix as Instruction],
    additionalSigners: [positionKp],
  };
}

async function composeCloseAndSwap(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const targetSymbol = requireField<string>(params, "targetSymbol");
  const collateralSymbol = requireField<string>(params, "collateralSymbol");
  const side = parseSide(requireField<string>(params, "side"));
  const priceWithSlippage = requireField<{ price: string; exponent: number }>(params, "priceWithSlippage");
  const swapInstructions = (params.swapInstructions ?? []) as Instruction[];

  const accts = resolveFlashAccounts(targetSymbol, collateralSymbol, side);
  // For closeAndSwap: dispensingCustody = what gets dispensed after close
  const dispensingCustody = FLASH_CUSTODY_MAP[collateralSymbol];
  if (!dispensingCustody) throw new Error(`Unknown collateral symbol: ${collateralSymbol}`);

  const ix = getCloseAndSwapInstruction({
    owner: addressAsSigner(ctx.vault),
    feePayer: addressAsSigner(ctx.agent),
    receivingAccount: ctx.vault,
    collateralAccount: ctx.vault,
    transferAuthority: accts.transferAuthority,
    perpetuals: accts.perpetuals,
    pool: accts.pool,
    position: requireField<string>(params, "positionPubKey") as Address,
    market: accts.market.market,
    targetCustody: accts.targetCustody.custody,
    targetOracleAccount: accts.targetCustody.oracle,
    collateralCustody: accts.collateralCustody.custody,
    collateralOracleAccount: accts.collateralCustody.oracle,
    collateralCustodyTokenAccount: accts.collateralCustody.tokenAccount,
    dispensingCustody: dispensingCustody.custody,
    dispensingOracleAccount: dispensingCustody.oracle,
    dispensingCustodyTokenAccount: dispensingCustody.tokenAccount,
    receivingTokenProgram: TOKEN_PROGRAM,
    eventAuthority: accts.eventAuthority,
    program: PERPETUALS_PROGRAM,
    ixSysvar: accts.ixSysvar,
    receivingMint: accts.collateralCustody.mint,
    collateralMint: accts.collateralCustody.mint,
    collateralTokenProgram: TOKEN_PROGRAM,
    priceWithSlippage: parseOraclePrice(priceWithSlippage),
    privilege: Privilege.None,
  });

  return {
    instructions: [ix as Instruction, ...swapInstructions],
    additionalSigners: undefined,
  };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

const SUPPORTED_ACTIONS = [
  "openPosition",
  "closePosition",
  "increasePosition",
  "decreasePosition",
  "addCollateral",
  "removeCollateral",
  "placeTriggerOrder",
  "editTriggerOrder",
  "cancelTriggerOrder",
  "placeLimitOrder",
  "editLimitOrder",
  "cancelLimitOrder",
  "swapAndOpen",
  "closeAndSwap",
];

/**
 * Dispatch a Flash Trade action to the correct compose function.
 * Called by FlashTradeHandler.compose().
 */
export async function dispatchFlashTradeCompose(
  ctx: ProtocolContext,
  action: string,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  if (!SUPPORTED_ACTIONS.includes(action)) {
    throw new FlashTradeComposeError(
      "UNSUPPORTED_ACTION",
      `Unsupported action: ${action}. Supported: ${SUPPORTED_ACTIONS.join(", ")}`,
    );
  }

  switch (action) {
    case "openPosition": return composeOpenPosition(ctx, params);
    case "closePosition": return composeClosePosition(ctx, params);
    case "increasePosition": return composeIncreasePosition(ctx, params);
    case "decreasePosition": return composeDecreasePosition(ctx, params);
    case "addCollateral": return composeAddCollateral(ctx, params);
    case "removeCollateral": return composeRemoveCollateral(ctx, params);
    case "placeTriggerOrder": return composePlaceTriggerOrder(ctx, params);
    case "editTriggerOrder": return composeEditTriggerOrder(ctx, params);
    case "cancelTriggerOrder": return composeCancelTriggerOrder(ctx, params);
    case "placeLimitOrder": return composePlaceLimitOrder(ctx, params);
    case "editLimitOrder": return composeEditLimitOrder(ctx, params);
    case "cancelLimitOrder": return composeCancelLimitOrder(ctx, params);
    case "swapAndOpen": return composeSwapAndOpen(ctx, params);
    case "closeAndSwap": return composeCloseAndSwap(ctx, params);
    default: throw new FlashTradeComposeError("UNSUPPORTED_ACTION", `Unsupported action: ${action}. Supported: ${SUPPORTED_ACTIONS.join(", ")}`);
  }
}
