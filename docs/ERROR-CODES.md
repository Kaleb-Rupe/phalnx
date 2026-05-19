# Error Codes (6000-6102)

All 103 custom errors defined in `programs/sigil/src/errors.rs`. Use `require!(condition, SigilError::Name)`.

Source of truth: `target/idl/sigil.json` (regenerate this file by running `bash scripts/regen-error-codes-doc.sh` after any change to `errors.rs`).

| Code | Name | Message |
| ---- | ---- | ------- |
| 6000 | `VaultNotActive` | Vault is not active |
| 6001 | `UnauthorizedAgent` | Unauthorized: signer is not the registered agent |
| 6002 | `UnauthorizedOwner` | Unauthorized: signer is not the vault owner |
| 6003 | `UnsupportedToken` | Token is not a supported stablecoin (only USDC and USDT) |
| 6004 | `ProtocolNotAllowed` | Protocol not allowed by policy |
| 6005 | `TransactionTooLarge` | Transaction exceeds maximum single transaction size |
| 6006 | `SpendingCapExceeded` | Rolling 24h spending cap would be exceeded |
| 6007 | `SessionNotAuthorized` | Session not authorized |
| 6008 | `InvalidSession` | Invalid session: does not belong to this vault |
| 6009 | `TooManyAllowedProtocols` | Policy configuration invalid: too many allowed protocols |
| 6010 | `AgentAlreadyRegistered` | Agent already registered for this vault |
| 6011 | `NoAgentRegistered` | No agent registered for this vault |
| 6012 | `VaultNotFrozen` | Vault is not frozen (expected frozen for reactivation) |
| 6013 | `VaultAlreadyClosed` | Vault is already closed |
| 6014 | `InsufficientBalance` | Insufficient vault balance for withdrawal |
| 6015 | `DeveloperFeeTooHigh` | Developer fee rate exceeds maximum (500 / 1,000,000 = 5 BPS) |
| 6016 | `InvalidFeeDestination` | Fee destination account invalid |
| 6017 | `InvalidProtocolTreasury` | Protocol treasury account does not match expected address |
| 6018 | `InvalidAgentKey` | Invalid agent: cannot be the zero address |
| 6019 | `AgentIsOwner` | Invalid agent: agent cannot be the vault owner |
| 6020 | `Overflow` | Arithmetic overflow |
| 6021 | `InvalidTokenAccount` | Token account does not belong to vault or has wrong mint |
| 6022 | `TimelockNotExpired` | Timelock period has not expired yet |
| 6023 | `NoTimelockConfigured` | No timelock configured on this vault |
| 6024 | `DestinationNotAllowed` | Destination not in allowed list |
| 6025 | `TooManyDestinations` | Too many destinations (max 10) |
| 6026 | `InvalidProtocolMode` | Invalid protocol mode (must be 1 = ALLOWLIST) |
| 6027 | `CpiCallNotAllowed` | Instruction must be top-level (CPI calls not allowed) |
| 6028 | `MissingFinalizeInstruction` | Transaction must include finalize_session after validate |
| 6029 | `NonTrackedSwapMustReturnStablecoin` | Non-stablecoin swap must return stablecoin (balance did not increase) |
| 6030 | `UnauthorizedTokenTransfer` | Top-level SPL Token transfer not allowed between validate and finalize |
| 6031 | `SlippageBpsTooHigh` | Slippage BPS exceeds maximum (5000 = 50%) |
| 6032 | `ProtocolMismatch` | DeFi instruction program does not match declared target_protocol |
| 6033 | `TooManyDeFiInstructions` | Spending allows at most one DeFi instruction |
| 6034 | `MaxAgentsReached` | Maximum agents per vault reached (limit: 10) |
| 6035 | `InsufficientPermissions` | Agent lacks permission for this action type |
| 6036 | `InvalidPermissions` | Permission bitmask contains invalid bits |
| 6037 | `InvalidConstraintConfig` | Invalid constraint configuration: bounds exceeded |
| 6038 | `ConstraintViolated` | Instruction constraint violated |
| 6039 | `InvalidConstraintsPda` | Invalid constraints PDA: wrong owner or vault |
| 6040 | `InvalidPendingConstraintsPda` | Invalid pending constraints PDA: wrong owner or vault |
| 6041 | `AgentSpendLimitExceeded` | Agent rolling 24h spend exceeds per-agent spending limit |
| 6042 | `OverlaySlotExhausted` | Per-agent overlay is full; cannot register agent with spending limit |
| 6043 | `AgentSlotNotFound` | Agent has per-agent spending limit but no overlay tracking slot |
| 6044 | `UnauthorizedTokenApproval` | Unauthorized SPL Token Approve between validate and finalize |
| 6045 | `InvalidSessionExpiry` | Session expiry seconds out of range (5-90) |
| 6046 | `UnconstrainedProgramBlocked` | Program has no matching constraint entry — every instruction must match one |
| 6047 | `ProtocolCapExceeded` | Per-protocol rolling 24h spending cap would be exceeded — LEGACY counter exhaustion path. New rolling-24h amount-based cap rejections use 6095 ErrDailyCapExceeded |
| 6048 | `ProtocolCapsMismatch` | protocol_caps length must match protocols length when has_protocol_caps is true |
| 6049 | `ConstraintsNotClosed` | Instruction constraints must be closed before closing vault |
| 6050 | `PendingPolicyExists` | Pending policy update must be applied or cancelled before closing vault |
| 6051 | `AgentPaused` | Agent is paused and cannot execute actions |
| 6052 | `AgentAlreadyPaused` | Agent is already paused |
| 6053 | `AgentNotPaused` | Agent is not paused |
| 6054 | `UnauthorizedPostFinalizeInstruction` | Instructions after finalize_session must be ComputeBudget or SystemProgram only |
| 6055 | `UnexpectedBalanceDecrease` | Vault balance decreased more than delegated amount — potential CPI attack |
| 6056 | `TimelockTooShort` | Timelock duration below minimum (1800 seconds / 30 minutes) |
| 6057 | `PolicyVersionMismatch` | Policy version mismatch — policy changed since agent's last RPC read |
| 6058 | `ActiveSessionsExist` | Cannot close vault with active sessions (finalize pending sessions first) |
| 6059 | `PostAssertionFailed` | Post-execution assertion failed: account state did not satisfy constraint |
| 6060 | `InvalidPostAssertionIndex` | Post-assertion constraint references invalid instruction index |
| 6061 | `UnauthorizedPreValidateInstruction` | Non-infrastructure instruction detected before validate_and_authorize |
| 6062 | `SnapshotNotCaptured` | Delta assertion snapshot was not captured in validate_and_authorize |
| 6063 | `InvalidConstraintOperator` | Constraint operator value is not a valid ConstraintOperator discriminant |
| 6064 | `ConstraintsVaultMismatch` | Zero-copy constraints account has wrong vault |
| 6065 | `BlockedSplOpcode` | SPL opcode is blocked at runtime and cannot be used in constraints |
| 6066 | `QueuedUpdateExpired` | Queued update is too old (>MAX_APPLY_AGE_SLOTS) — re-queue to apply. Defends against durable-nonce pre-signing. |
| 6067 | `AccountWritabilityMismatch` | Account writability flag does not match constraint requirement |
| 6068 | `SysvarScanBoundExceeded` | Sysvar instruction scan exceeded the per-tx safety bound |
| 6069 | `AsyncFulfillmentNotPermitted` | Async-fulfillment program is not permitted in V1 (Jupiter Perps, Drift, Drift JIT). Spending cannot be measured because keeper submits the actual transfer in a separate transaction after finalize_session returns. |
| 6070 | `ConstraintsAlreadyPopulated` | Cannot clean an active constraints PDA; use queue+apply_close_constraints |
| 6071 | `OrphanPdaWrongOwner` | PDA at constraints seeds is not program-owned |
| 6072 | `OrphanPdaPopulated` | PDA is fully populated; not an orphan |
| 6073 | `ConfidentialTransferBlocked` | Token-2022 ConfidentialTransfer not permitted between validate and finalize |
| 6074 | `PermanentDelegateBlocked` | Token-2022 PermanentDelegate not permitted between validate and finalize |
| 6075 | `TransferHookBlocked` | Token-2022 TransferHook not permitted between validate and finalize |
| 6076 | `LamportDrainBlocked` | Token-2022 destructive-balance ix (opcodes 38/45/46) not permitted between validate and finalize |
| 6077 | `BatchInstructionBlocked` | Token-2022 Batch instruction (opcode 255) is blocked outright — wraps inner instructions and bypasses byte-0 blocklist |
| 6078 | `InvalidDestinationMode` | Invalid destination mode (must be 0 = RESTRICTED) |
| 6079 | `InvalidCapability` | Invalid agent capability value (must be 0 = Disabled, 1 = Observer, or 2 = Operator) |
| 6080 | `PolicyPreviewMismatch` | Policy preview digest mismatch — caller's signed digest differs from recomputed canonical digest |
| 6081 | `ObserveOnlyModeBlocksExecute` | Vault is in observe_only mode — validate_and_authorize is blocked |
| 6082 | `ActiveVaultRequiresAllowlist` | Active (non-observe_only) vault must have at least one protocol or destination on the allowlist |
| 6083 | `ErrMintNotPinned` | Deposit mint is not a build-time-pinned stablecoin (USDC or USDT) |
| 6084 | `ErrOutsideOperatingHours` | Current UTC hour is outside the policy's operating_hours bitmask |
| 6085 | `ErrCooldownActive` | Agent cooldown period has not elapsed since the last action |
| 6086 | `ErrGraylistFriction` | Destination is graylisted (24h friction window — awaiting promote_graylist_destination or unlock) |
| 6087 | `ErrGraylistFull` | Destination graylist is full (max 10 entries) — wait for an existing entry to unlock or promote |
| 6088 | `ErrToken2022ExtensionForbidden` | Token-2022 mint has a forbidden extension (only MemoTransfer + MetadataPointer + NonTransferable allowed) |
| 6089 | `ErrCosignRequired` | Elevated policy mutation requires an owner-signed cosigning session |
| 6090 | `ErrAutoRevoked` | Agent capability auto-revoked after consecutive policy-violation failures; owner must re-enable |
| 6091 | `ErrSandwichIntegrity` | Bundle integrity violation: multiple validate_and_authorize instructions for the same (vault, agent, mint) tuple in one transaction |
| 6092 | `ErrProtectedWritable` | Protected Sigil PDA passed as writable to a foreign instruction between validate and finalize |
| 6093 | `ErrSessionNonceMismatch` | Session nonce mismatch — caller's expected_nonce does not match the session's stored nonce (durable-nonce replay defense) |
| 6094 | `ErrStableFloorViolation` | Stable balance floor violated — combined USDC+USDT balance dropped below policy.stable_balance_floor |
| 6095 | `ErrDailyCapExceeded` | Per-protocol daily spending cap would be exceeded (rolling 24h) |
| 6096 | `ErrRecipientCapExceeded` | Per-recipient daily cap exceeded — recipient outflow would breach policy.per_recipient_daily_cap_usd within the rolling 24h window, or per_recipient array full with no expired slot to evict |
| 6097 | `ErrMintDeltaCapExceeded` | R-1 MintDeltaCap: vault-mint balance decreased by more than max_net_decrease |
| 6098 | `MintDeltaCapMisconfigured` | R-1 MintDeltaCap misconfigured — target account missing, mint mismatch, or owner not vault |
| 6099 | `ErrAtaAuthorityChanged` | R-2 AtaAuthorityPin: vault-owned token account authority changed or account closed/reinitialized mid-sandwich |
| 6100 | `ErrOutputBelowFloor` | R-3 OutputBalanceFloor: post-execution balance increase fell below the configured min_increase floor |
| 6101 | `ErrDeclarationInconsistent` | R-4 DeclarationConsistency: declared recipient/mint does not match CPI account-meta |
| 6102 | `IxMetaCountExceeded` | Foreign DeFi instruction passed more account metas than the destination-check budget (16) allows; truncate the ix or split into shorter ixs |
