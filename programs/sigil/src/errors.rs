use anchor_lang::prelude::*;

#[error_code]
pub enum SigilError {
    #[msg("Vault is not active")]
    VaultNotActive,

    #[msg("Unauthorized: signer is not the registered agent")]
    UnauthorizedAgent,

    #[msg("Unauthorized: signer is not the vault owner")]
    UnauthorizedOwner,

    #[msg("Token is not a supported stablecoin (only USDC and USDT)")]
    UnsupportedToken,

    #[msg("Protocol not allowed by policy")]
    ProtocolNotAllowed,

    #[msg("Transaction exceeds maximum single transaction size")]
    TransactionTooLarge,

    #[msg("Rolling 24h spending cap would be exceeded")]
    SpendingCapExceeded,

    #[msg("Session not authorized")]
    SessionNotAuthorized,

    #[msg("Invalid session: does not belong to this vault")]
    InvalidSession,

    #[msg("Policy configuration invalid: too many allowed protocols")]
    TooManyAllowedProtocols,

    #[msg("Agent already registered for this vault")]
    AgentAlreadyRegistered,

    #[msg("No agent registered for this vault")]
    NoAgentRegistered,

    #[msg("Vault is not frozen (expected frozen for reactivation)")]
    VaultNotFrozen,

    #[msg("Vault is already closed")]
    VaultAlreadyClosed,

    #[msg("Insufficient vault balance for withdrawal")]
    InsufficientBalance,

    #[msg("Developer fee rate exceeds maximum (500 / 1,000,000 = 5 BPS)")]
    DeveloperFeeTooHigh,

    #[msg("Fee destination account invalid")]
    InvalidFeeDestination,

    #[msg("Protocol treasury account does not match expected address")]
    InvalidProtocolTreasury,

    #[msg("Invalid agent: cannot be the zero address")]
    InvalidAgentKey,

    #[msg("Invalid agent: agent cannot be the vault owner")]
    AgentIsOwner,

    #[msg("Arithmetic overflow")]
    Overflow,

    // --- Validation errors ---
    #[msg("Token account does not belong to vault or has wrong mint")]
    InvalidTokenAccount,

    // --- Timelock + Destination errors ---
    #[msg("Timelock period has not expired yet")]
    TimelockNotExpired,

    // TimelockActive removed — the 4 direct-mutation instructions that used it are deleted.
    // All mutations now route through queue/apply with mandatory timelock.
    #[msg("No timelock configured on this vault")]
    NoTimelockConfigured,

    #[msg("Destination not in allowed list")]
    DestinationNotAllowed,

    #[msg("Too many destinations (max 10)")]
    TooManyDestinations,

    #[msg("Invalid protocol mode (must be 1 = ALLOWLIST)")]
    InvalidProtocolMode,

    // --- Transaction validation errors ---
    #[msg("Instruction must be top-level (CPI calls not allowed)")]
    CpiCallNotAllowed,

    #[msg("Transaction must include finalize_session after validate")]
    MissingFinalizeInstruction,

    // --- Stablecoin-only enforcement errors ---
    #[msg("Non-stablecoin swap must return stablecoin (balance did not increase)")]
    NonTrackedSwapMustReturnStablecoin,

    // SwapSlippageExceeded (was 6030) DELETED in Phase 1 Option A demolition —
    // on-chain Jupiter slippage verifier removed. The generic
    // `policy.max_slippage_bps` config primitive is preserved (D-5); runtime
    // slippage enforcement moves to off-chain SDK simulators / Phase 6
    // post-execution assertions.
    //
    // InvalidJupiterInstruction (was 6031) DELETED in Phase 1 Option A demolition —
    // Jupiter swap instruction parser removed entirely.

    #[msg("Top-level SPL Token transfer not allowed between validate and finalize")]
    UnauthorizedTokenTransfer,

    #[msg("Slippage BPS exceeds maximum (5000 = 50%)")]
    SlippageBpsTooHigh,

    #[msg("DeFi instruction program does not match declared target_protocol")]
    ProtocolMismatch,

    #[msg("Spending allows at most one DeFi instruction")]
    TooManyDeFiInstructions,

    // --- Multi-Agent errors ---
    #[msg("Maximum agents per vault reached (limit: 10)")]
    MaxAgentsReached,

    #[msg("Agent lacks permission for this action type")]
    InsufficientPermissions,

    #[msg("Permission bitmask contains invalid bits")]
    InvalidPermissions,

    // --- Instruction constraints errors ---
    #[msg("Invalid constraint configuration: bounds exceeded")]
    InvalidConstraintConfig,

    #[msg("Instruction constraint violated")]
    ConstraintViolated,

    #[msg("Invalid constraints PDA: wrong owner or vault")]
    InvalidConstraintsPda,

    #[msg("Invalid pending constraints PDA: wrong owner or vault")]
    InvalidPendingConstraintsPda,

    // --- Per-agent spend limit errors ---
    #[msg("Agent rolling 24h spend exceeds per-agent spending limit")]
    AgentSpendLimitExceeded,

    #[msg("Per-agent overlay is full; cannot register agent with spending limit")]
    OverlaySlotExhausted,

    #[msg("Agent has per-agent spending limit but no overlay tracking slot")]
    AgentSlotNotFound,

    #[msg("Unauthorized SPL Token Approve between validate and finalize")]
    UnauthorizedTokenApproval,

    #[msg("Session expiry slots out of range (10-450)")]
    InvalidSessionExpiry,

    // --- Generic constraints V2 errors ---
    #[msg("Program has no matching constraint entry — every instruction must match one")]
    UnconstrainedProgramBlocked,

    // --- Per-protocol spend cap errors ---
    #[msg("Per-protocol rolling 24h spending cap would be exceeded")]
    ProtocolCapExceeded,

    #[msg("protocol_caps length must match protocols length when has_protocol_caps is true")]
    ProtocolCapsMismatch,

    // --- Vault cleanup guard errors ---
    #[msg("Instruction constraints must be closed before closing vault")]
    ConstraintsNotClosed,

    #[msg("Pending policy update must be applied or cancelled before closing vault")]
    PendingPolicyExists,

    // --- Emergency response errors ---
    #[msg("Agent is paused and cannot execute actions")]
    AgentPaused,

    #[msg("Agent is already paused")]
    AgentAlreadyPaused,

    #[msg("Agent is not paused")]
    AgentNotPaused,

    // --- Post-finalize instruction check ---
    #[msg("Instructions after finalize_session must be ComputeBudget or SystemProgram only")]
    UnauthorizedPostFinalizeInstruction,

    // --- CPI balance audit ---
    #[msg("Vault balance decreased more than delegated amount — potential CPI attack")]
    UnexpectedBalanceDecrease,

    // --- TOCTOU fix: mandatory timelock + policy versioning ---
    #[msg("Timelock duration below minimum (1800 seconds / 30 minutes)")]
    TimelockTooShort,

    #[msg("Policy version mismatch — policy changed since agent's last RPC read")]
    PolicyVersionMismatch,

    #[msg("Cannot close vault with active sessions (finalize pending sessions first)")]
    ActiveSessionsExist,

    // --- Post-execution assertions (Phase B scaffolding) ---
    #[msg("Post-execution assertion failed: account state did not satisfy constraint")]
    PostAssertionFailed,

    #[msg("Post-assertion constraint references invalid instruction index")]
    InvalidPostAssertionIndex,

    #[msg("Non-infrastructure instruction detected before validate_and_authorize")]
    UnauthorizedPreValidateInstruction,

    #[msg("Delta assertion snapshot was not captured in validate_and_authorize")]
    SnapshotNotCaptured,

    #[msg("Constraint operator value is not a valid ConstraintOperator discriminant")]
    InvalidConstraintOperator,

    #[msg("Zero-copy constraints account has wrong vault")]
    ConstraintsVaultMismatch,

    #[msg("SPL opcode is blocked at runtime and cannot be used in constraints")]
    BlockedSplOpcode,

    // --- F-10 audit fix: durable-nonce pre-signing defense ---
    #[msg("Queued update is too old (>MAX_APPLY_AGE_SLOTS) — re-queue to apply. Defends against durable-nonce pre-signing.")]
    QueuedUpdateExpired,

    // --- M5: Squads SAP parity — account writability enforcement ---
    #[msg("Account writability flag does not match constraint requirement")]
    AccountWritabilityMismatch,

    // --- M11 SIMD-0296 pad-attack DoS guard ---
    #[msg("Sysvar instruction scan exceeded the per-tx safety bound")]
    SysvarScanBoundExceeded,

    // --- C4 audit fix: async-fulfillment programs ---
    #[msg("Async-fulfillment program is not permitted in V1 (Jupiter Perps, Drift, Drift JIT). Spending cannot be measured because keeper submits the actual transfer in a separate transaction after finalize_session returns.")]
    AsyncFulfillmentNotPermitted,

    // --- Orphan constraints PDA cleanup (F3-H1 audit fix) ---
    #[msg("Cannot clean an active constraints PDA; use queue+apply_close_constraints")]
    ConstraintsAlreadyPopulated,

    #[msg("PDA at constraints seeds is not program-owned")]
    OrphanPdaWrongOwner,

    #[msg("PDA is fully populated; not an orphan")]
    OrphanPdaPopulated,

    // --- Token-2022 ConfidentialTransfer block (M3) ---
    #[msg("Token-2022 ConfidentialTransfer not permitted between validate and finalize")]
    ConfidentialTransferBlocked,

    // --- Token-2022 follow-up blocks (Pentester HIGH/MED) ---
    // Opcodes 35/36/38/42/45 — see validate_and_authorize.rs Token-2022 match arm.
    #[msg("Token-2022 PermanentDelegate not permitted between validate and finalize")]
    PermanentDelegateBlocked,

    #[msg("Token-2022 TransferHook not permitted between validate and finalize")]
    TransferHookBlocked,

    #[msg("Token-2022 destructive-balance ix (opcodes 38/45/46) not permitted between validate and finalize")]
    LamportDrainBlocked,

    // --- Token-2022 third-pass audit additions ---
    #[msg("Token-2022 Batch instruction (opcode 255) is blocked outright — wraps inner instructions and bypasses byte-0 blocklist")]
    BatchInstructionBlocked,

    // --- F-4 audit fix: explicit destination mode ---
    // Phase 2 (Option A default-tightening): only RESTRICTED is permitted.
    // OPEN_WITH_CAP path deleted; #[msg] tightened to reflect new contract.
    #[msg("Invalid destination mode (must be 0 = RESTRICTED)")]
    InvalidDestinationMode,

    // --- Phase 2 additions (TA-04 + TA-19) ---
    // Appended at the END of the enum to preserve existing error codes 6000-6078.

    /// 6079 — TA-04: Reserved AgentEntry.capability values 3..=255 explicitly
    /// rejected at register/queue/apply. Replaces the prior silent zero-coerce
    /// behaviour (values >2 were treated as 0 by `has_capability`).
    #[msg("Invalid agent capability value (must be 0 = Disabled, 1 = Observer, or 2 = Operator)")]
    InvalidCapability,

    /// 6080 — TA-19: SHA-256 digest of canonical policy preview encoding does
    /// not match recomputed digest. Indicates owner-signer compromise or
    /// pending-PDA tampering between queue and apply. Hard reject.
    #[msg("Policy preview digest mismatch — caller's signed digest differs from recomputed canonical digest")]
    PolicyPreviewMismatch,

    /// 6081 — TA-19: observe_only vault rejects all `validate_and_authorize`
    /// calls. Owners stand up observe-only vaults to baseline agent behaviour
    /// before opening the execute path.
    #[msg("Vault is in observe_only mode — validate_and_authorize is blocked")]
    ObserveOnlyModeBlocksExecute,

    /// 6082 — F-11 audit fix: an active (non-observe_only) vault must have at
    /// least ONE protocol on the allowlist OR at least ONE destination on the
    /// allowlist. Otherwise the vault is silently inert — accepts deposits but
    /// can never authorize any spending action. observe_only vaults are
    /// explicitly inert by design, so this check is skipped for them.
    #[msg("Active (non-observe_only) vault must have at least one protocol or destination on the allowlist")]
    ActiveVaultRequiresAllowlist,
}
