# ERROR_CODE_ALLOCATION_V2.md — Canonical Error Code Allocation

**Status:** Canonical source of truth for `SigilError` numeric codes.
**Last updated:** 2026-05-17
**Source:** `programs/sigil/src/errors.rs` (verified line-by-line on `revamp/v2-2026-05`).
**Supersedes:** Any prior error-code listing in `INTERFACES_V2.md`, `CLAUDE.md`, or `docs/ERROR-CODES.md`.

> Anchor assigns codes sequentially from the order of variant declaration. The first variant gets `6000`; each subsequent variant increments by 1. `code = 6000 + variant_ordinal` (0-indexed). This document maps every variant currently in the enum to its exact code, and reserves the post-Phase-1 range for V2 additions.

---

## 1. Current V1 allocation (81 variants, codes 6000-6080)

Verified against `programs/sigil/src/errors.rs` on `revamp/v2-2026-05` (commit `554796e`).

| Code | Variant | Source line | Category |
|------|---------|-------------|----------|
| 6000 | `VaultNotActive` | errors.rs:6 | Vault lifecycle |
| 6001 | `UnauthorizedAgent` | errors.rs:9 | Authorization |
| 6002 | `UnauthorizedOwner` | errors.rs:12 | Authorization |
| 6003 | `UnsupportedToken` | errors.rs:15 | Mint validation |
| 6004 | `ProtocolNotAllowed` | errors.rs:18 | Allowlist |
| 6005 | `TransactionTooLarge` | errors.rs:21 | Transaction shape |
| 6006 | `SpendingCapExceeded` | errors.rs:24 | Spending |
| 6007 | `SessionNotAuthorized` | errors.rs:27 | Session |
| 6008 | `InvalidSession` | errors.rs:30 | Session |
| 6009 | `TooManyAllowedProtocols` | errors.rs:33 | Policy bounds |
| 6010 | `AgentAlreadyRegistered` | errors.rs:36 | Agent lifecycle |
| 6011 | `NoAgentRegistered` | errors.rs:39 | Agent lifecycle |
| 6012 | `VaultNotFrozen` | errors.rs:42 | Vault lifecycle |
| 6013 | `VaultAlreadyClosed` | errors.rs:45 | Vault lifecycle |
| 6014 | `InsufficientBalance` | errors.rs:48 | Balance |
| 6015 | `DeveloperFeeTooHigh` | errors.rs:51 | Fee |
| 6016 | `InvalidFeeDestination` | errors.rs:54 | Fee |
| 6017 | `InvalidProtocolTreasury` | errors.rs:57 | Protocol |
| 6018 | `InvalidAgentKey` | errors.rs:60 | Agent validation |
| 6019 | `AgentIsOwner` | errors.rs:63 | Agent validation |
| 6020 | `Overflow` | errors.rs:66 | Arithmetic |
| 6021 | `InvalidTokenAccount` | errors.rs:70 | Token account |
| 6022 | `TimelockNotExpired` | errors.rs:74 | Timelock |
| 6023 | `NoTimelockConfigured` | errors.rs:79 | Timelock |
| 6024 | `DestinationNotAllowed` | errors.rs:82 | Allowlist |
| 6025 | `TooManyDestinations` | errors.rs:85 | Policy bounds |
| 6026 | `InvalidProtocolMode` | errors.rs:88 | Policy mode |
| 6027 | `CpiCallNotAllowed` | errors.rs:92 | Transaction shape |
| 6028 | `MissingFinalizeInstruction` | errors.rs:95 | Transaction shape |
| 6029 | `NonTrackedSwapMustReturnStablecoin` | errors.rs:99 | Stablecoin enforcement |
| 6030 | `SwapSlippageExceeded` | errors.rs:102 | Jupiter (slated for Phase 1 deletion) |
| 6031 | `InvalidJupiterInstruction` | errors.rs:105 | Jupiter (slated for Phase 1 deletion) |
| 6032 | `UnauthorizedTokenTransfer` | errors.rs:108 | Token transfer |
| 6033 | `SlippageBpsTooHigh` | errors.rs:111 | Jupiter (slated for Phase 1 deletion) |
| 6034 | `ProtocolMismatch` | errors.rs:114 | Protocol |
| 6035 | `TooManyDeFiInstructions` | errors.rs:117 | Transaction shape |
| 6036 | `MaxAgentsReached` | errors.rs:121 | Multi-agent |
| 6037 | `InsufficientPermissions` | errors.rs:124 | Multi-agent |
| 6038 | `InvalidPermissions` | errors.rs:127 | Multi-agent |
| 6039 | `InvalidConstraintConfig` | errors.rs:131 | Constraints |
| 6040 | `ConstraintViolated` | errors.rs:134 | Constraints |
| 6041 | `InvalidConstraintsPda` | errors.rs:137 | Constraints |
| 6042 | `InvalidPendingConstraintsPda` | errors.rs:140 | Constraints |
| 6043 | `AgentSpendLimitExceeded` | errors.rs:144 | Per-agent spend |
| 6044 | `OverlaySlotExhausted` | errors.rs:147 | Per-agent spend |
| 6045 | `AgentSlotNotFound` | errors.rs:150 | Per-agent spend |
| 6046 | `UnauthorizedTokenApproval` | errors.rs:153 | Token transfer |
| 6047 | `InvalidSessionExpiry` | errors.rs:156 | Session |
| 6048 | `UnconstrainedProgramBlocked` | errors.rs:160 | Constraints V2 |
| 6049 | `ProtocolCapExceeded` | errors.rs:164 | Per-protocol spend |
| 6050 | `ProtocolCapsMismatch` | errors.rs:167 | Per-protocol spend |
| 6051 | `ConstraintsNotClosed` | errors.rs:171 | Vault cleanup |
| 6052 | `PendingPolicyExists` | errors.rs:174 | Vault cleanup |
| 6053 | `AgentPaused` | errors.rs:178 | Emergency response |
| 6054 | `AgentAlreadyPaused` | errors.rs:181 | Emergency response |
| 6055 | `AgentNotPaused` | errors.rs:184 | Emergency response |
| 6056 | `UnauthorizedPostFinalizeInstruction` | errors.rs:188 | Sandwich integrity |
| 6057 | `UnexpectedBalanceDecrease` | errors.rs:192 | CPI balance audit |
| 6058 | `TimelockTooShort` | errors.rs:196 | Timelock |
| 6059 | `PolicyVersionMismatch` | errors.rs:199 | Policy versioning |
| 6060 | `ActiveSessionsExist` | errors.rs:202 | Vault cleanup |
| 6061 | `PostAssertionFailed` | errors.rs:206 | Post-execution assertions |
| 6062 | `InvalidPostAssertionIndex` | errors.rs:209 | Post-execution assertions |
| 6063 | `UnauthorizedPreValidateInstruction` | errors.rs:212 | Sandwich integrity |
| 6064 | `SnapshotNotCaptured` | errors.rs:215 | Delta assertions |
| 6065 | `InvalidConstraintOperator` | errors.rs:218 | Constraints |
| 6066 | `ConstraintsVaultMismatch` | errors.rs:221 | Constraints |
| 6067 | `BlockedSplOpcode` | errors.rs:224 | SPL opcode block |
| 6068 | `QueuedUpdateExpired` | errors.rs:228 | Durable-nonce defense (F-10) |
| 6069 | `AccountWritabilityMismatch` | errors.rs:232 | Squads SAP parity (M5) |
| 6070 | `SysvarScanBoundExceeded` | errors.rs:236 | Pad-attack DoS guard (M11) |
| 6071 | `AsyncFulfillmentNotPermitted` | errors.rs:240 | Async-fulfillment block (C4) |
| 6072 | `ConstraintsAlreadyPopulated` | errors.rs:244 | Orphan-PDA cleanup |
| 6073 | `OrphanPdaWrongOwner` | errors.rs:247 | Orphan-PDA cleanup |
| 6074 | `OrphanPdaPopulated` | errors.rs:250 | Orphan-PDA cleanup |
| 6075 | `ConfidentialTransferBlocked` | errors.rs:254 | Token-2022 (M3) |
| 6076 | `PermanentDelegateBlocked` | errors.rs:259 | Token-2022 follow-up |
| 6077 | `TransferHookBlocked` | errors.rs:262 | Token-2022 follow-up |
| 6078 | `LamportDrainBlocked` | errors.rs:265 | Token-2022 follow-up |
| 6079 | `BatchInstructionBlocked` | errors.rs:269 | Token-2022 batch block |
| 6080 | `InvalidDestinationMode` | errors.rs:274 | Destination mode (F-4) |

**Count check:** 81 variants, codes 6000-6080 inclusive (verified via direct line-by-line enumeration of `programs/sigil/src/errors.rs`).

---

## 2. Phase 1 demolition deletions (3 Jupiter-specific variants)

Per `HARDENED_V2_PROMPT_MAP.md` §4 and F-21, Phase 1 deletes these Jupiter-specific variants:

- `SwapSlippageExceeded` (6030)
- `InvalidJupiterInstruction` (6031)
- `SlippageBpsTooHigh` (6033)

**CRITICAL — code re-numbering caveat:** Anchor renumbers ALL variants after a deletion if the variants are removed in place. To preserve stable codes for the 78 remaining V1 variants, Phase 1 MUST remove the Jupiter variants from the END of the enum (re-order before deletion) OR leave placeholder `#[deprecated]` variants in their slots. The chosen approach is documented at Phase 1 implementation time and reflected in the post-Phase-1 numeric snapshot in §3 below.

**Post-Phase-1 expected state:** 78 V1 variants. The lowest unused code is **6078** (the first available slot after compaction or the first slot beyond the last surviving V1 variant, depending on the chosen deletion strategy).

---

## 3. Post-Phase-1 reservation table (V2 additions, codes 6078-6102)

These codes are reserved for V2 primitives introduced in Phases 2 through 8. They are listed here in the order they are scheduled to land in the enum.

| Code | Name | Phase | Primitive | Notes |
|------|------|-------|-----------|-------|
| 6078 | `ErrInvalidCapability` | Phase 2 | TA-04 | Reserved capability values 3..=255 reject |
| 6079 | `ErrObserveOnlyModeBlocksExecute` | Phase 2 | TA-04 | Observer capability blocks execute path |
| 6080 | `ErrPolicyPreviewMismatch` | Phase 2 | TA-19 | SHA-256 digest mismatch on PolicyConfig/PendingPolicyUpdate |
| 6081 | `ErrMintNotPinned` | Phase 3 | TA-03 | USDC/USDT cluster-pinned mint enforcement |
| 6082 | `ErrOutsideOperatingHours` | Phase 3 | TA-05 | UTC operating-hours bitmask violation |
| 6083 | `ErrCooldownActive` | Phase 3 | TA-06 | Per-agent cooldown (on AgentSpendOverlay) |
| 6084 | `ErrGraylistFriction` | Phase 3 | TA-07 | First-time destination delay window |
| 6085 | `ErrGraylistFull` | Phase 3 | TA-07 | Destination graylist bound (10 entries) |
| 6086 | `ErrToken2022ExtensionForbidden` | Phase 3 | TA-08 | TLV check at deposit (3-item allowlist per D-4) |
| 6087 | `ErrCosignRequired` | Phase 3 | TA-09 | Owner+session co-signature required |
| 6088 | `ErrAutoRevoked` | Phase 3 | TA-17 | AgentEntry.consecutive_failures threshold tripped |
| 6089 | `ErrSandwichIntegrity` | Phase 4 | TA-10 | Sandwich pair/bundle integrity violation |
| 6090 | `ErrProtectedWritable` | Phase 4 | TA-11 | Protected PDA listed as writable in foreign ix |
| 6091 | `ErrSessionNonceMismatch` | Phase 4 | AC-10 | Durable-nonce replay defense |
| 6092 | `ErrStableFloorViolation` | Phase 5 | TA-12 | usdc+usdt balance below configured floor |
| 6093 | `ErrDailyCapExceeded` | Phase 5 | TA-13 | Per-protocol rolling 24h cap (doc-fix) |
| 6094 | `ErrRecipientCapExceeded` | Phase 5 | TA-14 | `[PerRecipientCounter; 10]` array overflow |
| 6095 | `ErrMintDeltaCapExceeded` | Phase 6 | R-1 | Mint-level delta cap violation |
| 6096 | `ErrAtaAuthorityChanged` | Phase 6 | R-2 | ATA owner/delegate changed mid-bundle |
| 6097 | `ErrOutputBelowFloor` | Phase 6 | R-3 | Output amount below declared floor |
| 6098 | `ErrDeclarationInconsistent` | Phase 6 | R-4 | Bundle declarations don't match observed state |
| 6099 | `ErrPendingOwnershipExists` | Phase 8 | C26 | Pending ownership transfer collision |
| 6100 | `ErrPendingOwnershipNotReady` | Phase 8 | C26 | Pending transfer not past timelock |
| 6101 | `ErrInvalidFreezeReason` | Phase 8 | C27 | Reserved freeze_reason enum value |
| 6102 | `ErrReactivateCooldownActive` | Phase 8 | C28 | Post-unfreeze observation window active |

**Total reserved:** 25 codes (6078-6102 inclusive).

---

## 4. Reuse policy — DO NOT re-allocate existing codes

The following existing variants are explicitly re-used by V2 primitives (no new code allocation needed). Use the existing variant; if the user-facing `#[msg(...)]` needs to change, update the message text in place but DO NOT renumber.

| Existing variant | Code | V2 primitive that re-uses it |
|------------------|------|------------------------------|
| `DestinationNotAllowed` | 6024 | TA-02 (tightens defaults; no new code) |
| `InvalidProtocolMode` | 6026 | TA-01 (UPDATE msg to "must be 1=ALLOWLIST") |
| `InvalidDestinationMode` | 6080 | TA-02 (UPDATE msg to "must be 0=RESTRICTED") |
| `ConfidentialTransferBlocked` | 6075 | TA-08 deposit-path re-use |
| `PermanentDelegateBlocked` | 6076 | TA-08 re-use |
| `TransferHookBlocked` | 6077 | TA-08 re-use |
| `LamportDrainBlocked` | 6078 | TA-08 re-use **(NOTE: code 6078 is currently `LamportDrainBlocked` per §1; the V2 reservation table re-uses the same code for `ErrInvalidCapability` ONLY in the post-Phase-1 compaction scenario where `LamportDrainBlocked` shifts numerically. Phase 1 implementation MUST resolve this collision explicitly before Phase 2 lands new codes.)** |
| `BatchInstructionBlocked` | 6079 | TA-08 re-use (same caveat as above — see Phase 1 deletion strategy in §2) |
| `BlockedSplOpcode` | 6067 | TA-10 re-use |
| `AccountWritabilityMismatch` | 6069 | TA-11 re-use |
| `UnauthorizedPreValidateInstruction` | 6063 | TA-10 re-use |
| `UnauthorizedPostFinalizeInstruction` | 6056 | TA-10 re-use |

**Phase 1 sequencing note:** The Phase 1 demolition prompt must explicitly decide between (a) compaction (deletes shift later codes down — breaks numeric stability) or (b) deprecation placeholders (leaves variant slots in place — preserves codes). The reservation table in §3 assumes option (b) is chosen so that `ErrInvalidCapability` is the next available code at 6078 only after the three Jupiter variants are removed from the end OR replaced by deprecation stubs. If option (a) is chosen, the entire reservation table shifts down by 3.

---

## 5. Cross-doc reconciliation

- `INTERFACES_V2.md §"Error Code Allocation"` (current) lists codes 6081-6097 with different names and a different ordering. **This document supersedes that listing.** A follow-up edit to `INTERFACES_V2.md` should either (a) delete its error-code section and link here, or (b) be updated to match this table verbatim.
- `agent-middleware/docs/ERROR-CODES.md` documents user-facing error semantics; it is not a numeric source of truth. Update there is required when V2 codes land in Phase 2+.
- The repo-root `CLAUDE.md` cites "6000-6070" — this is stale (V1 actually occupies 6000-6080). Correction is out of L-6 scope for Phase 0.5; flagged for v1.1 housekeeping.

---

**END OF ERROR_CODE_ALLOCATION_V2.md**
