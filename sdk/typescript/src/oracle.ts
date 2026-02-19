import { PublicKey, Connection } from "@solana/web3.js";
import type { OracleSource } from "./types";

/** Pyth Receiver program ID (same mainnet/devnet) */
export const PYTH_RECEIVER_PROGRAM = new PublicKey(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ",
);

/** Switchboard On-Demand program ID (same mainnet/devnet) */
export const SWITCHBOARD_ON_DEMAND_PROGRAM = new PublicKey(
  "SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv",
);

/**
 * Well-known Pyth price feed accounts for common Solana tokens.
 * These are mainnet push-update PriceUpdateV2 accounts.
 * Key = token mint address (Base58), Value = Pyth feed account.
 */
export const PYTH_FEEDS: Record<string, PublicKey> = {
  // SOL/USD
  So11111111111111111111111111111111111111112: new PublicKey(
    "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
  ),
  // BTC (Wrapped) / USD
  "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E": new PublicKey(
    "4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo",
  ),
  // ETH (Wrapped) / USD
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": new PublicKey(
    "42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC",
  ),
};

/**
 * Well-known Switchboard feed accounts for tokens Pyth doesn't cover.
 * Key = token mint address (Base58), Value = Switchboard PullFeed account.
 */
export const SWITCHBOARD_FEEDS: Record<string, PublicKey> = {};

/**
 * Resolve oracle feed for a token mint. Pyth-first, Switchboard fallback.
 * Returns the feed account address and source, or null for stablecoins/unknown tokens.
 */
export function resolveOracleFeed(
  mint: PublicKey,
): { feed: PublicKey; source: OracleSource } | null {
  const mintStr = mint.toBase58();
  if (PYTH_FEEDS[mintStr]) {
    return { feed: PYTH_FEEDS[mintStr], source: "pyth" };
  }
  if (SWITCHBOARD_FEEDS[mintStr]) {
    return { feed: SWITCHBOARD_FEEDS[mintStr], source: "switchboard" };
  }
  return null;
}

/**
 * Detect oracle source by checking account owner on-chain.
 * Useful when you have a feed address but don't know the oracle type.
 */
export async function detectOracleSource(
  connection: Connection,
  feedAccount: PublicKey,
): Promise<OracleSource | "unknown"> {
  const info = await connection.getAccountInfo(feedAccount);
  if (!info) return "unknown";
  if (info.owner.equals(PYTH_RECEIVER_PROGRAM)) return "pyth";
  if (info.owner.equals(SWITCHBOARD_ON_DEMAND_PROGRAM)) return "switchboard";
  return "unknown";
}
