// Flash Trade analytics constants — ported from flash-sdk/constants

/** Basis points decimal places */
export const BPS_DECIMALS = 4;

/** 10^BPS_DECIMALS */
export const BPS_POWER = 10_000n;

/** USD decimal places (USDC/USDT = 6 decimals) */
export const USD_DECIMALS = 6;

/** 10^USD_DECIMALS */
export const USD_POWER = 1_000_000n;

/** Rate decimal places (borrow rates, fee rates) */
export const RATE_DECIMALS = 9;

/** 10^RATE_DECIMALS */
export const RATE_POWER = 1_000_000_000n;

/** Oracle exponent (prices stored with 9 decimal precision) */
export const ORACLE_EXPONENT = 9;

/** LP token decimals (same as USD) */
export const LP_DECIMALS = USD_DECIMALS;

/** Percentage decimals (same as BPS) */
export const PERCENTAGE_DECIMALS = 4;

/** Seconds in an hour (used for borrow rate accumulation) */
export const HOUR_SECONDS = 3_600n;
