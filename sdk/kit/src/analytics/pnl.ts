// PnL calculation — ported from flash-sdk PerpetualsClient.getPnlContractHelper
// Computes unrealized profit/loss for a position.

import { OraclePrice } from "./oracle-price.js";
import { getExitPrice } from "./entry-exit-price.js";
import type { PositionInfo, CustodyInfo, PnlResult } from "./types.js";
import { PositionSide } from "./types.js";

/**
 * Calculate position PnL in USD.
 * Uses exit price (with spread) vs entry price.
 * Respects the delay window: if within delay period, uses referencePrice.
 */
export function getPnlUsd(
  position: PositionInfo,
  targetPrice: OraclePrice,
  targetEmaPrice: OraclePrice,
  targetCustody: CustodyInfo,
  currentTimestamp: bigint,
): PnlResult {
  if (position.sizeUsd === 0n || position.entryPrice.price === 0n) {
    return { profitUsd: 0n, lossUsd: 0n, priceImpactUsd: 0n };
  }

  const exitOraclePrice = getExitPrice(
    position.side,
    targetPrice,
    targetEmaPrice,
    targetCustody,
    position.sizeUsd,
  );

  const positionEntryPrice = new OraclePrice({
    price: position.entryPrice.price,
    exponent: position.entryPrice.exponent,
  });

  let priceDiffProfit = 0n;
  let priceDiffLoss = 0n;
  const delayExpired =
    currentTimestamp > position.updateTime + targetCustody.pricing.delaySeconds;

  if (position.side === PositionSide.Long) {
    if (exitOraclePrice.price > positionEntryPrice.price) {
      if (delayExpired) {
        priceDiffProfit = exitOraclePrice.price - positionEntryPrice.price;
      } else if (position.referencePrice.price > positionEntryPrice.price) {
        priceDiffProfit =
          position.referencePrice.price - positionEntryPrice.price;
      }
      // else both zero (within delay, no profit)
    } else {
      priceDiffLoss = positionEntryPrice.price - exitOraclePrice.price;
    }
  } else {
    // Short
    if (exitOraclePrice.price < positionEntryPrice.price) {
      if (delayExpired) {
        priceDiffProfit = positionEntryPrice.price - exitOraclePrice.price;
      } else if (positionEntryPrice.price > position.referencePrice.price) {
        priceDiffProfit =
          positionEntryPrice.price - position.referencePrice.price;
      }
    } else {
      priceDiffLoss = exitOraclePrice.price - positionEntryPrice.price;
    }
  }

  const priceDiffOracle = new OraclePrice({
    price: priceDiffProfit > 0n ? priceDiffProfit : priceDiffLoss,
    exponent: exitOraclePrice.exponent,
  });

  const grossUsd = priceDiffOracle.getAssetAmountUsd(
    position.sizeAmount,
    position.sizeDecimals,
  );

  if (priceDiffProfit > 0n) {
    return {
      profitUsd: grossUsd,
      lossUsd: 0n,
      priceImpactUsd: position.priceImpactUsd,
    };
  }
  return {
    profitUsd: 0n,
    lossUsd: grossUsd,
    priceImpactUsd: position.priceImpactUsd,
  };
}

/**
 * Get net PnL (profit - loss) as a signed value.
 */
export function getNetPnlUsd(pnl: PnlResult): bigint {
  return pnl.profitUsd - pnl.lossUsd;
}

/**
 * Check if position has unrealized profit.
 */
export function hasProfit(pnl: PnlResult): boolean {
  return pnl.profitUsd > pnl.lossUsd;
}
