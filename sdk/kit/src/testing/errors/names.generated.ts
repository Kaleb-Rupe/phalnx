/**
 * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Regenerate with: `pnpm --filter @usesigil/kit run gen:error-types`
 * Source of truth: target/idl/sigil.json (errors[])
 * Verified in CI by: scripts/verify-error-drift.ts
 *
 * This file is the compile-time coupling between:
 *   - Rust `#[error_code]` enum in programs/sigil/src/errors.rs
 *   - Anchor-generated IDL in target/idl/sigil.json
 *   - TypeScript assertion helpers in ./expect.ts
 *
 * If any of the three drift, CI fails.
 */

// ────────────────────────────────────────────────────────────────
// Sigil program errors (6000-6087)
// ────────────────────────────────────────────────────────────────

export const SIGIL_ERRORS = {
  VaultNotActive: 6000,
  UnauthorizedAgent: 6001,
  UnauthorizedOwner: 6002,
  UnsupportedToken: 6003,
  ProtocolNotAllowed: 6004,
  TransactionTooLarge: 6005,
  SpendingCapExceeded: 6006,
  SessionNotAuthorized: 6007,
  InvalidSession: 6008,
  TooManyAllowedProtocols: 6009,
  AgentAlreadyRegistered: 6010,
  NoAgentRegistered: 6011,
  VaultNotFrozen: 6012,
  VaultAlreadyClosed: 6013,
  InsufficientBalance: 6014,
  DeveloperFeeTooHigh: 6015,
  InvalidFeeDestination: 6016,
  InvalidProtocolTreasury: 6017,
  InvalidAgentKey: 6018,
  AgentIsOwner: 6019,
  Overflow: 6020,
  InvalidTokenAccount: 6021,
  TimelockNotExpired: 6022,
  NoTimelockConfigured: 6023,
  DestinationNotAllowed: 6024,
  TooManyDestinations: 6025,
  InvalidProtocolMode: 6026,
  CpiCallNotAllowed: 6027,
  MissingFinalizeInstruction: 6028,
  NonTrackedSwapMustReturnStablecoin: 6029,
  SwapSlippageExceeded: 6030,
  InvalidJupiterInstruction: 6031,
  UnauthorizedTokenTransfer: 6032,
  SlippageBpsTooHigh: 6033,
  ProtocolMismatch: 6034,
  TooManyDeFiInstructions: 6035,
  MaxAgentsReached: 6036,
  InsufficientPermissions: 6037,
  InvalidPermissions: 6038,
  // Escrow errors (formerly 6039-6044) and ActiveEscrowsExist (formerly 6057)
  // REMOVED in v2 revamp Stage 1; downstream codes renumbered.
  InvalidConstraintConfig: 6039,
  ConstraintViolated: 6040,
  InvalidConstraintsPda: 6041,
  InvalidPendingConstraintsPda: 6042,
  AgentSpendLimitExceeded: 6043,
  OverlaySlotExhausted: 6044,
  AgentSlotNotFound: 6045,
  UnauthorizedTokenApproval: 6046,
  InvalidSessionExpiry: 6047,
  UnconstrainedProgramBlocked: 6048,
  ProtocolCapExceeded: 6049,
  ProtocolCapsMismatch: 6050,
  ConstraintsNotClosed: 6051,
  PendingPolicyExists: 6052,
  AgentPaused: 6053,
  AgentAlreadyPaused: 6054,
  AgentNotPaused: 6055,
  UnauthorizedPostFinalizeInstruction: 6056,
  UnexpectedBalanceDecrease: 6057,
  TimelockTooShort: 6058,
  PolicyVersionMismatch: 6059,
  ActiveSessionsExist: 6060,
  PostAssertionFailed: 6061,
  InvalidPostAssertionIndex: 6062,
  UnauthorizedPreValidateInstruction: 6063,
  SnapshotNotCaptured: 6064,
  InvalidConstraintOperator: 6065,
  ConstraintsVaultMismatch: 6066,
  BlockedSplOpcode: 6067,
  QueuedUpdateExpired: 6068,
  AccountWritabilityMismatch: 6069,
  SysvarScanBoundExceeded: 6070,
  AsyncFulfillmentNotPermitted: 6071,
  ConstraintsAlreadyPopulated: 6072,
  OrphanPdaWrongOwner: 6073,
  OrphanPdaPopulated: 6074,
  ConfidentialTransferBlocked: 6075,
  PermanentDelegateBlocked: 6076,
  TransferHookBlocked: 6077,
  LamportDrainBlocked: 6078,
  BatchInstructionBlocked: 6079,
  InvalidDestinationMode: 6080,
} as const;

/**
 * Union of valid Sigil error names.
 *
 * A typo on the author's side (`expectSigilError(err, { name: 'UnuthorizedAgent' })`)
 * fails tsc. This is the compile-time safety net.
 */
export type SigilErrorName = keyof typeof SIGIL_ERRORS;

/**
 * Union of valid Sigil error codes.
 */
export type SigilErrorCode = (typeof SIGIL_ERRORS)[SigilErrorName];

/**
 * Conditional type: given a name, produce its code.
 * Used to couple `{name, code}` at the type level.
 */
export type SigilErrorCodeFor<N extends SigilErrorName> =
  (typeof SIGIL_ERRORS)[N];

// ────────────────────────────────────────────────────────────────
// Anchor framework errors (2000-5999, commonly-asserted subset)
// Source: https://github.com/coral-xyz/anchor/blob/v0.32.1/lang/src/error.rs
// ────────────────────────────────────────────────────────────────

export const ANCHOR_FRAMEWORK_ERRORS = {
  // 2000-2999: Instruction-level
  InstructionMissing: 100,
  InstructionFallbackNotFound: 101,
  InstructionDidNotDeserialize: 102,
  InstructionDidNotSerialize: 103,

  // 2000-2999: IDL-level
  IdlInstructionStub: 1000,
  IdlInstructionInvalidProgram: 1001,
  IdlAccountNotEmpty: 1002,

  // 2000-2999: Constraint
  ConstraintMut: 2000,
  ConstraintHasOne: 2001,
  ConstraintSigner: 2002,
  ConstraintRaw: 2003,
  ConstraintOwner: 2004,
  ConstraintRentExempt: 2005,
  ConstraintSeeds: 2006,
  ConstraintExecutable: 2007,
  ConstraintState: 2008,
  ConstraintAssociated: 2009,
  ConstraintAssociatedInit: 2010,
  ConstraintClose: 2011,
  ConstraintAddress: 2012,
  ConstraintZero: 2013,
  ConstraintTokenMint: 2014,
  ConstraintTokenOwner: 2015,
  ConstraintMintMintAuthority: 2016,
  ConstraintMintFreezeAuthority: 2017,
  ConstraintMintDecimals: 2018,
  ConstraintSpace: 2019,
  ConstraintAccountIsNone: 2020,
  ConstraintTokenTokenProgram: 2021,
  ConstraintMintTokenProgram: 2022,
  ConstraintAssociatedTokenTokenProgram: 2023,

  // 3000-3999: Account
  AccountDiscriminatorAlreadySet: 3000,
  AccountDiscriminatorNotFound: 3001,
  AccountDiscriminatorMismatch: 3002,
  AccountDidNotDeserialize: 3003,
  AccountDidNotSerialize: 3004,
  AccountNotEnoughKeys: 3005,
  AccountNotMutable: 3006,
  AccountOwnedByWrongProgram: 3007,
  InvalidProgramId: 3008,
  InvalidProgramExecutable: 3009,
  AccountNotSigner: 3010,
  AccountNotSystemOwned: 3011,
  AccountNotInitialized: 3012,
  AccountNotProgramData: 3013,
  AccountNotAssociatedTokenAccount: 3014,
  AccountSysvarMismatch: 3015,
  AccountReallocExceedsLimit: 3016,
  AccountDuplicateReallocs: 3017,

  // 4000-4999: State
  StateInvalidAddress: 4000,

  // 5000-5999: Misc
  DeclaredProgramIdMismatch: 4100,
  TryingToInitPayerAsProgramAccount: 4101,
  InvalidNumericConversion: 4102,

  Deprecated: 5000,
} as const;

/**
 * Union of Anchor framework error names (the commonly-asserted subset).
 */
export type AnchorFrameworkName = keyof typeof ANCHOR_FRAMEWORK_ERRORS;

export type AnchorFrameworkCodeFor<N extends AnchorFrameworkName> =
  (typeof ANCHOR_FRAMEWORK_ERRORS)[N];

// ────────────────────────────────────────────────────────────────
// Metadata (exported for drift-check + diagnostics)
// ────────────────────────────────────────────────────────────────

/** Total number of Sigil error codes. */
export const SIGIL_ERROR_COUNT: number = Object.keys(SIGIL_ERRORS).length;

/** First (inclusive) Sigil error code. */
export const SIGIL_ERROR_MIN: number = 6000;

/** Last (inclusive) Sigil error code currently defined. */
export const SIGIL_ERROR_MAX: number = Math.max(...Object.values(SIGIL_ERRORS));
