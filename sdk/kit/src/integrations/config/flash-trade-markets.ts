/**
 * Flash Trade Crypto.1 Pool — Static Account Config (mainnet-beta)
 *
 * Sourced from flash-sdk PoolConfig.json for Crypto.1 mainnet-beta.
 * These addresses change only on protocol upgrades.
 */

import type { Address } from "@solana/kit";

// ─── Program + Global ────────────────────────────────────────────────────────

export const PERPETUALS_PROGRAM =
  "FLASH6Lo6h3iasJKWDs2F8TkW2UKf3s15C8PMGuVfgBn" as Address;

/** Global perpetuals account */
export const FLASH_PERPETUALS =
  "7DWCtB5Z8rPiyBMKUwqyC95R9tJpbhoQhLM9LbK3Z5QZ" as Address;

/** Transfer authority PDA */
export const FLASH_TRANSFER_AUTHORITY =
  "81xGAvJ27ZeRThU2JEfKAUeT4Fx6qCCd8WHZpujZbiiG" as Address;

/** Crypto.1 pool address */
export const FLASH_POOL =
  "HfF7GCcEc76xubFCHLLXRdYcgRzwjEPdfKWqzRS8Ncog" as Address;

/** Event authority PDA — derived from ["__event_authority"] */
export const FLASH_EVENT_AUTHORITY =
  "9qb3KAyARHqhVGQjJmzSVJ1hTm3KDR2QL8EBW5paXkUB" as Address;

/** Instructions sysvar */
export const IX_SYSVAR =
  "Sysvar1nstructions1111111111111111111111111" as Address;

/** SPL Token program */
export const TOKEN_PROGRAM =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;

/** System program */
export const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;

// ─── Custody Map ─────────────────────────────────────────────────────────────

export interface FlashCustodyConfig {
  custody: Address;
  oracle: Address;
  tokenAccount: Address;
  mint: Address;
  decimals: number;
}

export const FLASH_CUSTODY_MAP: Record<string, FlashCustodyConfig> = {
  USDC: {
    custody: "5N2St2e1BdgWsJiXxfetwWKkHS1BYochAp1ruPFJUfgY" as Address,
    oracle: "GCtJxWQ57B3BJUYdWrhb3TUxzeiDUx275ZCxKkTV6G3N" as Address,
    tokenAccount: "BC5xAUpEbfeSWi5fJdvhFQhM3eMbTok2c7SY62daB3da" as Address,
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address,
    decimals: 6,
  },
  SOL: {
    custody: "BjzZ33nMnbXZ7rw3Uy9Uu1W7BDCzzugqkiZoamJHRKF7" as Address,
    oracle: "DXqtMo8qRBfHcK11kBnSaCSXkWKk1huMf94R6sAxLHtf" as Address,
    tokenAccount: "Hhed3wTHoVoPpnuBntGf236UfowMMAXfxqTLkMyJJENe" as Address,
    mint: "So11111111111111111111111111111111111111112" as Address,
    decimals: 9,
  },
  BTC: {
    custody: "Ghi8YvZeDEzPAGvve7we3Rthquk84CULra6ERkGQF1Rv" as Address,
    oracle: "BYj2rSPK5JcvvVZGBN88j1TmW7mmtf1Rx3GMTqvdwB5c" as Address,
    tokenAccount: "55UmrYacpb8v7gbKswDofmWjLS8TSP3VB8NKjNfxu11d" as Address,
    mint: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh" as Address,
    decimals: 8,
  },
  ETH: {
    custody: "4oX9yQW5oW4MEjphzMuUV9gn5VQvjCL1LwkBqrSLscQ9" as Address,
    oracle: "31QzXaaxY3XTfLM6QmSfELLFowQaNe6ytiT3GXpxBcbh" as Address,
    tokenAccount: "FuFoCkfnrDjNmwPr54JEAYTUshXA4gQojevfvv3KXdx7" as Address,
    mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs" as Address,
    decimals: 8,
  },
  JitoSOL: {
    custody: "BA4Au3RCBQyZf3f55RQBsxbaHpE32qLnoGoYJYwkCQPg" as Address,
    oracle: "65cokPf6QQmNpdwurPQu1s1QWPdumMX8iJYjdhALsbGW" as Address,
    tokenAccount: "3ajoGAKxyAiZ6vsPjZky1tLVsa6BAyfYwqpngJB5HmDo" as Address,
    mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn" as Address,
    decimals: 9,
  },
};

// ─── Market Map ──────────────────────────────────────────────────────────────

export interface FlashMarketConfig {
  market: Address;
  targetCustody: Address;
  collateralCustody: Address;
}

/** Key = "targetSymbol-collateralSymbol-side" */
export const FLASH_MARKET_MAP: Record<string, FlashMarketConfig> = {
  "SOL-SOL-long": {
    market: "3vHoXbUvGhEHFsLUmxyC6VWsbYDreb1zMn9TAp5ijN5K" as Address,
    targetCustody: "BjzZ33nMnbXZ7rw3Uy9Uu1W7BDCzzugqkiZoamJHRKF7" as Address,
    collateralCustody:
      "BjzZ33nMnbXZ7rw3Uy9Uu1W7BDCzzugqkiZoamJHRKF7" as Address,
  },
  "SOL-USDC-short": {
    market: "9tvuK63WUV2mgWt7AvWUm7kRUpFKsRX1jewyJ21VTWsM" as Address,
    targetCustody: "BjzZ33nMnbXZ7rw3Uy9Uu1W7BDCzzugqkiZoamJHRKF7" as Address,
    collateralCustody:
      "5N2St2e1BdgWsJiXxfetwWKkHS1BYochAp1ruPFJUfgY" as Address,
  },
  "BTC-BTC-long": {
    market: "GGV4VHTAEyWGyGubXTiQZiPajCEtGv2Ed2G2BHmY3zNZ" as Address,
    targetCustody: "Ghi8YvZeDEzPAGvve7we3Rthquk84CULra6ERkGQF1Rv" as Address,
    collateralCustody:
      "Ghi8YvZeDEzPAGvve7we3Rthquk84CULra6ERkGQF1Rv" as Address,
  },
  "BTC-USDC-short": {
    market: "AAHFmCVd4JXXrLFmGBataeCJ6CwrYs4cYMiebXmBFvPE" as Address,
    targetCustody: "Ghi8YvZeDEzPAGvve7we3Rthquk84CULra6ERkGQF1Rv" as Address,
    collateralCustody:
      "5N2St2e1BdgWsJiXxfetwWKkHS1BYochAp1ruPFJUfgY" as Address,
  },
  "ETH-ETH-long": {
    market: "8r5MBC3oULSWdm69yn2q3gBLp6h1AL4Wo11LBzcCZGWJ" as Address,
    targetCustody: "4oX9yQW5oW4MEjphzMuUV9gn5VQvjCL1LwkBqrSLscQ9" as Address,
    collateralCustody:
      "4oX9yQW5oW4MEjphzMuUV9gn5VQvjCL1LwkBqrSLscQ9" as Address,
  },
  "ETH-USDC-short": {
    market: "GxkxRPheec7f9ZbamzeWdiHiMbrgyoUV7MFPxXW1387q" as Address,
    targetCustody: "4oX9yQW5oW4MEjphzMuUV9gn5VQvjCL1LwkBqrSLscQ9" as Address,
    collateralCustody:
      "5N2St2e1BdgWsJiXxfetwWKkHS1BYochAp1ruPFJUfgY" as Address,
  },
  "SOL-JitoSOL-long": {
    market: "61Y5pCSk3PWrKgvSibcLmXUaNEUADB2mY1hZbqHvEQ5E" as Address,
    targetCustody: "BjzZ33nMnbXZ7rw3Uy9Uu1W7BDCzzugqkiZoamJHRKF7" as Address,
    collateralCustody:
      "BA4Au3RCBQyZf3f55RQBsxbaHpE32qLnoGoYJYwkCQPg" as Address,
  },
  "JitoSOL-JitoSOL-long": {
    market: "EZHFxNxNwsPgZijdQ7st1kf8iUBEymN3EqCwUJVF6Jze" as Address,
    targetCustody: "BA4Au3RCBQyZf3f55RQBsxbaHpE32qLnoGoYJYwkCQPg" as Address,
    collateralCustody:
      "BA4Au3RCBQyZf3f55RQBsxbaHpE32qLnoGoYJYwkCQPg" as Address,
  },
  "JitoSOL-USDC-short": {
    market: "39eUVsjGzDBQPYALoE1F49FvSKHaYvZghkSBfNzXj28u" as Address,
    targetCustody: "BA4Au3RCBQyZf3f55RQBsxbaHpE32qLnoGoYJYwkCQPg" as Address,
    collateralCustody:
      "5N2St2e1BdgWsJiXxfetwWKkHS1BYochAp1ruPFJUfgY" as Address,
  },
};

// ─── Account Resolution ──────────────────────────────────────────────────────

export interface ResolvedFlashAccounts {
  perpetuals: Address;
  pool: Address;
  transferAuthority: Address;
  eventAuthority: Address;
  ixSysvar: Address;
  targetCustody: FlashCustodyConfig;
  collateralCustody: FlashCustodyConfig;
  market: FlashMarketConfig;
}

/**
 * Resolve all Flash Trade accounts needed for a position action.
 *
 * @param targetSymbol - e.g. "SOL", "BTC", "ETH"
 * @param collateralSymbol - e.g. "SOL", "USDC"
 * @param side - "long" or "short"
 */
export function resolveFlashAccounts(
  targetSymbol: string,
  collateralSymbol: string,
  side: "long" | "short",
): ResolvedFlashAccounts {
  const targetCustody = FLASH_CUSTODY_MAP[targetSymbol];
  if (!targetCustody) {
    throw new Error(
      `Unknown Flash Trade target symbol: ${targetSymbol}. Available: ${Object.keys(FLASH_CUSTODY_MAP).join(", ")}`,
    );
  }

  const collateralCustody = FLASH_CUSTODY_MAP[collateralSymbol];
  if (!collateralCustody) {
    throw new Error(
      `Unknown Flash Trade collateral symbol: ${collateralSymbol}. Available: ${Object.keys(FLASH_CUSTODY_MAP).join(", ")}`,
    );
  }

  const marketKey = `${targetSymbol}-${collateralSymbol}-${side}`;
  const market = FLASH_MARKET_MAP[marketKey];
  if (!market) {
    throw new Error(
      `Unknown Flash Trade market: ${marketKey}. Available: ${Object.keys(FLASH_MARKET_MAP).join(", ")}`,
    );
  }

  return {
    perpetuals: FLASH_PERPETUALS,
    pool: FLASH_POOL,
    transferAuthority: FLASH_TRANSFER_AUTHORITY,
    eventAuthority: FLASH_EVENT_AUTHORITY,
    ixSysvar: IX_SYSVAR,
    targetCustody,
    collateralCustody,
    market,
  };
}
