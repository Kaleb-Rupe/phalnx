// Slippage estimation — simplified from flash-sdk pool-based model
// For analytics display only, not for transaction building

import { BPS_POWER, USD_DECIMALS } from "./constants.js";
import { OraclePrice } from "./oracle-price.js";

/**
 * Estimate slippage for a given trade size against pool liquidity.
 * Returns estimated slippage in BPS.
 *
 * Simple model: slippage_bps = (tradeSize / poolLiquidity) * BPS_POWER
 */
export function estimateSlippage(
  tradeSizeUsd: bigint,
  poolLiquidityUsd: bigint,
): bigint {
  if (poolLiquidityUsd === 0n) return BPS_POWER; // 100% slippage
  if (tradeSizeUsd === 0n) return 0n;

  return (tradeSizeUsd * BPS_POWER) / poolLiquidityUsd;
}

/**
 * Get price impact for a swap.
 * Returns the estimated output amount and price impact in BPS.
 */
export function getSwapPriceImpact(
  amountIn: bigint,
  inputPrice: OraclePrice,
  outputPrice: OraclePrice,
  inputDecimals: number,
  outputDecimals: number,
  poolLiquidityUsd: bigint,
): { estimatedAmountOut: bigint; priceImpactBps: bigint } {
  if (amountIn === 0n || inputPrice.price === 0n || outputPrice.price === 0n) {
    return { estimatedAmountOut: 0n, priceImpactBps: 0n };
  }

  const inputUsd = inputPrice.getAssetAmountUsd(amountIn, inputDecimals);
  const idealAmountOut = outputPrice.getTokenAmount(inputUsd, outputDecimals);

  const slippageBps = estimateSlippage(inputUsd, poolLiquidityUsd);

  // Apply slippage to output
  const estimatedAmountOut =
    idealAmountOut - (idealAmountOut * slippageBps) / BPS_POWER;

  return {
    estimatedAmountOut,
    priceImpactBps: slippageBps,
  };
}
