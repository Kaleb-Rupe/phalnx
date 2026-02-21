import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import type { AgentShield } from "./idl";

export type { AgentShield };

export const AGENT_SHIELD_PROGRAM_ID = new PublicKey(
  "4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL",
);

// Fee constants matching on-chain values
export const FEE_RATE_DENOMINATOR = 1_000_000;
export const PROTOCOL_FEE_RATE = 200; // 2 BPS
export const MAX_DEVELOPER_FEE_RATE = 500; // 5 BPS
export const PROTOCOL_TREASURY = new PublicKey(
  "ASHie1dFTnDSnrHMPGmniJhMgfJVGPm3rAaEPnrtWDiT",
);

// USD decimals (6) — $500 = 500_000_000
export const USD_DECIMALS = 6;

// Sentinel for unpriced (receive-only) tokens — all 0xFF bytes
export const UNPRICED_SENTINEL = new PublicKey(new Uint8Array(32).fill(0xff));

/** Tracker capacity tier — determines max rolling spend entries */
export enum TrackerTier {
  /** 200 entries (~16 KB, ~0.11 SOL rent) */
  Standard = 0,
  /** 500 entries (~33 KB, ~0.23 SOL rent) */
  Pro = 1,
  /** 1000 entries (~61 KB, ~0.42 SOL rent) */
  Max = 2,
}

/** Oracle source types */
export type OracleSource = "pyth" | "switchboard";

/** Per-token configuration stored in PolicyConfig */
export interface AllowedToken {
  /** Token mint address */
  mint: PublicKey;
  /** Oracle feed account (Pyth PriceUpdateV2 or Switchboard PullFeed).
   *  Pubkey.default = stablecoin (1:1 USD).
   *  UNPRICED_SENTINEL = unpriced (receive-only). */
  oracleFeed: PublicKey;
  /** Token decimals (e.g., 6 for USDC, 9 for SOL) */
  decimals: number;
  /** Per-token daily cap in base units (0 = no per-token limit) */
  dailyCapBase: BN;
  /** Per-token max single tx in base units (0 = no per-token limit) */
  maxTxBase: BN;
}

/** Token classification for oracle routing */
export type TokenClassification = "stablecoin" | "oracle-priced" | "unpriced";

// Re-export IDL types for convenience
export type AgentVaultAccount = {
  owner: PublicKey;
  agent: PublicKey;
  feeDestination: PublicKey;
  vaultId: BN;
  status: VaultStatus;
  bump: number;
  createdAt: BN;
  totalTransactions: BN;
  totalVolume: BN;
  openPositions: number;
  totalFeesCollected: BN;
  trackerTier:
    | { standard: Record<string, never> }
    | { pro: Record<string, never> }
    | { max: Record<string, never> };
};

export type PolicyConfigAccount = {
  vault: PublicKey;
  dailySpendingCapUsd: BN;
  maxTransactionSizeUsd: BN;
  allowedTokens: AllowedToken[];
  allowedProtocols: PublicKey[];
  maxLeverageBps: number;
  canOpenPositions: boolean;
  maxConcurrentPositions: number;
  developerFeeRate: number;
  timelockDuration: BN;
  allowedDestinations: PublicKey[];
  bump: number;
};

export type PendingPolicyUpdateAccount = {
  vault: PublicKey;
  queuedAt: BN;
  executesAt: BN;
  dailySpendingCapUsd: BN | null;
  maxTransactionAmountUsd: BN | null;
  allowedTokens: AllowedToken[] | null;
  allowedProtocols: PublicKey[] | null;
  maxLeverageBps: number | null;
  canOpenPositions: boolean | null;
  maxConcurrentPositions: number | null;
  developerFeeRate: number | null;
  timelockDuration: BN | null;
  allowedDestinations: PublicKey[] | null;
  bump: number;
};

export type SpendTrackerAccount = {
  vault: PublicKey;
  trackerTier:
    | { standard: Record<string, never> }
    | { pro: Record<string, never> }
    | { max: Record<string, never> };
  maxSpendEntries: number;
  rollingSpends: SpendEntry[];
  recentTransactions: TransactionRecord[];
  bump: number;
};

export type SpendEntry = {
  tokenIndex: number;
  usdAmount: BN;
  baseAmount: BN;
  timestamp: BN;
};

export type TransactionRecord = {
  timestamp: BN;
  actionType: ActionType;
  tokenMint: PublicKey;
  amount: BN;
  protocol: PublicKey;
  success: boolean;
  slot: BN;
};

export type SessionAuthorityAccount = {
  vault: PublicKey;
  agent: PublicKey;
  authorized: boolean;
  authorizedAmount: BN;
  authorizedToken: PublicKey;
  authorizedProtocol: PublicKey;
  actionType: ActionType;
  expiresAtSlot: BN;
  delegated: boolean;
  delegationTokenAccount: PublicKey;
  bump: number;
};

// Enum types matching the on-chain representation
export type VaultStatus =
  | { active: Record<string, never> }
  | { frozen: Record<string, never> }
  | { closed: Record<string, never> };

export type ActionType =
  | { swap: Record<string, never> }
  | { openPosition: Record<string, never> }
  | { closePosition: Record<string, never> }
  | { increasePosition: Record<string, never> }
  | { decreasePosition: Record<string, never> }
  | { deposit: Record<string, never> }
  | { withdraw: Record<string, never> }
  | { transfer: Record<string, never> };

// SDK param types for instruction builders
export interface InitializeVaultParams {
  vaultId: BN;
  dailySpendingCapUsd: BN;
  maxTransactionSizeUsd: BN;
  allowedTokens: AllowedToken[];
  allowedProtocols: PublicKey[];
  maxLeverageBps: number;
  maxConcurrentPositions: number;
  feeDestination: PublicKey;
  developerFeeRate?: number;
  timelockDuration?: BN;
  allowedDestinations?: PublicKey[];
  /** Tracker capacity tier (default: Standard = 0) */
  trackerTier?: TrackerTier;
}

export interface UpdatePolicyParams {
  dailySpendingCapUsd?: BN | null;
  maxTransactionSizeUsd?: BN | null;
  allowedTokens?: AllowedToken[] | null;
  allowedProtocols?: PublicKey[] | null;
  maxLeverageBps?: number | null;
  canOpenPositions?: boolean | null;
  maxConcurrentPositions?: number | null;
  developerFeeRate?: number | null;
  timelockDuration?: BN | null;
  allowedDestinations?: PublicKey[] | null;
}

export interface QueuePolicyUpdateParams {
  dailySpendingCapUsd?: BN | null;
  maxTransactionAmountUsd?: BN | null;
  allowedTokens?: AllowedToken[] | null;
  allowedProtocols?: PublicKey[] | null;
  maxLeverageBps?: number | null;
  canOpenPositions?: boolean | null;
  maxConcurrentPositions?: number | null;
  developerFeeRate?: number | null;
  timelockDuration?: BN | null;
  allowedDestinations?: PublicKey[] | null;
}

export interface AgentTransferParams {
  amount: BN;
  vaultTokenAccount: PublicKey;
  destinationTokenAccount: PublicKey;
  feeDestinationTokenAccount?: PublicKey | null;
  protocolTreasuryTokenAccount?: PublicKey | null;
  oracleFeedAccount?: PublicKey;
}

export interface AuthorizeParams {
  actionType: ActionType;
  tokenMint: PublicKey;
  amount: BN;
  targetProtocol: PublicKey;
  leverageBps?: number | null;
}

export interface ComposeActionParams {
  vault: PublicKey;
  owner: PublicKey;
  vaultId: BN;
  agent: PublicKey;
  actionType: ActionType;
  tokenMint: PublicKey;
  amount: BN;
  targetProtocol: PublicKey;
  leverageBps?: number | null;
  /** The DeFi instruction(s) to sandwich between validate and finalize */
  defiInstructions: import("@solana/web3.js").TransactionInstruction[];
  /** Whether the finalize step should report success (default: true) */
  success?: boolean;
  /** Vault's PDA-owned token account for the spend token (required for delegation) */
  vaultTokenAccount: PublicKey;
  /** Optional: fee destination token account */
  feeDestinationTokenAccount?: PublicKey | null;
  /** Optional: protocol treasury token account for protocol fee */
  protocolTreasuryTokenAccount?: PublicKey | null;
  /** Oracle feed account for oracle-priced tokens (Pyth or Switchboard) */
  oracleFeedAccount?: PublicKey;
}
