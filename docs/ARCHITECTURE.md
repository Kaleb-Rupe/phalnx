# Sigil Architecture Reference

## Account Model (Full)

Nine PDA account types, each in its own file under `state/`:

| PDA | Seeds | Size | File |
|-----|-------|------|------|
| **AgentVault** | `[b"vault", owner, vault_id]` | 634 bytes | `vault.rs` |
| **PolicyConfig** | `[b"policy", vault]` | 817 bytes | `policy.rs` |
| **SpendTracker** | `[b"tracker", vault]` | 2,840 bytes (zero-copy) | `tracker.rs` |
| **SessionAuthority** | `[b"session", vault, agent, token_mint]` | Standard | `session.rs` |
| **PendingPolicyUpdate** | `[b"pending_policy", vault]` | Standard | `pending_policy.rs` |
| **EscrowDeposit** | `[b"escrow", source_vault, dest_vault, escrow_id]` | 170 bytes | `escrow.rs` |
| **InstructionConstraints** | `[b"constraints", vault]` | 8,318 bytes | `constraints.rs` |
| **PendingConstraintsUpdate** | `[b"pending_constraints", vault]` | 8,334 bytes | `pending_constraints_update.rs` |
| **AgentSpendOverlay** | `[b"agent_spend", vault]` | 2,528 bytes (zero-copy) | `agent_spend_overlay.rs` |

Account details:
- **AgentVault** — holds owner, multi-agent Vec<AgentEntry> (max 10), status, fee destination
- **PolicyConfig** — spending caps, protocol enforcement (protocolMode + protocols Vec), leverage limits, timelock duration, allowed destinations, `has_constraints` flag, `maxSlippageBps`
- **SpendTracker** — zero-copy 144-epoch circular buffer. `EpochBucket { epoch_id: i64, usd_amount: u64 }` — aggregate USD-only tracking. Uses `#[account(zero_copy)]` with `#[repr(C)]` — requires `AccountLoader<'info, T>`, not `Account<'info, T>`. Access via `load_init()`, `load()`, `load_mut()`.
- **SessionAuthority** — ephemeral PDA created in validate, closed in finalize, expires after 20 slots. Includes `output_mint` + `stablecoin_balance_before` for post-swap verification.
- **PendingPolicyUpdate** — queued timelocked policy change
- **EscrowDeposit** — inter-vault escrow with optional SHA-256 condition hash and expiry
- **InstructionConstraints** — up to 16 ConstraintEntry (each up to 8 DataConstraint + 5 AccountConstraint) for byte-level instruction verification
- **PendingConstraintsUpdate** — queued timelocked constraint change
- **AgentSpendOverlay** — zero-copy per-agent spend tracking with 24-epoch, 10 agent slots, no shards, mirrors SpendTracker scheme but per-agent

## ActionType Classification (21 variants)

**Spending actions (9)** — `is_spending()` returns true, triggers cap check + fees + delegation + instruction scan:
`Swap`, `OpenPosition`, `IncreasePosition`, `Deposit`, `Transfer`, `AddCollateral`, `PlaceLimitOrder`, `SwapAndOpenPosition`, `CreateEscrow`

**Non-spending actions (12)** — `is_spending()` returns false, skips cap/fees/delegation:
`ClosePosition`, `DecreasePosition`, `Withdraw`, `RemoveCollateral`, `PlaceTriggerOrder`, `EditTriggerOrder`, `CancelTriggerOrder`, `EditLimitOrder`, `CancelLimitOrder`, `CloseAndSwapPosition`, `SettleEscrow`, `RefundEscrow`

## validate_and_authorize Flow

The handler executes these steps in order. Steps marked **(spending only)** are gated by `if is_spending`:

1. **CPI guard** — rejects CPI context (`get_stack_height()`) — ALL actions
2. **Vault active** — `vault.is_active()` — ALL actions
3. **Amount validation** — spending requires `amount > 0`, non-spending requires `amount == 0` — ALL actions
4. **Protocol policy check** — `policy.is_protocol_allowed(&target_protocol)` — ALL actions (declared protocol only)
5. **Cap check + fee calc** — stablecoin USD conversion, single-tx cap, rolling 24h cap, fee calculation — **(spending only)**
6. **Spending instruction scan (lines 329-386)** — scans all instructions between validate and finalize via `scan_instruction_shared()` helper (unbounded `while let` loop). Shared checks: SPL/Token-2022 blocking, infrastructure whitelist, protocol allowlist, generic constraints. Spending-only inline: recognized DeFi detection, ProtocolMismatch, defi_ix_count, Jupiter slippage — **(spending only)**
6b. **Non-spending instruction scan (lines 390-419)** — scans all instructions between validate and finalize via `scan_instruction_shared()` helper (unbounded `while let` loop). Shared checks only (no spending-specific logic) — **ALL non-spending actions**
7. **Leverage check** — `policy.is_leverage_within_limit()` — ALL actions
8. **Position effect check** — increment/decrement/none based on action type — ALL actions
9. **MissingFinalizeInstruction check** — confirmed during scan (lines 385, 418) — ALL actions
10. **Fee collection + delegation** — CPI transfers for protocol/developer fees, token approval — **(spending only)**
11. **Session PDA creation** — initializes `SessionAuthority` with `delegated = is_spending` — ALL actions

**Spending-only checks** (not applied to non-spending): slippage verification on recognized DeFi programs, protocol mismatch detection (`target_protocol == ix.program_id`), single-DeFi enforcement for non-stablecoin input, cap/fees/delegation. **Both paths verify:** protocol allowlist on actual intermediate instructions, SPL Token transfer blocking, infrastructure whitelist, generic constraints (if configured).

## On-Chain Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `EPOCH_DURATION` | 600 | 10-minute epoch in seconds |
| `NUM_EPOCHS` | 144 | Epochs in 24h window (144 × 600 = 86,400) |
| `ROLLING_WINDOW_SECONDS` | 86,400 | 24 hours |
| `SESSION_EXPIRY_SLOTS` | 20 | ~8 seconds at 400ms/slot |
| `MAX_ALLOWED_PROTOCOLS` | 10 | Max protocols in allowlist/denylist |
| `MAX_ALLOWED_DESTINATIONS` | 10 | Max transfer destinations |
| `PROTOCOL_FEE_RATE` | 200 | 2 BPS (0.02%) — hardcoded |
| `MAX_DEVELOPER_FEE_RATE` | 500 | 5 BPS (0.05%) — hard cap |
| `MAX_SLIPPAGE_BPS` | 5,000 | 50% — hard cap on slippage tolerance |
| `FEE_RATE_DENOMINATOR` | 1,000,000 | fee_rate / 1M = fractional fee |
| `USD_DECIMALS` | 6 | $1.00 = 1,000,000 |
| `USD_BASE` | 1,000,000 | 10^USD_DECIMALS — base unit |
| `PROTOCOL_MODE_ALL` | 0 | All protocols allowed |
| `PROTOCOL_MODE_ALLOWLIST` | 1 | Only listed protocols |
| `PROTOCOL_MODE_DENYLIST` | 2 | All except listed protocols |
| `JUPITER_PROGRAM` | `JUP6Lkb...` | Jupiter aggregator program |
| `FLASH_TRADE_PROGRAM` | `FLASH6Lo...` | Flash Trade perpetuals program |
| `JUPITER_LEND_PROGRAM` | `JLend2f...` | Jupiter Lend program |
| `JUPITER_EARN_PROGRAM` | `jup3YeL...` | Jupiter Earn program |
| `JUPITER_BORROW_PROGRAM` | `jupr81Y...` | Jupiter Borrow program |
| `MAX_AGENTS_PER_VAULT` | 10 | Max agents per vault |
| `FULL_PERMISSIONS` | `(1u64 << 21) - 1` | All 21 permission bits set |
| `MAX_ESCROW_DURATION` | 2,592,000 | 30 days in seconds |
| `FINALIZE_SESSION_DISCRIMINATOR` | `[...]` | Extracted constant for finalize_session check |

## x402 Payment Flow

SDK provides `shieldedFetch()` for HTTP 402 payment:
1. Client requests resource → server returns 402 with `PaymentRequirements`
2. `selectPaymentOption()` picks best payment method
3. `evaluateX402Payment()` checks against spending policies
4. `buildX402TransferInstruction()` creates Solana transfer
5. Client retries with `X-PAYMENT` header → server verifies and returns resource

Dependency: `@x402/core` for types/encoding.

## Multi-Sig Governance

Sigil does not implement on-chain multi-sig. Instead, it composes
with external multi-sig programs (recommended: Squads V4).

**How it works:**
1. Set `vault.owner` to a Squads V4 multisig PDA
2. All owner actions (policy changes, agent management, withdrawals)
   require threshold signing through Squads before reaching Sigil
3. Sigil checks `owner.key == vault.owner` -- the Solana runtime
   guarantees this signature is valid

**Combined with timelock:**
- Policy changes require timelock_duration to elapse
- Squads threshold signing adds a second governance layer
- Result: no single person can change policy without both threshold
  approval AND waiting the timelock period
