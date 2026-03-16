// Fee calculations — ported from flash-sdk PerpetualsClient
// Borrow fees, exit fees, cumulative lock fees

import { RATE_POWER, HOUR_SECONDS, BPS_POWER } from "./constants.js";
import { OraclePrice } from "./oracle-price.js";
import type {
  PositionInfo,
  CustodyInfo,
  BorrowRateState,
} from "./types.js";

/**
 * Get cumulative lock fee up to current timestamp.
 * Extrapolates from last update using current borrow rate.
 */
export function getCumulativeLockFee(
  borrowRateState: BorrowRateState,
  currentTimestamp: bigint,
): bigint {
  if (currentTimestamp > borrowRateState.lastUpdate) {
    return (
      (currentTimestamp - borrowRateState.lastUpdate) *
        borrowRateState.currentRate /
        HOUR_SECONDS +
      borrowRateState.cumulativeLockFee
    );
  }
  return borrowRateState.cumulativeLockFee;
}

/**
 * Get lock fee + unsettled fees for a position.
 * This is the total borrow cost accrued since position open/last update.
 */
export function getLockFeeAndUnsettledUsd(
  position: PositionInfo,
  collateralCustody: CustodyInfo,
  currentTimestamp: bigint,
): bigint {
  const cumulativeLockFee = getCumulativeLockFee(
    collateralCustody.borrowRateState,
    currentTimestamp,
  );

  let lockFeeUsd = 0n;
  if (cumulativeLockFee > position.cumulativeLockFeeSnapshot) {
    lockFeeUsd =
      (cumulativeLockFee - position.cumulativeLockFeeSnapshot) *
        position.sizeUsd /
        RATE_POWER;
  }

  return lockFeeUsd + position.unsettledFeesUsd;
}

/**
 * Get exit fee for closing a position.
 * exitFeeUsd = sizeUsd * closePositionRate / RATE_POWER
 */
export function getExitFeeUsd(
  position: PositionInfo,
  targetCustody: CustodyInfo,
): bigint {
  return position.sizeUsd * targetCustody.fees.closePosition / RATE_POWER;
}

/**
 * Get exit fee with discount applied.
 */
export function getExitFeeUsdWithDiscount(
  position: PositionInfo,
  targetCustody: CustodyInfo,
  discountBps: bigint = 0n,
): bigint {
  let fee = getExitFeeUsd(position, targetCustody);
  if (discountBps > 0n) {
    const discount = fee * discountBps / BPS_POWER;
    fee = fee - discount;
  }
  return fee;
}

/**
 * Get exit fee as a token amount.
 */
export function getExitFee(
  position: PositionInfo,
  targetCustody: CustodyInfo,
  collateralCustody: CustodyInfo,
  collateralPrice: OraclePrice,
  collateralEmaPrice: OraclePrice,
  discountBps: bigint = 0n,
): { exitFeeAmount: bigint; exitFeeUsd: bigint } {
  let closePositionFeeRate = targetCustody.fees.closePosition;
  if (discountBps > 0n) {
    closePositionFeeRate =
      closePositionFeeRate * (RATE_POWER - discountBps) / RATE_POWER;
  }

  const exitFeeUsd = position.sizeUsd * closePositionFeeRate / RATE_POWER;
  const minPrice = getMinOraclePrice(
    collateralPrice,
    collateralEmaPrice,
    collateralCustody,
  );
  const exitFeeAmount = minPrice.getTokenAmount(
    exitFeeUsd,
    collateralCustody.decimals,
  );

  return { exitFeeAmount, exitFeeUsd };
}

/**
 * Get open position fee in USD.
 * feeUsd = sizeUsd * openPositionRate / RATE_POWER
 */
export function getOpenFeeUsd(
  sizeUsd: bigint,
  targetCustody: CustodyInfo,
): bigint {
  return sizeUsd * targetCustody.fees.openPosition / RATE_POWER;
}

/**
 * Get current borrow rate based on utilization.
 * Two-slope model: slope1 up to optimal, slope2 from optimal to max.
 */
export function getBorrowRate(
  custody: CustodyInfo,
  currentUtilization: bigint,
): bigint {
  const { borrowRate } = custody;

  if (
    currentUtilization < borrowRate.optimalUtilization ||
    borrowRate.optimalUtilization >= RATE_POWER
  ) {
    return (
      currentUtilization * borrowRate.slope1 / borrowRate.optimalUtilization
    );
  }

  if (currentUtilization < BigInt(custody.pricing.maxUtilization)) {
    return (
      borrowRate.slope1 +
      (currentUtilization - borrowRate.optimalUtilization) *
        borrowRate.slope2 /
        (BigInt(custody.pricing.maxUtilization) -
          borrowRate.optimalUtilization)
    );
  }

  return borrowRate.slope1 + borrowRate.slope2;
}

// --- Internal helpers ---

/** Get the minimum oracle price considering divergence and confidence */
function getMinOraclePrice(
  price: OraclePrice,
  emaPrice: OraclePrice,
  custody: CustodyInfo,
): OraclePrice {
  const divergenceBps = custody.isStable
    ? price.getDivergenceFactor(
        new OraclePrice({
          price: 10n ** (price.exponent < 0n ? -price.exponent : price.exponent),
          exponent: price.exponent,
        }),
      )
    : price.getDivergenceFactor(emaPrice);

  if (divergenceBps >= custody.oracle.maxDivergenceBps) {
    const confBps =
      price.price !== 0n
        ? (price.confidence * BPS_POWER) / price.price
        : 0n;
    if (confBps < custody.oracle.maxConfBps) {
      return new OraclePrice({
        price: price.price - price.confidence,
        exponent: price.exponent,
        confidence: price.confidence,
      });
    }
    return new OraclePrice({
      price: price.price - price.confidence,
      exponent: price.exponent,
      confidence: price.confidence,
    });
  }
  return price;
}
