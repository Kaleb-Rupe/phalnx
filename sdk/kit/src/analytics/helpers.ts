// Shared oracle/price helpers used across analytics modules.
// Ported from flash-sdk PerpetualsClient internal methods.

import { BPS_POWER } from "./constants.js";
import { OraclePrice } from "./oracle-price.js";
import type { CustodyInfo } from "./types.js";

/**
 * Get min and max oracle prices considering EMA divergence and confidence.
 * Mirrors flash-sdk's getMinAndMaxOraclePriceSync.
 */
export function getMinAndMaxOraclePrice(
  price: OraclePrice,
  emaPrice: OraclePrice,
  custody: CustodyInfo,
): { min: OraclePrice; max: OraclePrice } {
  let maxPrice = new OraclePrice({
    price: price.price,
    exponent: price.exponent,
    confidence: price.confidence,
  });
  let minPrice = new OraclePrice({
    price: price.price,
    exponent: price.exponent,
    confidence: price.confidence,
  });

  const divergenceBps = custody.isStable
    ? maxPrice.getDivergenceFactor(
        new OraclePrice({
          price:
            10n **
            (maxPrice.exponent < 0n
              ? -maxPrice.exponent
              : maxPrice.exponent),
          exponent: maxPrice.exponent,
          confidence: maxPrice.confidence,
        }),
      )
    : maxPrice.getDivergenceFactor(emaPrice);

  if (divergenceBps >= custody.oracle.maxDivergenceBps) {
    const confBps =
      maxPrice.price !== 0n
        ? (maxPrice.confidence * BPS_POWER) / maxPrice.price
        : 0n;

    if (confBps < custody.oracle.maxConfBps) {
      minPrice = new OraclePrice({
        price: maxPrice.price - maxPrice.confidence,
        exponent: maxPrice.exponent,
        confidence: maxPrice.confidence,
      });
      maxPrice = new OraclePrice({
        price: maxPrice.price + maxPrice.confidence,
        exponent: maxPrice.exponent,
        confidence: maxPrice.confidence,
      });
      return { min: minPrice, max: maxPrice };
    }
    minPrice = new OraclePrice({
      price: maxPrice.price - maxPrice.confidence,
      exponent: maxPrice.exponent,
      confidence: maxPrice.confidence,
    });
    return { min: minPrice, max: maxPrice };
  }

  return { min: maxPrice, max: maxPrice };
}

/**
 * Calculate average price for position size increase.
 * avgPrice = (size1 * price1 + size2 * price2) / (size1 + size2)
 */
export function getAveragePrice(
  price1: bigint,
  size1: bigint,
  price2: bigint,
  size2: bigint,
): bigint {
  const totalSize = size1 + size2;
  if (totalSize === 0n) return 0n;
  return (size1 * price1 + size2 * price2) / totalSize;
}
