// Max withdrawable amount — ported from flash-sdk PerpetualsClient
// How much collateral can be removed while staying above max init leverage

import { BPS_POWER, RATE_POWER } from "./constants.js";
import { OraclePrice } from "./oracle-price.js";
import { getPnlUsd } from "./pnl.js";
import { getLockFeeAndUnsettledUsd, getExitFeeUsd } from "./fees.js";
import { getMinAndMaxOraclePrice } from "./helpers.js";
import type { PositionInfo, CustodyInfo, WithdrawableResult } from "./types.js";

/**
 * Calculate maximum withdrawable collateral.
 * Ensures position stays above max init leverage after withdrawal.
 *
 * @param errorBandwidthPct - Safety margin percentage (default 5%)
 */
export function getMaxWithdrawable(
  position: PositionInfo,
  targetPrice: OraclePrice,
  targetEmaPrice: OraclePrice,
  targetCustody: CustodyInfo,
  collateralPrice: OraclePrice,
  collateralEmaPrice: OraclePrice,
  collateralCustody: CustodyInfo,
  currentTimestamp: bigint,
  isDegen: boolean = false,
  errorBandwidthPct: number = 5,
): WithdrawableResult {
  if (errorBandwidthPct > 100 || errorBandwidthPct < 0) {
    throw new Error("errorBandwidthPct must be 0-100");
  }

  const maxInitLevRaw = isDegen
    ? BigInt(targetCustody.pricing.maxInitDegenLeverage)
    : BigInt(targetCustody.pricing.maxInitLeverage);

  const MAX_INIT_LEVERAGE =
    (maxInitLevRaw * BigInt(100 - errorBandwidthPct)) / 100n;

  // Check min collateral constraint
  const minCollateral = isDegen
    ? BigInt(targetCustody.pricing.minDegenCollateralUsd)
    : BigInt(targetCustody.pricing.minCollateralUsd);

  const maxRemoveAfterMin =
    position.collateralUsd -
    (minCollateral * BigInt(100 + errorBandwidthPct)) / 100n;

  if (maxRemoveAfterMin < 0n) {
    return { maxWithdrawableAmount: 0n, maxWithdrawableAmountUsd: 0n };
  }

  // Calculate PnL and fees
  const pnl = getPnlUsd(
    position,
    targetPrice,
    targetEmaPrice,
    targetCustody,
    currentTimestamp,
  );

  const collateralMinMaxPrice = getMinAndMaxOraclePrice(
    collateralPrice,
    collateralEmaPrice,
    collateralCustody,
  );

  const exitFeeUsd = getExitFeeUsd(position, targetCustody);
  const lockAndUnsettledFeeUsd = getLockFeeAndUnsettledUsd(
    position,
    collateralCustody,
    currentTimestamp,
  );

  const lossLiabilityUsd = pnl.lossUsd + position.priceImpactUsd;
  const lossUsd = lossLiabilityUsd + exitFeeUsd + lockAndUnsettledFeeUsd;

  if (pnl.lossUsd >= position.collateralUsd) {
    return { maxWithdrawableAmount: 0n, maxWithdrawableAmountUsd: 0n };
  }

  const availableInitMarginUsd = position.collateralUsd - lossUsd;

  // Max removable = available margin - required margin for max init leverage
  const maxRemovableCollateralUsd =
    availableInitMarginUsd - (position.sizeUsd * BPS_POWER) / MAX_INIT_LEVERAGE;

  if (maxRemovableCollateralUsd < 0n) {
    return { maxWithdrawableAmount: 0n, maxWithdrawableAmountUsd: 0n };
  }

  // Take the lesser of leverage-based and min-collateral-based limits
  let maxWithdrawableAmountUsd: bigint;
  if (maxRemoveAfterMin < maxRemovableCollateralUsd) {
    maxWithdrawableAmountUsd = maxRemoveAfterMin;
  } else {
    maxWithdrawableAmountUsd = maxRemovableCollateralUsd;
  }

  const maxWithdrawableAmount = collateralMinMaxPrice.max.getTokenAmount(
    maxWithdrawableAmountUsd,
    collateralCustody.decimals,
  );

  return { maxWithdrawableAmount, maxWithdrawableAmountUsd };
}
