// Liquidation price calculation — ported from flash-sdk PerpetualsClient
// Solves for the price where net value <= liquidation threshold.

import { BPS_POWER, RATE_POWER, RATE_DECIMALS } from "./constants.js";
import { OraclePrice, ZERO_ORACLE_PRICE } from "./oracle-price.js";
import { scaleToExponent } from "./decimal-math.js";
import { getLockFeeAndUnsettledUsd, getExitFeeUsd } from "./fees.js";
import { getPnlUsd } from "./pnl.js";
import type { PositionInfo, CustodyInfo } from "./types.js";
import { PositionSide } from "./types.js";

/**
 * Calculate liquidation price for a position.
 * Ported from flash-sdk getLiquidationPriceContractHelper.
 *
 * The liquidation price is where:
 *   collateralUsd - liabilities = sizeUsd * BPS_POWER / maxLeverage
 *
 * liabilities = exitFee + lockFee + unsettledFees
 */
export function getLiquidationPrice(
  position: PositionInfo,
  targetCustody: CustodyInfo,
  collateralCustody: CustodyInfo,
  currentTimestamp: bigint,
): OraclePrice {
  const entryOraclePrice = new OraclePrice({
    price: position.entryPrice.price,
    exponent: position.entryPrice.exponent,
  });

  const lockAndUnsettledFeeUsd = getLockFeeAndUnsettledUsd(
    position,
    collateralCustody,
    currentTimestamp,
  );

  return getLiquidationPriceFromEntry(
    entryOraclePrice,
    lockAndUnsettledFeeUsd,
    position.side,
    targetCustody,
    position,
  );
}

/**
 * Core liquidation price calculation.
 * Mirrors flash-sdk getLiquidationPriceContractHelper exactly.
 */
export function getLiquidationPriceFromEntry(
  entryOraclePrice: OraclePrice,
  lockAndUnsettledFeeUsd: bigint,
  side: PositionSide,
  targetCustody: CustodyInfo,
  position: PositionInfo,
): OraclePrice {
  if (position.sizeAmount === 0n) return ZERO_ORACLE_PRICE;

  const exitFeeUsd =
    (position.sizeUsd * targetCustody.fees.closePosition) / RATE_POWER;
  const unsettledLossUsd = exitFeeUsd + lockAndUnsettledFeeUsd;

  // liabilities = margin requirement + fees
  const liabilitiesUsd =
    (position.sizeUsd * BPS_POWER) / BigInt(targetCustody.pricing.maxLeverage) +
    unsettledLossUsd;

  const sizeDecimalsPlusFactor = BigInt(position.sizeDecimals + 3);
  const scaleFactor = 10n ** sizeDecimalsPlusFactor;

  if (position.collateralUsd >= liabilitiesUsd) {
    // Normal case: collateral exceeds liabilities
    // priceDiff = (collateral - liabilities) * scale / sizeAmount
    const priceDiffRaw =
      ((position.collateralUsd - liabilitiesUsd) * scaleFactor) /
      position.sizeAmount;

    const priceDiffOracle = new OraclePrice({
      price: priceDiffRaw,
      exponent: BigInt(-RATE_DECIMALS),
    }).scaleToExponent(entryOraclePrice.exponent);

    if (side === PositionSide.Long) {
      const liqPrice = entryOraclePrice.price - priceDiffOracle.price;
      return liqPrice < 0n
        ? ZERO_ORACLE_PRICE
        : new OraclePrice({
            price: liqPrice,
            exponent: entryOraclePrice.exponent,
          });
    }
    // Short: liquidation is above entry
    return new OraclePrice({
      price: entryOraclePrice.price + priceDiffOracle.price,
      exponent: entryOraclePrice.exponent,
    });
  }

  // Underwater: liabilities exceed collateral
  const priceDiffRaw =
    ((liabilitiesUsd - position.collateralUsd) * scaleFactor) /
    position.sizeAmount;

  const priceDiffOracle = new OraclePrice({
    price: priceDiffRaw,
    exponent: BigInt(-RATE_DECIMALS),
  }).scaleToExponent(entryOraclePrice.exponent);

  if (side === PositionSide.Long) {
    // Already underwater — liq price is above entry
    return new OraclePrice({
      price: entryOraclePrice.price + priceDiffOracle.price,
      exponent: entryOraclePrice.exponent,
    });
  }
  // Short underwater — liq price is below entry
  const liqPrice = entryOraclePrice.price - priceDiffOracle.price;
  return liqPrice < 0n
    ? ZERO_ORACLE_PRICE
    : new OraclePrice({ price: liqPrice, exponent: entryOraclePrice.exponent });
}

/**
 * Check if position is liquidatable at current price.
 */
export function isLiquidatable(
  position: PositionInfo,
  targetPrice: OraclePrice,
  targetEmaPrice: OraclePrice,
  targetCustody: CustodyInfo,
  collateralCustody: CustodyInfo,
  currentTimestamp: bigint,
): boolean {
  if (position.sizeUsd === 0n) return false;

  const liqPrice = getLiquidationPrice(
    position,
    targetCustody,
    collateralCustody,
    currentTimestamp,
  );

  if (liqPrice.price === 0n) return false;

  if (position.side === PositionSide.Long) {
    return targetPrice.price <= liqPrice.price;
  }
  return targetPrice.price >= liqPrice.price;
}
