// @agentshield/sdk — TypeScript SDK for AgentShield
// AI Agent Financial Middleware on Solana

export { AgentShieldClient } from "./client";
export { IDL } from "./idl-json";

export {
  getVaultPDA,
  getPolicyPDA,
  getTrackerPDA,
  getSessionPDA,
  getPendingPolicyPDA,
  fetchVault,
  fetchPolicy,
  fetchTracker,
  fetchSession,
  fetchVaultByAddress,
  fetchPolicyByAddress,
  fetchTrackerByAddress,
  fetchPendingPolicy,
} from "./accounts";

export {
  buildInitializeVault,
  buildDepositFunds,
  buildRegisterAgent,
  buildUpdatePolicy,
  buildValidateAndAuthorize,
  buildFinalizeSession,
  buildRevokeAgent,
  buildReactivateVault,
  buildWithdrawFunds,
  buildCloseVault,
  buildQueuePolicyUpdate,
  buildApplyPendingPolicy,
  buildCancelPendingPolicy,
  buildAgentTransfer,
} from "./instructions";

export {
  composePermittedAction,
  composePermittedTransaction,
  composePermittedSwap,
} from "./composer";

export { rewriteVaultAuthority, validateRewrite } from "./rewriter";

export {
  wrapTransaction,
  wrapInstructions,
  classifyToken,
  findAllowedToken,
  type WrapTransactionParams,
} from "./wrap";

export {
  PYTH_RECEIVER_PROGRAM,
  SWITCHBOARD_ON_DEMAND_PROGRAM,
  PYTH_FEEDS,
  SWITCHBOARD_FEEDS,
  resolveOracleFeed,
  detectOracleSource,
} from "./oracle";

export {
  AGENT_SHIELD_PROGRAM_ID,
  UNPRICED_SENTINEL,
  USD_DECIMALS,
  type AgentShield,
  type AgentVaultAccount,
  type PolicyConfigAccount,
  type SpendTrackerAccount,
  type SessionAuthorityAccount,
  type AllowedToken,
  type TokenClassification,
  type SpendEntry,
  type TransactionRecord,
  type VaultStatus,
  type ActionType,
  type PendingPolicyUpdateAccount,
  type InitializeVaultParams,
  type UpdatePolicyParams,
  type QueuePolicyUpdateParams,
  type AgentTransferParams,
  type AuthorizeParams,
  type OracleSource,
  type ComposeActionParams,
} from "./types";

export {
  JUPITER_V6_API,
  JUPITER_PROGRAM_ID,
  JupiterApiError,
  deserializeInstruction,
  fetchJupiterQuote,
  fetchJupiterSwapInstructions,
  fetchAddressLookupTables,
  composeJupiterSwap,
  composeJupiterSwapTransaction,
  type JupiterQuoteParams,
  type JupiterQuoteResponse,
  type JupiterSwapInstructionsResponse,
  type JupiterSwapParams,
  type JupiterSerializedInstruction,
  type JupiterRoutePlanStep,
} from "./integrations/jupiter";

export {
  FLASH_TRADE_PROGRAM_ID,
  FLASH_COMPOSABILITY_PROGRAM_ID,
  FLASH_FB_NFT_REWARD_PROGRAM_ID,
  FLASH_REWARD_DISTRIBUTION_PROGRAM_ID,
  Side,
  Privilege,
  createFlashTradeClient,
  getPoolConfig,
  composeFlashTradeOpen,
  composeFlashTradeClose,
  composeFlashTradeIncrease,
  composeFlashTradeDecrease,
  composeFlashTradeTransaction,
  type FlashTradeConfig,
  type ContractOraclePrice,
  type FlashOpenPositionParams,
  type FlashClosePositionParams,
  type FlashIncreasePositionParams,
  type FlashDecreasePositionParams,
  type FlashTradeResult,
} from "./integrations/flash-trade";
