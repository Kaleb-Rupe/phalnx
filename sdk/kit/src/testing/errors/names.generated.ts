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
// Sigil program errors (6000-6074)
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
  EscrowNotActive: 6039,
  EscrowExpired: 6040,
  EscrowNotExpired: 6041,
  InvalidEscrowVault: 6042,
  EscrowConditionsNotMet: 6043,
  EscrowDurationExceeded: 6044,
  InvalidConstraintConfig: 6045,
  ConstraintViolated: 6046,
  InvalidConstraintsPda: 6047,
  InvalidPendingConstraintsPda: 6048,
  AgentSpendLimitExceeded: 6049,
  OverlaySlotExhausted: 6050,
  AgentSlotNotFound: 6051,
  UnauthorizedTokenApproval: 6052,
  InvalidSessionExpiry: 6053,
  UnconstrainedProgramBlocked: 6054,
  ProtocolCapExceeded: 6055,
  ProtocolCapsMismatch: 6056,
  ActiveEscrowsExist: 6057,
  ConstraintsNotClosed: 6058,
  PendingPolicyExists: 6059,
  AgentPaused: 6060,
  AgentAlreadyPaused: 6061,
  AgentNotPaused: 6062,
  UnauthorizedPostFinalizeInstruction: 6063,
  UnexpectedBalanceDecrease: 6064,
  TimelockTooShort: 6065,
  PolicyVersionMismatch: 6066,
  ActiveSessionsExist: 6067,
  PostAssertionFailed: 6068,
  InvalidPostAssertionIndex: 6069,
  UnauthorizedPreValidateInstruction: 6070,
  SnapshotNotCaptured: 6071,
  InvalidConstraintOperator: 6072,
  ConstraintsVaultMismatch: 6073,
  BlockedSplOpcode: 6074,
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
