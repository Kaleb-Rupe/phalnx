import {
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
  Connection,
  Signer,
} from "@solana/web3.js";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PerpetualsClient, PoolConfig, Side, Privilege } from "flash-sdk";
import type { AgentShield, ComposeActionParams, ActionType } from "../types";
import { getVaultPDA } from "../accounts";
import { composePermittedAction } from "../composer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FLASH_TRADE_PROGRAM_ID = new PublicKey(
  "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu",
);

export const FLASH_COMPOSABILITY_PROGRAM_ID = new PublicKey(
  "FLCPaG22cpZBSdbmk6kBhHsGDfkJGHsSRhgSt9kPV7sG",
);

export const FLASH_FB_NFT_REWARD_PROGRAM_ID = new PublicKey(
  "FBnftwLhsQJPHkGEjVVgPXnxFjTsePDqQnmzixiJbsAV",
);

export const FLASH_REWARD_DISTRIBUTION_PROGRAM_ID = new PublicKey(
  "FLRDaTyVhUFJwdwtBjCKMDGNbMFrHm5GVXE1aVjMCaH1",
);

// Re-export flash-sdk types for consumers
export { Side, Privilege } from "flash-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlashTradeConfig {
  /** Pool name, e.g. "Crypto.1" */
  poolName: string;
  /** Cluster for PoolConfig lookup */
  cluster: "mainnet-beta" | "devnet";
}

export interface ContractOraclePrice {
  price: BN;
  exponent: number;
}

export interface FlashOpenPositionParams {
  owner: PublicKey;
  vaultId: BN;
  agent: PublicKey;
  targetSymbol: string;
  collateralSymbol: string;
  collateralAmount: BN;
  sizeAmount: BN;
  side: { long: Record<string, never> } | { short: Record<string, never> };
  priceWithSlippage: ContractOraclePrice;
  leverageBps: number;
  vaultTokenAccount?: PublicKey | null;
  feeDestinationTokenAccount?: PublicKey | null;
}

export interface FlashClosePositionParams {
  owner: PublicKey;
  vaultId: BN;
  agent: PublicKey;
  targetSymbol: string;
  collateralSymbol: string;
  collateralAmount: BN;
  side: { long: Record<string, never> } | { short: Record<string, never> };
  priceWithSlippage: ContractOraclePrice;
  vaultTokenAccount?: PublicKey | null;
  feeDestinationTokenAccount?: PublicKey | null;
}

export interface FlashIncreasePositionParams {
  owner: PublicKey;
  vaultId: BN;
  agent: PublicKey;
  targetSymbol: string;
  collateralSymbol: string;
  positionPubKey: PublicKey;
  side: { long: Record<string, never> } | { short: Record<string, never> };
  priceWithSlippage: ContractOraclePrice;
  sizeDelta: BN;
  collateralAmount: BN;
  leverageBps: number;
  vaultTokenAccount?: PublicKey | null;
  feeDestinationTokenAccount?: PublicKey | null;
}

export interface FlashDecreasePositionParams {
  owner: PublicKey;
  vaultId: BN;
  agent: PublicKey;
  targetSymbol: string;
  collateralSymbol: string;
  positionPubKey: PublicKey;
  side: { long: Record<string, never> } | { short: Record<string, never> };
  priceWithSlippage: ContractOraclePrice;
  sizeDelta: BN;
  collateralAmount: BN;
  vaultTokenAccount?: PublicKey | null;
  feeDestinationTokenAccount?: PublicKey | null;
}

export interface FlashTradeResult {
  instructions: TransactionInstruction[];
  additionalSigners: Signer[];
}

// ---------------------------------------------------------------------------
// Client Factory
// ---------------------------------------------------------------------------

/**
 * Create a PerpetualsClient from flash-sdk configured for a specific pool.
 *
 * The `provider` should use the vault PDA as the wallet (since the vault
 * owns the token accounts and positions in instruction composition mode).
 */
export function createFlashTradeClient(
  provider: AnchorProvider,
  config?: Partial<FlashTradeConfig>,
): PerpetualsClient {
  return new PerpetualsClient(
    provider,
    FLASH_TRADE_PROGRAM_ID,
    FLASH_COMPOSABILITY_PROGRAM_ID,
    FLASH_FB_NFT_REWARD_PROGRAM_ID,
    FLASH_REWARD_DISTRIBUTION_PROGRAM_ID,
    {},
    false,
  );
}

/**
 * Load pool config for a given pool name and cluster.
 */
export function getPoolConfig(
  poolName: string,
  cluster: "mainnet-beta" | "devnet" = "mainnet-beta",
): PoolConfig {
  return PoolConfig.fromIdsByName(poolName, cluster);
}

// ---------------------------------------------------------------------------
// Composition Functions
// ---------------------------------------------------------------------------

/**
 * Compose a Flash Trade open position through AgentShield.
 *
 * Returns: [ComputeBudget, ValidateAndAuthorize, ...flashIxs, FinalizeSession]
 */
export async function composeFlashTradeOpen(
  program: Program<AgentShield>,
  perpClient: PerpetualsClient,
  poolConfig: PoolConfig,
  params: FlashOpenPositionParams,
): Promise<FlashTradeResult> {
  const [vault] = getVaultPDA(params.owner, params.vaultId, program.programId);

  // Get raw Flash Trade instructions
  const { instructions: flashIxs, additionalSigners } =
    await perpClient.openPosition(
      params.targetSymbol,
      params.collateralSymbol,
      params.priceWithSlippage,
      params.collateralAmount,
      params.sizeAmount,
      params.side as any,
      poolConfig,
      Privilege.None,
      undefined, // tokenStakeAccount
      undefined, // userReferralAccount
      true, // skipBalanceChecks
    );

  // Get collateral token mint from pool config
  const collateralToken = poolConfig.getTokenFromSymbol(
    params.collateralSymbol,
  );
  const tokenMint = collateralToken.mintKey;

  const vaultTokenAccount =
    params.vaultTokenAccount ??
    getAssociatedTokenAddressSync(tokenMint, vault, true);

  const composeParams: ComposeActionParams = {
    vault,
    owner: params.owner,
    vaultId: params.vaultId,
    agent: params.agent,
    actionType: { openPosition: {} },
    tokenMint,
    amount: params.collateralAmount,
    targetProtocol: FLASH_TRADE_PROGRAM_ID,
    leverageBps: params.leverageBps,
    defiInstructions: flashIxs,
    success: true,
    vaultTokenAccount,
    feeDestinationTokenAccount: params.feeDestinationTokenAccount,
  };

  const instructions = await composePermittedAction(program, composeParams);
  return { instructions, additionalSigners };
}

/**
 * Compose a Flash Trade close position through AgentShield.
 */
export async function composeFlashTradeClose(
  program: Program<AgentShield>,
  perpClient: PerpetualsClient,
  poolConfig: PoolConfig,
  params: FlashClosePositionParams,
): Promise<FlashTradeResult> {
  const [vault] = getVaultPDA(params.owner, params.vaultId, program.programId);

  const { instructions: flashIxs, additionalSigners } =
    await perpClient.closePosition(
      params.targetSymbol,
      params.collateralSymbol,
      params.priceWithSlippage,
      params.side as any,
      poolConfig,
      Privilege.None,
    );

  const collateralToken = poolConfig.getTokenFromSymbol(
    params.collateralSymbol,
  );
  const tokenMint = collateralToken.mintKey;

  const vaultTokenAccount =
    params.vaultTokenAccount ??
    getAssociatedTokenAddressSync(tokenMint, vault, true);

  const composeParams: ComposeActionParams = {
    vault,
    owner: params.owner,
    vaultId: params.vaultId,
    agent: params.agent,
    actionType: { closePosition: {} },
    tokenMint,
    amount: params.collateralAmount,
    targetProtocol: FLASH_TRADE_PROGRAM_ID,
    defiInstructions: flashIxs,
    success: true,
    vaultTokenAccount,
    feeDestinationTokenAccount: params.feeDestinationTokenAccount,
  };

  const instructions = await composePermittedAction(program, composeParams);
  return { instructions, additionalSigners };
}

/**
 * Compose a Flash Trade increase position through AgentShield.
 */
export async function composeFlashTradeIncrease(
  program: Program<AgentShield>,
  perpClient: PerpetualsClient,
  poolConfig: PoolConfig,
  params: FlashIncreasePositionParams,
): Promise<FlashTradeResult> {
  const [vault] = getVaultPDA(params.owner, params.vaultId, program.programId);

  const { instructions: flashIxs, additionalSigners } =
    await perpClient.increaseSize(
      params.targetSymbol,
      params.collateralSymbol,
      params.positionPubKey,
      params.side as any,
      poolConfig,
      params.priceWithSlippage,
      params.sizeDelta,
      Privilege.None,
    );

  const collateralToken = poolConfig.getTokenFromSymbol(
    params.collateralSymbol,
  );
  const tokenMint = collateralToken.mintKey;

  const vaultTokenAccount =
    params.vaultTokenAccount ??
    getAssociatedTokenAddressSync(tokenMint, vault, true);

  const composeParams: ComposeActionParams = {
    vault,
    owner: params.owner,
    vaultId: params.vaultId,
    agent: params.agent,
    actionType: { increasePosition: {} },
    tokenMint,
    amount: params.collateralAmount,
    targetProtocol: FLASH_TRADE_PROGRAM_ID,
    leverageBps: params.leverageBps,
    defiInstructions: flashIxs,
    success: true,
    vaultTokenAccount,
    feeDestinationTokenAccount: params.feeDestinationTokenAccount,
  };

  const instructions = await composePermittedAction(program, composeParams);
  return { instructions, additionalSigners };
}

/**
 * Compose a Flash Trade decrease position through AgentShield.
 */
export async function composeFlashTradeDecrease(
  program: Program<AgentShield>,
  perpClient: PerpetualsClient,
  poolConfig: PoolConfig,
  params: FlashDecreasePositionParams,
): Promise<FlashTradeResult> {
  const [vault] = getVaultPDA(params.owner, params.vaultId, program.programId);

  const { instructions: flashIxs, additionalSigners } =
    await perpClient.decreaseSize(
      params.targetSymbol,
      params.collateralSymbol,
      params.side as any,
      params.positionPubKey,
      poolConfig,
      params.priceWithSlippage,
      params.sizeDelta,
      Privilege.None,
    );

  const collateralToken = poolConfig.getTokenFromSymbol(
    params.collateralSymbol,
  );
  const tokenMint = collateralToken.mintKey;

  const vaultTokenAccount =
    params.vaultTokenAccount ??
    getAssociatedTokenAddressSync(tokenMint, vault, true);

  const composeParams: ComposeActionParams = {
    vault,
    owner: params.owner,
    vaultId: params.vaultId,
    agent: params.agent,
    actionType: { decreasePosition: {} },
    tokenMint,
    amount: params.collateralAmount,
    targetProtocol: FLASH_TRADE_PROGRAM_ID,
    defiInstructions: flashIxs,
    success: true,
    vaultTokenAccount,
    feeDestinationTokenAccount: params.feeDestinationTokenAccount,
  };

  const instructions = await composePermittedAction(program, composeParams);
  return { instructions, additionalSigners };
}

/**
 * Build a complete VersionedTransaction for a Flash Trade operation.
 * The transaction is NOT signed — caller must sign with the agent keypair
 * and any additionalSigners.
 */
export async function composeFlashTradeTransaction(
  connection: Connection,
  payer: PublicKey,
  result: FlashTradeResult,
): Promise<VersionedTransaction> {
  const { blockhash } = await connection.getLatestBlockhash();

  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: result.instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
}
