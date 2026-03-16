// Decrease size / partial close calculation
// Ported from flash-sdk PerpetualsClient.getDecreaseSizeCollateralAndFeeSync

import { BPS_POWER, RATE_POWER } from "./constants.js";
import { OraclePrice } from "./oracle-price.js";
import { min } from "./decimal-math.js";
import { getPnlUsd } from "./pnl.js";
import {
  getLockFeeAndUnsettledUsd,
} from "./fees.js";
import { getLiquidationPriceFromEntry } from "./liquidation.js";
import { getMinAndMaxOraclePrice } from "./helpers.js";
import type {
  PositionInfo,
  CustodyInfo,
  DecreaseSizeResult,
} from "./types.js";

/**
 * Calculate result of partially closing a position.
 * Returns new position state, fees, and liquidation price.
 *
 * @param position - Current position
 * @param sizeDeltaUsd - USD amount to close
 * @param targetPrice - Current target token price
 * @param targetEmaPrice - Target token EMA price
 * @param targetCustody - Target custody config
 * @param collateralPrice - Collateral token price
 * @param collateralEmaPrice - Collateral EMA price
 * @param collateralCustody - Collateral custody config
 * @param currentTimestamp - Current time in seconds
 */
export function getDecreaseSizeResult(
  position: PositionInfo,
  sizeDeltaUsd: bigint,
  targetPrice: OraclePrice,
  targetEmaPrice: OraclePrice,
  targetCustody: CustodyInfo,
  collateralPrice: OraclePrice,
  collateralEmaPrice: OraclePrice,
  collateralCustody: CustodyInfo,
  currentTimestamp: bigint,
): DecreaseSizeResult {
  // Compute close ratio
  const entryOraclePrice = new OraclePrice({
    price: position.entryPrice.price,
    exponent: position.entryPrice.exponent,
  });

  const sizeDeltaAmount = entryOraclePrice.getTokenAmount(
    sizeDeltaUsd,
    position.sizeDecimals,
  );

  const decimalPower = 10n ** BigInt(position.sizeDecimals);
  const closeRatio =
    position.sizeAmount !== 0n
      ? (sizeDeltaAmount * decimalPower) / position.sizeAmount
      : 0n;

  // Apply close ratio to get delta position
  const deltaSizeUsd = (position.sizeUsd * closeRatio) / decimalPower;
  const deltaCollateralUsd =
    (position.collateralUsd * closeRatio) / decimalPower;
  const deltaLockedAmount =
    (position.lockedAmount * closeRatio) / decimalPower;
  const deltaUnsettledFeesUsd =
    (position.unsettledFeesUsd * closeRatio) / decimalPower;
  const deltaPriceImpactUsd =
    (position.priceImpactUsd * closeRatio) / decimalPower;
  const deltaDegenSizeUsd =
    (position.degenSizeUsd * closeRatio) / decimalPower;

  // Build delta position for PnL calc
  const deltaPosition: PositionInfo = {
    ...position,
    sizeAmount: sizeDeltaAmount,
    sizeUsd: deltaSizeUsd,
    collateralUsd: deltaCollateralUsd,
    lockedAmount: deltaLockedAmount,
    unsettledFeesUsd: deltaUnsettledFeesUsd,
    priceImpactUsd: deltaPriceImpactUsd,
    degenSizeUsd: deltaDegenSizeUsd,
  };

  // Calculate PnL and fees for the closed portion
  const pnl = getPnlUsd(
    deltaPosition,
    targetPrice,
    targetEmaPrice,
    targetCustody,
    currentTimestamp,
  );

  const exitFeeUsd =
    deltaSizeUsd * targetCustody.fees.closePosition / RATE_POWER;

  const lockAndUnsettledFeeUsd = getLockFeeAndUnsettledUsd(
    deltaPosition,
    collateralCustody,
    currentTimestamp,
  );

  const totalFeesUsd = exitFeeUsd + lockAndUnsettledFeeUsd;

  // Calculate close amount
  const collateralMinMaxPrice = getMinAndMaxOraclePrice(
    collateralPrice,
    collateralEmaPrice,
    collateralCustody,
  );

  const lossLiabilityUsd = pnl.lossUsd + deltaPriceImpactUsd;
  const liabilityUsd = lossLiabilityUsd + totalFeesUsd;
  const assetsUsd = min(
    pnl.profitUsd + deltaCollateralUsd,
    collateralMinMaxPrice.max.getAssetAmountUsd(
      deltaLockedAmount,
      collateralCustody.decimals,
    ),
  );

  let closeAmountUsd: bigint;
  if (assetsUsd >= liabilityUsd) {
    closeAmountUsd = assetsUsd - liabilityUsd;
  } else {
    closeAmountUsd = 0n;
  }

  // Build resulting position
  const newSizeUsd = position.sizeUsd - deltaSizeUsd;
  const newCollateralUsd =
    position.collateralUsd - deltaCollateralUsd + closeAmountUsd;

  // Calculate new leverage and liquidation price for resulting position
  const newPosition: PositionInfo = {
    ...position,
    sizeAmount: position.sizeAmount - sizeDeltaAmount,
    sizeUsd: newSizeUsd,
    collateralUsd: newCollateralUsd,
    lockedAmount: position.lockedAmount - deltaLockedAmount,
    unsettledFeesUsd: position.unsettledFeesUsd - deltaUnsettledFeesUsd,
    priceImpactUsd: position.priceImpactUsd - deltaPriceImpactUsd,
    degenSizeUsd: position.degenSizeUsd - deltaDegenSizeUsd,
  };

  const newLockFee = getLockFeeAndUnsettledUsd(
    newPosition,
    collateralCustody,
    currentTimestamp,
  );

  const liquidationPrice = getLiquidationPriceFromEntry(
    entryOraclePrice,
    newLockFee,
    position.side,
    targetCustody,
    newPosition,
  );

  const newExitFee =
    newSizeUsd * targetCustody.fees.closePosition / RATE_POWER;
  const newUnsettledFees = newExitFee + newLockFee;
  const newPnl = getPnlUsd(
    newPosition,
    targetPrice,
    targetEmaPrice,
    targetCustody,
    currentTimestamp,
  );
  const newMargin =
    newCollateralUsd + newPnl.profitUsd - newPnl.lossUsd - newUnsettledFees;
  const newLeverage =
    newMargin > 0n
      ? (newSizeUsd * BPS_POWER) / newMargin
      : BigInt(Number.MAX_SAFE_INTEGER);

  return {
    newSizeUsd,
    feeUsd: exitFeeUsd + lockAndUnsettledFeeUsd,
    lockAndUnsettledFeeUsd,
    collateralAmountReceivedUsd: closeAmountUsd,
    newCollateralUsd,
    newLeverage,
    liquidationPrice,
  };
}
