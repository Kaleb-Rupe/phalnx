// Entry and exit price calculation — ported from flash-sdk PerpetualsClient
// Applies spread based on position side and size

import { BPS_POWER, USD_DECIMALS, RATE_DECIMALS } from "./constants.js";
import { OraclePrice } from "./oracle-price.js";
import { getMinAndMaxOraclePrice } from "./helpers.js";
import type { CustodyInfo, PositionSide } from "./types.js";
import { PositionSide as Side } from "./types.js";

/**
 * Calculate trade spread based on position size.
 * Linear interpolation between tradeSpreadMin and tradeSpreadMax.
 */
export function getTradeSpread(
  custody: CustodyInfo,
  sizeUsd: bigint,
): bigint {
  const { pricing } = custody;
  const spreadRange = pricing.tradeSpreadMax - pricing.tradeSpreadMin;

  if (spreadRange === 0n || sizeUsd === 0n) return 0n;

  const scaleFactor = 10n ** BigInt(RATE_DECIMALS + 4); // BPS_DECIMALS = 4
  const slope = spreadRange * scaleFactor / pricing.maxPositionSizeUsd;
  const variable = slope * sizeUsd / scaleFactor;

  return pricing.tradeSpreadMin + variable;
}

/**
 * Get entry price with spread applied.
 * Longs pay above oracle (spread added), shorts pay below (spread subtracted).
 */
export function getEntryPrice(
  side: PositionSide,
  targetPrice: OraclePrice,
  targetEmaPrice: OraclePrice,
  targetCustody: CustodyInfo,
  sizeUsd: bigint,
): OraclePrice {
  const { min: minPrice, max: maxPrice } = getMinAndMaxOraclePrice(
    targetPrice,
    targetEmaPrice,
    targetCustody,
  );

  const spread = getTradeSpread(targetCustody, sizeUsd);
  const USD_POWER = 10n ** BigInt(USD_DECIMALS);

  const entryPriceBn =
    side === Side.Long
      ? maxPrice.price + (maxPrice.price * spread) / USD_POWER
      : minPrice.price - (minPrice.price * spread) / USD_POWER;

  return new OraclePrice({
    price: entryPriceBn < 0n ? 0n : entryPriceBn,
    exponent: maxPrice.exponent,
    confidence: maxPrice.confidence,
  });
}

/**
 * Get exit price with spread applied (inverse of entry).
 * Longs exit below oracle (spread subtracted), shorts exit above (spread added).
 */
export function getExitPrice(
  side: PositionSide,
  targetPrice: OraclePrice,
  targetEmaPrice: OraclePrice,
  targetCustody: CustodyInfo,
  sizeUsd: bigint,
): OraclePrice {
  const { min: minPrice, max: maxPrice } = getMinAndMaxOraclePrice(
    targetPrice,
    targetEmaPrice,
    targetCustody,
  );

  const spread = getTradeSpread(targetCustody, sizeUsd);
  const USD_POWER = 10n ** BigInt(USD_DECIMALS);

  const exitPriceBn =
    side === Side.Long
      ? maxPrice.price - (maxPrice.price * spread) / USD_POWER
      : minPrice.price + (minPrice.price * spread) / USD_POWER;

  return new OraclePrice({
    price: exitPriceBn < 0n ? 0n : exitPriceBn,
    exponent: maxPrice.exponent,
    confidence: maxPrice.confidence,
  });
}

/**
 * Get entry price adjusted for slippage tolerance.
 */
export function getPriceAfterSlippage(
  isEntry: boolean,
  slippageBps: bigint,
  targetPrice: OraclePrice,
  side: PositionSide,
): { price: bigint; exponent: number } {
  const currentPrice = targetPrice.price;
  const scaledSlippage = currentPrice * slippageBps / BPS_POWER;

  if (isEntry) {
    if (side === Side.Long) {
      return {
        price: currentPrice + scaledSlippage,
        exponent: Number(targetPrice.exponent),
      };
    }
    const result = currentPrice - scaledSlippage;
    return {
      price: result < 0n ? 0n : result,
      exponent: Number(targetPrice.exponent),
    };
  }

  // Exit
  if (side === Side.Long) {
    const result = currentPrice - scaledSlippage;
    return {
      price: result < 0n ? 0n : result,
      exponent: Number(targetPrice.exponent),
    };
  }
  return {
    price: currentPrice + scaledSlippage,
    exponent: Number(targetPrice.exponent),
  };
}
