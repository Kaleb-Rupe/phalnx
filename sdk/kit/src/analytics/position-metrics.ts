// Composite position metrics — ported from flash-sdk PerpetualsClient.getPositionMetrics
// Single call for dashboard cards: PnL + leverage + liquidation + fees

import { BPS_POWER } from "./constants.js";
import { OraclePrice, ZERO_ORACLE_PRICE } from "./oracle-price.js";
import { getPnlUsd } from "./pnl.js";
import { getExitFeeUsd, getLockFeeAndUnsettledUsd } from "./fees.js";
import { getLiquidationPriceFromEntry } from "./liquidation.js";
import type { PositionInfo, CustodyInfo, PositionMetrics } from "./types.js";

const MAX_LEVERAGE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Get all position metrics in a single call.
 * Returns PnL, leverage, liquidation price, and fees.
 * Optimized to avoid redundant calculations.
 */
export function getPositionMetrics(
  position: PositionInfo,
  targetPrice: OraclePrice,
  targetEmaPrice: OraclePrice,
  targetCustody: CustodyInfo,
  collateralCustody: CustodyInfo,
  currentTimestamp: bigint,
): PositionMetrics {
  if (position.sizeUsd === 0n || position.entryPrice.price === 0n) {
    return {
      pnl: { profitUsd: 0n, lossUsd: 0n, priceImpactUsd: 0n },
      leverage: 0n,
      liquidationPrice: ZERO_ORACLE_PRICE,
      fees: { exitFeeUsd: 0n, lockAndUnsettledFeeUsd: 0n },
    };
  }

  const entryOraclePrice = new OraclePrice({
    price: position.entryPrice.price,
    exponent: position.entryPrice.exponent,
  });

  // Calculate PnL
  const pnl = getPnlUsd(
    position,
    targetPrice,
    targetEmaPrice,
    targetCustody,
    currentTimestamp,
  );

  // Calculate fees
  const exitFeeUsd = getExitFeeUsd(position, targetCustody);
  const lockAndUnsettledFeeUsd = getLockFeeAndUnsettledUsd(
    position,
    collateralCustody,
    currentTimestamp,
  );

  // Calculate liquidation price
  const liquidationPrice = getLiquidationPriceFromEntry(
    entryOraclePrice,
    lockAndUnsettledFeeUsd,
    position.side,
    targetCustody,
    position,
  );

  // Calculate leverage
  const unsettledFeesUsd = exitFeeUsd + lockAndUnsettledFeeUsd;
  const lossUsd = pnl.lossUsd + unsettledFeesUsd;
  const currentMarginUsd = position.collateralUsd + pnl.profitUsd - lossUsd;

  const leverage =
    currentMarginUsd > 0n
      ? (position.sizeUsd * BPS_POWER) / currentMarginUsd
      : MAX_LEVERAGE;

  return {
    pnl,
    leverage,
    liquidationPrice,
    fees: { exitFeeUsd, lockAndUnsettledFeeUsd },
  };
}
