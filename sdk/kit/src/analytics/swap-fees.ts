// Swap fee calculations — simplified from flash-sdk fee model
// For analytics estimates only

import { RATE_POWER } from "./constants.js";
import type { CustodyInfo } from "./types.js";

/**
 * Get swap fee for a given amount.
 * Uses the custody's swap fee rate.
 *
 * In flash-sdk the fee model is complex (ratio-dependent).
 * This provides a simplified estimate using the open position fee as proxy.
 */
export function getSwapFee(
  amount: bigint,
  custody: CustodyInfo,
): bigint {
  // Use openPosition fee rate as a reasonable swap fee estimate
  // The actual fee depends on pool ratios which require full pool state
  return (amount * custody.fees.openPosition) / RATE_POWER;
}

/**
 * Get add liquidity fee estimate.
 * Simplified: uses openPosition rate as proxy.
 */
export function getAddLiquidityFee(
  amount: bigint,
  custody: CustodyInfo,
): bigint {
  return (amount * custody.fees.openPosition) / RATE_POWER;
}

/**
 * Get remove liquidity fee estimate.
 * Simplified: uses closePosition rate as proxy.
 */
export function getRemoveLiquidityFee(
  amount: bigint,
  custody: CustodyInfo,
): bigint {
  return (amount * custody.fees.closePosition) / RATE_POWER;
}
