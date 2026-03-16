// @phalnx/kit analytics — Flash Trade position math (bigint-native)

// ─── Constants ──────────────────────────────────────────────────────────────
export {
  BPS_DECIMALS,
  BPS_POWER,
  USD_DECIMALS,
  USD_POWER,
  RATE_DECIMALS,
  RATE_POWER,
  ORACLE_EXPONENT,
  LP_DECIMALS,
  PERCENTAGE_DECIMALS,
  HOUR_SECONDS,
} from "./constants.js";

// ─── Decimal Math ───────────────────────────────────────────────────────────
export {
  checkedCeilDiv,
  checkedDecimalMul,
  checkedDecimalCeilMul,
  checkedDecimalDiv,
  scaleToExponent,
  pow,
  abs,
  min,
  max,
} from "./decimal-math.js";

// ─── Oracle Price ───────────────────────────────────────────────────────────
export { OraclePrice, ZERO_ORACLE_PRICE } from "./oracle-price.js";

// ─── Types ──────────────────────────────────────────────────────────────────
export { PositionSide } from "./types.js";
export type {
  PositionInfo,
  CustodyFees,
  BorrowRateState,
  BorrowRateParams,
  CustodyPricing,
  CustodyOracle,
  CustodyInfo,
  PnlResult,
  LeverageResult,
  PositionMetrics,
  DecreaseSizeResult,
  WithdrawableResult,
  EntryPriceResult,
  ExitPriceResult,
} from "./types.js";

// ─── PnL ────────────────────────────────────────────────────────────────────
export { getPnlUsd, getNetPnlUsd, hasProfit } from "./pnl.js";

// ─── Leverage ───────────────────────────────────────────────────────────────
export {
  getCurrentLeverage,
  getMaxLeverage,
  isOverLeveraged,
} from "./leverage.js";

// ─── Liquidation ────────────────────────────────────────────────────────────
export {
  getLiquidationPrice,
  getLiquidationPriceFromEntry,
  isLiquidatable,
} from "./liquidation.js";

// ─── Fees ───────────────────────────────────────────────────────────────────
export {
  getCumulativeLockFee,
  getLockFeeAndUnsettledUsd,
  getExitFeeUsd,
  getExitFeeUsdWithDiscount,
  getExitFee,
  getOpenFeeUsd,
  getBorrowRate,
} from "./fees.js";

// ─── Entry/Exit Price ───────────────────────────────────────────────────────
export {
  getTradeSpread,
  getEntryPrice,
  getExitPrice,
  getPriceAfterSlippage,
} from "./entry-exit-price.js";

// ─── Position Metrics ───────────────────────────────────────────────────────
export { getPositionMetrics } from "./position-metrics.js";

// ─── Decrease Size ──────────────────────────────────────────────────────────
export { getDecreaseSizeResult } from "./decrease-size.js";

// ─── Withdrawable ───────────────────────────────────────────────────────────
export { getMaxWithdrawable } from "./withdrawable.js";

// ─── Sizing ─────────────────────────────────────────────────────────────────
export {
  getSizeFromLeverageAndCollateral,
  getRequiredCollateral,
  getMaxPositionSizeUsd,
} from "./sizing.js";

// ─── Slippage ───────────────────────────────────────────────────────────────
export {
  estimateSlippage,
  getSwapPriceImpact,
} from "./slippage.js";

// ─── Swap Fees ──────────────────────────────────────────────────────────────
export {
  getSwapFee,
  getAddLiquidityFee,
  getRemoveLiquidityFee,
} from "./swap-fees.js";

// ─── Helpers ────────────────────────────────────────────────────────────────
export {
  getMinAndMaxOraclePrice,
  getAveragePrice,
} from "./helpers.js";
