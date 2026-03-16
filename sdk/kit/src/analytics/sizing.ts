// Position sizing calculations — ported from flash-sdk PerpetualsClient
// Compute max position size, required collateral, size from leverage

import { BPS_POWER, USD_DECIMALS, RATE_DECIMALS } from "./constants.js";
import { OraclePrice } from "./oracle-price.js";
import { getEntryPrice } from "./entry-exit-price.js";
import { getMinAndMaxOraclePrice } from "./helpers.js";
import type { CustodyInfo, PositionSide } from "./types.js";

/**
 * Calculate position size from desired leverage and collateral amount.
 *
 * sizeUsd = collateralUsd * leverage / (1 + 2 * openFeeRate * leverage)
 *
 * Returns size in token units.
 */
export function getSizeFromLeverageAndCollateral(
  collateralAmount: bigint,
  leverage: number,
  side: PositionSide,
  targetPrice: OraclePrice,
  targetEmaPrice: OraclePrice,
  targetCustody: CustodyInfo,
  collateralPrice: OraclePrice,
  collateralEmaPrice: OraclePrice,
  collateralCustody: CustodyInfo,
): bigint {
  const { min: collateralMinPrice } = getMinAndMaxOraclePrice(
    collateralPrice,
    collateralEmaPrice,
    collateralCustody,
  );

  const collateralUsd = collateralMinPrice.getAssetAmountUsd(
    collateralAmount,
    collateralCustody.decimals,
  );

  const openFeeRate = targetCustody.fees.openPosition;

  // sizeUsd = collateralUsd * leverage / (1 + 2 * feeRate * leverage)
  // Using fixed-point: scale everything to avoid precision loss
  const SCALE = 10n ** BigInt(RATE_DECIMALS);
  const leverageBn = BigInt(Math.round(leverage * 10000)) * SCALE / 10000n;

  const denominator =
    SCALE + (2n * openFeeRate * leverageBn) / SCALE;

  if (denominator === 0n) return 0n;

  const sizeUsd = (collateralUsd * leverageBn) / denominator;

  // Convert USD size to token amount using entry price
  const entryPrice = getEntryPrice(
    side,
    targetPrice,
    targetEmaPrice,
    targetCustody,
    sizeUsd,
  );

  if (entryPrice.price === 0n) return 0n;

  return entryPrice.getTokenAmount(sizeUsd, targetCustody.decimals);
}

/**
 * Calculate required collateral for a given size and leverage.
 *
 * collateralUsd = sizeUsd * (1 + 2 * feeRate * leverage) / leverage
 *
 * Returns collateral in token units.
 */
export function getRequiredCollateral(
  sizeAmount: bigint,
  leverage: number,
  side: PositionSide,
  targetPrice: OraclePrice,
  targetEmaPrice: OraclePrice,
  targetCustody: CustodyInfo,
  collateralPrice: OraclePrice,
  collateralEmaPrice: OraclePrice,
  collateralCustody: CustodyInfo,
): bigint {
  const sizeUsd = targetPrice.getAssetAmountUsd(
    sizeAmount,
    targetCustody.decimals,
  );

  const entryPrice = getEntryPrice(
    side,
    targetPrice,
    targetEmaPrice,
    targetCustody,
    sizeUsd,
  );

  const openFeeRate = targetCustody.fees.openPosition;
  const SCALE = 10n ** BigInt(RATE_DECIMALS);
  const leverageBn = BigInt(Math.round(leverage * 10000)) * SCALE / 10000n;

  if (leverageBn === 0n) return 0n;

  const sizeInUsd = entryPrice.getAssetAmountUsd(
    sizeAmount,
    targetCustody.decimals,
  );

  // collateralUsd = sizeUsd * (1 + 2*fee*lev) / lev
  const numerator =
    sizeInUsd * (SCALE + (2n * openFeeRate * leverageBn) / SCALE);
  const collateralUsd = numerator / leverageBn;

  const { min: collateralMinPrice } = getMinAndMaxOraclePrice(
    collateralPrice,
    collateralEmaPrice,
    collateralCustody,
  );

  return collateralMinPrice.getTokenAmount(
    collateralUsd,
    collateralCustody.decimals,
  );
}

/**
 * Get maximum position size in USD for a custody.
 */
export function getMaxPositionSizeUsd(
  custody: CustodyInfo,
): bigint {
  return custody.pricing.maxPositionSizeUsd;
}
