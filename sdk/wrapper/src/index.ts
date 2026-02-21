/**
 * @deprecated Use @agent-shield/sdk instead. This package is a compatibility
 * shim that re-exports from @agent-shield/sdk.
 *
 * Migration:
 *   - import { withVault, harden } from '@agent-shield/sdk'
 *   - import { shieldWallet } from '@agent-shield/sdk' (replaces shield())
 */

// Re-export everything from @agent-shield/sdk's wrapper module
export {
  harden,
  withVault,
  shieldWallet as shield,
  shieldWallet,
  mapPoliciesToVaultParams,
  findNextVaultId,
  isTeeWallet,
  parseSpendLimit,
  resolvePolicies,
  DEFAULT_POLICIES,
  ShieldDeniedError,
  ShieldConfigError,
  TeeRequiredError,
  analyzeTransaction,
  getNonSystemProgramIds,
  resolveTransactionAddressLookupTables,
  extractInstructions,
  KNOWN_PROTOCOLS,
  KNOWN_TOKENS,
  SYSTEM_PROGRAMS,
  getTokenInfo,
  getProtocolName,
  isSystemProgram,
  isKnownProtocol,
  ShieldState,
  evaluatePolicy,
  enforcePolicy,
  recordTransaction,
} from "@agent-shield/sdk";

export type {
  HardenOptions,
  HardenResult,
  ShieldedWallet,
  WalletLike,
  ShieldOptions,
  TeeWallet,
  ShieldPolicies,
  SpendLimit,
  SpendingSummary,
  RateLimitConfig,
  PolicyCheckResult,
  TransactionAnalysis,
  TokenTransfer,
  ResolvedPolicies,
  PolicyViolation,
  ShieldStorage,
  TxEntry,
} from "@agent-shield/sdk";

export type { ClientSpendEntry as SpendEntry } from "@agent-shield/sdk";
