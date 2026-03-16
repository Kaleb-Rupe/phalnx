// Analytics-only input types.
// These are minimal shapes — consumers map from full on-chain accounts.

import type { OraclePrice } from "./oracle-price.js";

/** Position side */
export enum PositionSide {
  Long = 1,
  Short = 2,
}

/** Minimal position fields needed for analytics */
export interface PositionInfo {
  /** Position size in token units */
  sizeAmount: bigint;
  /** Position size in USD (6 decimals) */
  sizeUsd: bigint;
  /** Collateral in USD (6 decimals) */
  collateralUsd: bigint;
  /** Entry price oracle data */
  entryPrice: { price: bigint; exponent: number };
  /** Reference price for delay window */
  referencePrice: { price: bigint; exponent: number };
  /** Token decimals for the size asset */
  sizeDecimals: number;
  /** Collateral token decimals */
  collateralDecimals: number;
  /** Locked collateral in token units */
  lockedAmount: bigint;
  /** Locked collateral decimals */
  lockedDecimals: number;
  /** Cumulative lock fee snapshot at position open/update */
  cumulativeLockFeeSnapshot: bigint;
  /** Unsettled fees in USD */
  unsettledFeesUsd: bigint;
  /** Last update timestamp (seconds) */
  updateTime: bigint;
  /** Price impact in USD */
  priceImpactUsd: bigint;
  /** Position side */
  side: PositionSide;
  /** Degen mode size in USD (0 if not degen) */
  degenSizeUsd: bigint;
}

/** Fee schedule from custody account */
export interface CustodyFees {
  /** Open position fee rate (RATE_DECIMALS) */
  openPosition: bigint;
  /** Close position fee rate (RATE_DECIMALS) */
  closePosition: bigint;
  /** Swap spread in BPS */
  swapSpread: bigint;
  /** Volatility fee rate */
  volatility: bigint;
}

/** Borrow rate state from custody */
export interface BorrowRateState {
  /** Current borrow rate per hour */
  currentRate: bigint;
  /** Cumulative lock fee */
  cumulativeLockFee: bigint;
  /** Last update timestamp */
  lastUpdate: bigint;
}

/** Borrow rate params from custody */
export interface BorrowRateParams {
  /** Optimal utilization rate */
  optimalUtilization: bigint;
  /** Slope 1 rate */
  slope1: bigint;
  /** Slope 2 rate */
  slope2: bigint;
}

/** Pricing params from custody */
export interface CustodyPricing {
  /** Min trade spread (BPS-scaled) */
  tradeSpreadMin: bigint;
  /** Max trade spread (BPS-scaled) */
  tradeSpreadMax: bigint;
  /** Swap spread */
  swapSpread: bigint;
  /** Max position size in USD */
  maxPositionSizeUsd: bigint;
  /** Max leverage (u32 from on-chain) */
  maxLeverage: number;
  /** Max init leverage (u32) */
  maxInitLeverage: number;
  /** Max degen leverage (u32) */
  maxDegenLeverage: number;
  /** Max init degen leverage (u32) */
  maxInitDegenLeverage: number;
  /** Min collateral USD (u32) */
  minCollateralUsd: number;
  /** Min degen collateral USD (u32) */
  minDegenCollateralUsd: number;
  /** Max utilization (u32) */
  maxUtilization: number;
  /** Delay seconds */
  delaySeconds: bigint;
}

/** Oracle config from custody */
export interface CustodyOracle {
  maxDivergenceBps: bigint;
  maxConfBps: bigint;
  maxPriceAgeSec: number;
}

/** Minimal custody fields needed for analytics */
export interface CustodyInfo {
  /** Token decimals */
  decimals: number;
  /** Fee schedule */
  fees: CustodyFees;
  /** Borrow rate state */
  borrowRateState: BorrowRateState;
  /** Borrow rate params */
  borrowRate: BorrowRateParams;
  /** Pricing params */
  pricing: CustodyPricing;
  /** Oracle config */
  oracle: CustodyOracle;
  /** Whether this is a stablecoin custody */
  isStable: boolean;
}

/** PnL result */
export interface PnlResult {
  profitUsd: bigint;
  lossUsd: bigint;
  priceImpactUsd: bigint;
}

/** Leverage result in BPS */
export interface LeverageResult {
  leverage: bigint;
  isOverLeveraged: boolean;
}

/** Full position metrics (composite result) */
export interface PositionMetrics {
  pnl: PnlResult;
  leverage: bigint;
  liquidationPrice: OraclePrice;
  fees: {
    exitFeeUsd: bigint;
    lockAndUnsettledFeeUsd: bigint;
  };
}

/** Decrease size result */
export interface DecreaseSizeResult {
  newSizeUsd: bigint;
  feeUsd: bigint;
  lockAndUnsettledFeeUsd: bigint;
  collateralAmountReceivedUsd: bigint;
  newCollateralUsd: bigint;
  newLeverage: bigint;
  liquidationPrice: OraclePrice;
}

/** Withdrawable amount result */
export interface WithdrawableResult {
  maxWithdrawableAmountUsd: bigint;
  maxWithdrawableAmount: bigint;
}

/** Entry price and fee result */
export interface EntryPriceResult {
  entryOraclePrice: OraclePrice;
  feeUsd: bigint;
}

/** Exit price and fee result */
export interface ExitPriceResult {
  exitOraclePrice: OraclePrice;
  exitFeeUsd: bigint;
  borrowFeeUsd: bigint;
}
