/**
 * Kamino Lending compose functions — Kit-native via Codama pre-generated builders.
 *
 * Zero runtime dependency on @kamino-finance/klend-sdk or web3.js.
 * Each function: resolves accounts → builds refresh + main instructions → returns.
 *
 * 4 actions: deposit, borrow, repay, withdraw.
 * Each prepends refreshReserve + refreshObligation.
 */

import type { Address, Instruction } from "@solana/kit";
import type { ProtocolContext, ProtocolComposeResult } from "./protocol-handler.js";
import {
  COMPOSE_ERROR_CODES,
  KaminoComposeError,
  createSafeBigInt,
  createRequireField,
  addressAsSigner,
} from "./compose-errors.js";
import {
  resolveKaminoAccounts,
  KAMINO_LEND_PROGRAM,
  TOKEN_PROGRAM,
  IX_SYSVAR,
  type KaminoReserveConfig,
  type KaminoOracleConfig,
} from "./config/kamino-markets.js";

// ─── Generated Instruction Builders ──────────────────────────────────────────
import { getRefreshReserveInstruction } from "../generated/protocols/kamino/instructions/refreshReserve.js";
import { getRefreshObligationInstruction } from "../generated/protocols/kamino/instructions/refreshObligation.js";
import { getDepositReserveLiquidityAndObligationCollateralInstruction } from "../generated/protocols/kamino/instructions/depositReserveLiquidityAndObligationCollateral.js";
import { getBorrowObligationLiquidityInstruction } from "../generated/protocols/kamino/instructions/borrowObligationLiquidity.js";
import { getRepayObligationLiquidityInstruction } from "../generated/protocols/kamino/instructions/repayObligationLiquidity.js";
import { getWithdrawObligationCollateralAndRedeemReserveCollateralInstruction } from "../generated/protocols/kamino/instructions/withdrawObligationCollateralAndRedeemReserveCollateral.js";

// ─── Param Validation ────────────────────────────────────────────────────────

const requireField = createRequireField(
  (field) => new KaminoComposeError(COMPOSE_ERROR_CODES.MISSING_PARAM, `Missing required parameter: ${field}`),
);

const safeBigInt = createSafeBigInt(
  (field, value) => new KaminoComposeError(COMPOSE_ERROR_CODES.INVALID_BIGINT, `Invalid numeric value for ${field}: ${String(value)}`),
);

// ─── Refresh Instructions ────────────────────────────────────────────────────

function buildRefreshReserve(
  reserve: KaminoReserveConfig,
  oracles: KaminoOracleConfig,
  lendingMarket: Address,
): Instruction {
  return getRefreshReserveInstruction({
    reserve: reserve.reserve,
    lendingMarket,
    pythOracle: oracles.pythOracle,
    switchboardPriceOracle: oracles.switchboardPriceOracle,
    switchboardTwapOracle: oracles.switchboardTwapOracle,
    scopePrices: oracles.scopePrices,
  }, { programAddress: KAMINO_LEND_PROGRAM }) as Instruction;
}

function buildRefreshObligation(
  obligation: Address,
  lendingMarket: Address,
): Instruction {
  return getRefreshObligationInstruction({
    lendingMarket,
    obligation,
  }, { programAddress: KAMINO_LEND_PROGRAM }) as Instruction;
}

// ─── Compose Functions ───────────────────────────────────────────────────────

async function composeDeposit(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const amount = requireField<string>(params, "amount");
  const tokenSymbol = requireField<string>(params, "tokenMint"); // Symbol-based lookup
  const obligation = requireField<string>(params, "obligation") as Address;

  const accts = resolveKaminoAccounts(tokenSymbol, params.market as Address | undefined);

  const refreshReserve = buildRefreshReserve(accts.reserve, accts.oracles, accts.lendingMarket);
  const refreshObligation = buildRefreshObligation(obligation, accts.lendingMarket);

  const depositIx = getDepositReserveLiquidityAndObligationCollateralInstruction({
    owner: addressAsSigner(ctx.vault),
    obligation,
    lendingMarket: accts.lendingMarket,
    lendingMarketAuthority: accts.lendingMarketAuthority,
    reserve: accts.reserve.reserve,
    reserveLiquidityMint: accts.reserve.liquidityMint,
    reserveLiquiditySupply: accts.reserve.liquiditySupply,
    reserveCollateralMint: accts.reserve.collateralMint,
    reserveDestinationDepositCollateral: accts.reserve.collateralSupply,
    userSourceLiquidity: ctx.vault, // Vault's token account
    collateralTokenProgram: TOKEN_PROGRAM,
    liquidityTokenProgram: TOKEN_PROGRAM,
    instructionSysvarAccount: IX_SYSVAR,
    liquidityAmount: safeBigInt(amount, "amount"),
  }, { programAddress: KAMINO_LEND_PROGRAM }) as Instruction;

  return { instructions: [refreshReserve, refreshObligation, depositIx] };
}

async function composeBorrow(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const amount = requireField<string>(params, "amount");
  const tokenSymbol = requireField<string>(params, "tokenMint");
  const obligation = requireField<string>(params, "obligation") as Address;

  const accts = resolveKaminoAccounts(tokenSymbol, params.market as Address | undefined);

  const refreshReserve = buildRefreshReserve(accts.reserve, accts.oracles, accts.lendingMarket);
  const refreshObligation = buildRefreshObligation(obligation, accts.lendingMarket);

  const borrowIx = getBorrowObligationLiquidityInstruction({
    owner: addressAsSigner(ctx.vault),
    obligation,
    lendingMarket: accts.lendingMarket,
    lendingMarketAuthority: accts.lendingMarketAuthority,
    borrowReserve: accts.reserve.reserve,
    borrowReserveLiquidityMint: accts.reserve.liquidityMint,
    reserveSourceLiquidity: accts.reserve.liquiditySupply,
    borrowReserveLiquidityFeeReceiver: accts.reserve.feeReceiver,
    userDestinationLiquidity: ctx.vault,
    referrerTokenState: null as unknown as Address, // Optional referrer
    tokenProgram: TOKEN_PROGRAM,
    instructionSysvarAccount: IX_SYSVAR,
    liquidityAmount: safeBigInt(amount, "amount"),
  }, { programAddress: KAMINO_LEND_PROGRAM }) as Instruction;

  return { instructions: [refreshReserve, refreshObligation, borrowIx] };
}

async function composeRepay(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const amount = requireField<string>(params, "amount");
  const tokenSymbol = requireField<string>(params, "tokenMint");
  const obligation = requireField<string>(params, "obligation") as Address;

  const accts = resolveKaminoAccounts(tokenSymbol, params.market as Address | undefined);

  const refreshReserve = buildRefreshReserve(accts.reserve, accts.oracles, accts.lendingMarket);
  const refreshObligation = buildRefreshObligation(obligation, accts.lendingMarket);

  const repayIx = getRepayObligationLiquidityInstruction({
    owner: addressAsSigner(ctx.vault),
    obligation,
    lendingMarket: accts.lendingMarket,
    repayReserve: accts.reserve.reserve,
    reserveLiquidityMint: accts.reserve.liquidityMint,
    reserveDestinationLiquidity: accts.reserve.liquiditySupply,
    userSourceLiquidity: ctx.vault,
    tokenProgram: TOKEN_PROGRAM,
    instructionSysvarAccount: IX_SYSVAR,
    liquidityAmount: safeBigInt(amount, "amount"),
  }, { programAddress: KAMINO_LEND_PROGRAM }) as Instruction;

  return { instructions: [refreshReserve, refreshObligation, repayIx] };
}

async function composeWithdraw(
  ctx: ProtocolContext,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  const amount = requireField<string>(params, "amount");
  const tokenSymbol = requireField<string>(params, "tokenMint");
  const obligation = requireField<string>(params, "obligation") as Address;

  const accts = resolveKaminoAccounts(tokenSymbol, params.market as Address | undefined);

  const refreshReserve = buildRefreshReserve(accts.reserve, accts.oracles, accts.lendingMarket);
  const refreshObligation = buildRefreshObligation(obligation, accts.lendingMarket);

  const withdrawIx = getWithdrawObligationCollateralAndRedeemReserveCollateralInstruction({
    owner: addressAsSigner(ctx.vault),
    obligation,
    lendingMarket: accts.lendingMarket,
    lendingMarketAuthority: accts.lendingMarketAuthority,
    withdrawReserve: accts.reserve.reserve,
    reserveLiquidityMint: accts.reserve.liquidityMint,
    reserveCollateralMint: accts.reserve.collateralMint,
    reserveLiquiditySupply: accts.reserve.liquiditySupply,
    reserveSourceCollateral: accts.reserve.collateralSupply,
    userDestinationLiquidity: ctx.vault,
    placeholderUserDestinationCollateral: undefined,
    collateralTokenProgram: TOKEN_PROGRAM,
    liquidityTokenProgram: TOKEN_PROGRAM,
    instructionSysvarAccount: IX_SYSVAR,
    collateralAmount: safeBigInt(amount, "amount"),
  }, { programAddress: KAMINO_LEND_PROGRAM }) as Instruction;

  return { instructions: [refreshReserve, refreshObligation, withdrawIx] };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

type KaminoActionHandler = (
  ctx: ProtocolContext,
  params: Record<string, unknown>,
) => Promise<ProtocolComposeResult>;

const KAMINO_ACTIONS: Readonly<Record<string, KaminoActionHandler>> = Object.freeze({
  deposit: composeDeposit,
  borrow: composeBorrow,
  repay: composeRepay,
  withdraw: composeWithdraw,
});

/**
 * Dispatch a Kamino action to the correct compose function.
 * Called by KaminoHandler.compose().
 */
export async function dispatchKaminoCompose(
  ctx: ProtocolContext,
  action: string,
  params: Record<string, unknown>,
): Promise<ProtocolComposeResult> {
  if (!Object.hasOwn(KAMINO_ACTIONS, action)) {
    throw new KaminoComposeError(
      COMPOSE_ERROR_CODES.UNSUPPORTED_ACTION,
      `Unsupported action: ${action}. Supported: ${Object.keys(KAMINO_ACTIONS).join(", ")}`,
    );
  }
  return KAMINO_ACTIONS[action as keyof typeof KAMINO_ACTIONS](ctx, params);
}
