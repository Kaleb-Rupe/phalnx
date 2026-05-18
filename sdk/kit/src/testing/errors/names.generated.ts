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
// Sigil program errors (6000-6096)
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
  UnauthorizedTokenTransfer: 6030,
  SlippageBpsTooHigh: 6031,
  ProtocolMismatch: 6032,
  TooManyDeFiInstructions: 6033,
  MaxAgentsReached: 6034,
  InsufficientPermissions: 6035,
  InvalidPermissions: 6036,
  InvalidConstraintConfig: 6037,
  ConstraintViolated: 6038,
  InvalidConstraintsPda: 6039,
  InvalidPendingConstraintsPda: 6040,
  AgentSpendLimitExceeded: 6041,
  OverlaySlotExhausted: 6042,
  AgentSlotNotFound: 6043,
  UnauthorizedTokenApproval: 6044,
  InvalidSessionExpiry: 6045,
  UnconstrainedProgramBlocked: 6046,
  ProtocolCapExceeded: 6047,
  ProtocolCapsMismatch: 6048,
  ConstraintsNotClosed: 6049,
  PendingPolicyExists: 6050,
  AgentPaused: 6051,
  AgentAlreadyPaused: 6052,
  AgentNotPaused: 6053,
  UnauthorizedPostFinalizeInstruction: 6054,
  UnexpectedBalanceDecrease: 6055,
  TimelockTooShort: 6056,
  PolicyVersionMismatch: 6057,
  ActiveSessionsExist: 6058,
  PostAssertionFailed: 6059,
  InvalidPostAssertionIndex: 6060,
  UnauthorizedPreValidateInstruction: 6061,
  SnapshotNotCaptured: 6062,
  InvalidConstraintOperator: 6063,
  ConstraintsVaultMismatch: 6064,
  BlockedSplOpcode: 6065,
  QueuedUpdateExpired: 6066,
  AccountWritabilityMismatch: 6067,
  SysvarScanBoundExceeded: 6068,
  AsyncFulfillmentNotPermitted: 6069,
  ConstraintsAlreadyPopulated: 6070,
  OrphanPdaWrongOwner: 6071,
  OrphanPdaPopulated: 6072,
  ConfidentialTransferBlocked: 6073,
  PermanentDelegateBlocked: 6074,
  TransferHookBlocked: 6075,
  LamportDrainBlocked: 6076,
  BatchInstructionBlocked: 6077,
  InvalidDestinationMode: 6078,
  InvalidCapability: 6079,
  PolicyPreviewMismatch: 6080,
  ObserveOnlyModeBlocksExecute: 6081,
  ActiveVaultRequiresAllowlist: 6082,
  ErrMintNotPinned: 6083,
  ErrOutsideOperatingHours: 6084,
  ErrCooldownActive: 6085,
  ErrGraylistFriction: 6086,
  ErrGraylistFull: 6087,
  ErrToken2022ExtensionForbidden: 6088,
  ErrCosignRequired: 6089,
  ErrAutoRevoked: 6090,
  ErrSandwichIntegrity: 6091,
  ErrProtectedWritable: 6092,
  ErrSessionNonceMismatch: 6093,
  ErrStableFloorViolation: 6094,
  ErrDailyCapExceeded: 6095,
  ErrRecipientCapExceeded: 6096,
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
