/**
 * Network-aware Address Lookup Table (ALT) configuration for Phalnx.
 *
 * Phalnx ALTs store non-program accounts shared across composed transactions:
 * USDC/USDT mints, protocol treasury, Instructions sysvar, Clock sysvar.
 * Program IDs are NOT stored (zero savings per Solana spec).
 */

import type { Address } from "@solana/kit";
import type { Network } from "./types.js";
import {
  USDC_MINT_DEVNET,
  USDC_MINT_MAINNET,
  USDT_MINT_DEVNET,
  USDT_MINT_MAINNET,
  PROTOCOL_TREASURY,
} from "./types.js";

// ─── Phalnx ALT Addresses ────────────────────────────────────────────────────

/** Devnet Phalnx ALT — placeholder until deployed */
export const PHALNX_ALT_DEVNET = "11111111111111111111111111111111" as Address;

/** Mainnet Phalnx ALT — placeholder until deployed */
export const PHALNX_ALT_MAINNET = "11111111111111111111111111111111" as Address;

/** Well-known sysvar addresses stored in the Phalnx ALT */
const INSTRUCTIONS_SYSVAR =
  "Sysvar1nstructions1111111111111111111111111" as Address;
const CLOCK_SYSVAR = "SysvarC1ock11111111111111111111111111111111" as Address;

/**
 * Get the Phalnx ALT address for a given network.
 */
export function getPhalnxAltAddress(network: Network): Address {
  return network === "devnet" ? PHALNX_ALT_DEVNET : PHALNX_ALT_MAINNET;
}

// ─── Verification Lists (S-5) ────────────────────────────────────────────────

/**
 * Expected contents of the devnet Phalnx ALT.
 * Used to verify ALT integrity after RPC fetch.
 */
export const EXPECTED_ALT_CONTENTS_DEVNET: Address[] = [
  USDC_MINT_DEVNET,
  USDT_MINT_DEVNET,
  PROTOCOL_TREASURY,
  INSTRUCTIONS_SYSVAR,
  CLOCK_SYSVAR,
];

/**
 * Expected contents of the mainnet Phalnx ALT.
 * Uses mainnet mints; treasury is the same across networks.
 */
export const EXPECTED_ALT_CONTENTS_MAINNET: Address[] = [
  USDC_MINT_MAINNET,
  USDT_MINT_MAINNET,
  PROTOCOL_TREASURY,
  INSTRUCTIONS_SYSVAR,
  CLOCK_SYSVAR,
];
