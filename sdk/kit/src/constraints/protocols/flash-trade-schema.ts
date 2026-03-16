/**
 * Flash Trade Protocol Schema — Instruction Layouts
 *
 * All discriminators, field offsets, and account indices are sourced from
 * Codama-generated types in sdk/kit/src/generated/protocols/flash-trade/.
 *
 * OraclePrice = { price: u64, exponent: i32 } = 12 bytes
 * Privilege = enum (1 byte)
 *
 * Common data layout patterns:
 *   [8 disc][12 oraclePrice][8 field1][8 field2][1 privilege] — openPosition, closePosition, etc.
 *   [8 disc][8 field1]... — addCollateral, removeCollateral, etc.
 */

import type { Address } from "@solana/kit";
import type { InstructionSchema, ProtocolSchema } from "../types.js";

// Re-export for consumers
export const FLASH_TRADE_PROGRAM: Address =
  "FLASH6Lo6h3iasJKWDs2F8TkW2UKf3s15C8PMGuVfgBn" as Address;

// ─── Instruction Schemas ────────────────────────────────────────────────────

const openPosition: InstructionSchema = {
  name: "openPosition",
  discriminator: new Uint8Array([135, 128, 47, 77, 15, 152, 240, 49]),
  fields: [
    { name: "collateralAmount", offset: 20, type: "u64", size: 8 },
    { name: "sizeAmount", offset: 28, type: "u64", size: 8 },
  ],
  accounts: { market: 7, targetCustody: 8 },
  dataSize: 37, // 8+12+8+8+1
};

const closePosition: InstructionSchema = {
  name: "closePosition",
  discriminator: new Uint8Array([123, 134, 81, 0, 49, 68, 98, 98]),
  fields: [], // no constrainable fields
  accounts: { market: 7 },
  dataSize: 21, // 8+12+1
};

const increaseSize: InstructionSchema = {
  name: "increaseSize",
  discriminator: new Uint8Array([107, 13, 141, 238, 152, 165, 96, 87]),
  fields: [
    { name: "sizeDelta", offset: 20, type: "u64", size: 8 },
  ],
  accounts: { market: 5, targetCustody: 6 },
  dataSize: 29, // 8+12+8+1
};

const decreaseSize: InstructionSchema = {
  name: "decreaseSize",
  discriminator: new Uint8Array([171, 28, 203, 29, 118, 16, 214, 169]),
  fields: [
    { name: "sizeDelta", offset: 20, type: "u64", size: 8 },
  ],
  accounts: { market: 5, targetCustody: 6 },
  dataSize: 29, // 8+12+8+1
};

const addCollateral: InstructionSchema = {
  name: "addCollateral",
  discriminator: new Uint8Array([127, 82, 121, 42, 161, 176, 249, 206]),
  fields: [
    { name: "collateralDelta", offset: 8, type: "u64", size: 8 },
  ],
  accounts: { market: 5 },
  dataSize: 16, // 8+8
};

const removeCollateral: InstructionSchema = {
  name: "removeCollateral",
  discriminator: new Uint8Array([86, 222, 130, 86, 92, 20, 72, 65]),
  fields: [
    { name: "collateralDeltaUsd", offset: 8, type: "u64", size: 8 },
  ],
  accounts: { market: 6 },
  dataSize: 16, // 8+8
};

const placeTriggerOrder: InstructionSchema = {
  name: "placeTriggerOrder",
  discriminator: new Uint8Array([32, 156, 50, 188, 232, 159, 112, 236]),
  fields: [
    { name: "deltaSizeAmount", offset: 20, type: "u64", size: 8 },
  ],
  accounts: { market: 6 },
  dataSize: 29, // 8+12+8+1
};

const editTriggerOrder: InstructionSchema = {
  name: "editTriggerOrder",
  discriminator: new Uint8Array([180, 43, 215, 112, 254, 116, 20, 133]),
  fields: [
    { name: "deltaSizeAmount", offset: 21, type: "u64", size: 8 },
  ],
  accounts: { market: 5 },
  dataSize: 30, // 8+1(bool)+12+8+1
};

const cancelTriggerOrder: InstructionSchema = {
  name: "cancelTriggerOrder",
  discriminator: new Uint8Array([144, 84, 67, 39, 27, 25, 202, 141]),
  fields: [], // no constrainable fields
  accounts: {}, // no market account
  dataSize: 8, // discriminator only
};

const placeLimitOrder: InstructionSchema = {
  name: "placeLimitOrder",
  discriminator: new Uint8Array([108, 176, 33, 186, 146, 229, 1, 197]),
  fields: [
    { name: "reserveAmount", offset: 20, type: "u64", size: 8 },
    { name: "sizeAmount", offset: 28, type: "u64", size: 8 },
  ],
  accounts: { market: 7 },
  dataSize: 37, // 8+12+8+8+1
};

const editLimitOrder: InstructionSchema = {
  name: "editLimitOrder",
  discriminator: new Uint8Array([42, 114, 3, 11, 137, 245, 206, 50]),
  fields: [
    { name: "sizeAmount", offset: 21, type: "u64", size: 8 },
  ],
  accounts: { market: 8 },
  dataSize: 30, // 8+1(bool)+12+8+1
};

const cancelLimitOrder: InstructionSchema = {
  name: "cancelLimitOrder",
  discriminator: new Uint8Array([132, 156, 132, 31, 67, 40, 232, 97]),
  fields: [], // no constrainable fields
  accounts: {}, // no market account
  dataSize: 8, // discriminator only
};

const swapAndOpen: InstructionSchema = {
  name: "swapAndOpen",
  discriminator: new Uint8Array([26, 209, 42, 0, 169, 62, 30, 118]),
  fields: [
    { name: "amountIn", offset: 20, type: "u64", size: 8 },
    { name: "sizeAmount", offset: 28, type: "u64", size: 8 },
  ],
  accounts: { market: 10 },
  dataSize: 45, // 8+12+8+8+8+1
};

const closeAndSwap: InstructionSchema = {
  name: "closeAndSwap",
  discriminator: new Uint8Array([147, 164, 185, 240, 155, 33, 165, 125]),
  fields: [], // no constrainable fields
  accounts: { market: 8 },
  dataSize: 29, // 8+12+8+1
};

const swapAndAddCollateral: InstructionSchema = {
  name: "swapAndAddCollateral",
  discriminator: new Uint8Array([135, 207, 228, 112, 247, 15, 29, 150]),
  fields: [
    { name: "amountIn", offset: 8, type: "u64", size: 8 },
  ],
  accounts: { market: 10 },
  dataSize: 24, // 8+8+8
};

const removeCollateralAndSwap: InstructionSchema = {
  name: "removeCollateralAndSwap",
  discriminator: new Uint8Array([197, 216, 82, 134, 173, 128, 23, 62]),
  fields: [
    { name: "collateralDeltaUsd", offset: 8, type: "u64", size: 8 },
  ],
  accounts: { market: 8 },
  dataSize: 24, // 8+8+8
};

// ─── Protocol Schema ────────────────────────────────────────────────────────

const instructions = new Map<string, InstructionSchema>();
for (const ix of [
  openPosition,
  closePosition,
  increaseSize,
  decreaseSize,
  addCollateral,
  removeCollateral,
  placeTriggerOrder,
  editTriggerOrder,
  cancelTriggerOrder,
  placeLimitOrder,
  editLimitOrder,
  cancelLimitOrder,
  swapAndOpen,
  closeAndSwap,
  swapAndAddCollateral,
  removeCollateralAndSwap,
]) {
  instructions.set(ix.name, ix);
}

export const FLASH_TRADE_SCHEMA: ProtocolSchema = {
  protocolId: "flash-trade",
  programAddress: FLASH_TRADE_PROGRAM,
  instructions,
};

// ─── Action Categories ──────────────────────────────────────────────────────

/** Actions that can open or increase exposure (spending) */
export const SPENDING_ACTIONS = [
  "openPosition",
  "increaseSize",
  "swapAndOpen",
  "addCollateral",
  "swapAndAddCollateral",
  "placeLimitOrder",
  "placeTriggerOrder",
] as const;

/** Actions that reduce exposure or are risk-reducing */
export const RISK_REDUCING_ACTIONS = [
  "closePosition",
  "decreaseSize",
  "removeCollateral",
  "removeCollateralAndSwap",
  "closeAndSwap",
  "cancelTriggerOrder",
  "cancelLimitOrder",
  "editTriggerOrder",
  "editLimitOrder",
] as const;

/** Actions with a "sizeAmount" or "sizeDelta" field (for maxPositionSize) */
export const SIZE_CONSTRAINED_ACTIONS = [
  "openPosition",
  "increaseSize",
  "swapAndOpen",
] as const;

/** Actions with a "collateralAmount" or "collateralDelta" field (for maxCollateral) */
export const COLLATERAL_CONSTRAINED_ACTIONS = [
  "openPosition",
  "addCollateral",
] as const;

/** Actions with order size fields (for maxOrderSize) */
export const ORDER_SIZE_ACTIONS = [
  "placeLimitOrder",
  "editLimitOrder",
  "placeTriggerOrder",
  "editTriggerOrder",
] as const;
