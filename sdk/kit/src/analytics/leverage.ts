// Leverage calculation — ported from flash-sdk PerpetualsClient
// leverage = sizeUsd * BPS_POWER / currentMarginUsd

import { BPS_POWER, RATE_POWER } from "./constants.js";
import { OraclePrice } from "./oracle-price.js";
import { getPnlUsd } from "./pnl.js";
import { getExitFeeUsd, getLockFeeAndUnsettledUsd } from "./fees.js";
import type { PositionInfo, CustodyInfo, LeverageResult } from "./types.js";

/** Max leverage sentinel value when margin <= 0 */
const MAX_LEVERAGE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Calculate current leverage for a position.
 * leverage = sizeUsd * BPS_POWER / (collateralUsd + profitUsd - lossUsd - fees)
 * Returns leverage in BPS units (10000 = 1x).
 */
export function getCurrentLeverage(
  position: PositionInfo,
  targetPrice: OraclePrice,
  targetEmaPrice: OraclePrice,
  targetCustody: CustodyInfo,
  collateralCustody: CustodyInfo,
  currentTimestamp: bigint,
): bigint {
  const pnl = getPnlUsd(
    position,
    targetPrice,
    targetEmaPrice,
    targetCustody,
    currentTimestamp,
  );

  const exitFee = getExitFeeUsd(position, targetCustody);
  const lockFeeUsd = getLockFeeAndUnsettledUsd(
    position,
    collateralCustody,
    currentTimestamp,
  );

  const unsettledFeesUsd = exitFee + lockFeeUsd;
  const lossUsd = pnl.lossUsd + unsettledFeesUsd;
  const currentMarginUsd =
    position.collateralUsd + pnl.profitUsd - lossUsd;

  if (currentMarginUsd > 0n) {
    return (position.sizeUsd * BPS_POWER) / currentMarginUsd;
  }
  return MAX_LEVERAGE;
}

/**
 * Get max leverage from custody config.
 * Returns as raw u32 value (e.g. 1000000 for 100x at BPS_POWER scale).
 */
export function getMaxLeverage(
  targetCustody: CustodyInfo,
  isDegen: boolean = false,
): number {
  return isDegen
    ? targetCustody.pricing.maxDegenLeverage
    : targetCustody.pricing.maxLeverage;
}

/**
 * Check if position is over max leverage.
 */
export function isOverLeveraged(
  position: PositionInfo,
  targetPrice: OraclePrice,
  targetEmaPrice: OraclePrice,
  targetCustody: CustodyInfo,
  collateralCustody: CustodyInfo,
  currentTimestamp: bigint,
  isDegen: boolean = false,
): LeverageResult {
  const leverage = getCurrentLeverage(
    position,
    targetPrice,
    targetEmaPrice,
    targetCustody,
    collateralCustody,
    currentTimestamp,
  );

  const maxLev = BigInt(getMaxLeverage(targetCustody, isDegen));
  return {
    leverage,
    isOverLeveraged: leverage > maxLev,
  };
}
