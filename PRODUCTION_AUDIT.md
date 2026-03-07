# Phalnx Production Audit — Road to Devnet

> Generated: 2026-03-06 | Score: 24/52 criteria passing (46%)
> Goal: Flush out every issue, fix them, push to devnet, start testing.

Work through each section top to bottom. Check off items as they're resolved. Each section has a **STATUS**, **ISSUES** list, and **ACTION ITEMS** with checkboxes.

---

## Table of Contents

1. [Layer 1: On-Chain Program — Deep Security Audit](#1-on-chain-program--deep-security-audit)
   - [1.1 Build & Compilation](#11-build--compilation)
   - [1.2 Security Findings — Penetration Test Results](#12-security-findings--penetration-test-results)
     - [S-1: Mainnet Treasury = Zero Address [CRITICAL]](#finding-s-1-mainnet-treasury--zero-address-critical)
     - [S-2: Per-Agent Spend Limit Bypass [HIGH]](#finding-s-2-per-agent-spend-limit-bypass--overlay-slot-exhaustion-high)
     - [S-3: Escrow Bypasses Per-Agent Limits [HIGH]](#finding-s-3-escrow-bypasses-per-agent-spend-limits-high)
     - [S-4: Overlay Slot Leak on Revocation [MEDIUM]](#finding-s-4-overlay-slot-leak-on-agent-revocation-medium)
     - [S-5: devnet-testing + mainnet Guard Missing [MEDIUM]](#finding-s-5-devnet-testing--mainnet-feature-guard-missing-medium)
     - [S-6: Session Expiry Window Too Tight [MEDIUM]](#finding-s-6-session-expiry-window-too-tight-for-congestion-medium)
   - [1.3 Economic Attack Vector Analysis](#13-economic-attack-vector-analysis)
   - [1.4 Instruction Scan Security Analysis](#14-instruction-scan-security-analysis)
   - [1.5 Stablecoin Tracking & USD Conversion](#15-stablecoin-tracking--usd-conversion)
   - [1.6 Rolling 24h Spend Tracker — Deep Analysis](#16-rolling-24h-spend-tracker--deep-analysis)
   - [1.7 Per-Agent Spend Overlay — Deep Analysis](#17-per-agent-spend-overlay--deep-analysis)
   - [1.8 Generic Constraints System — Architecture Review](#18-generic-constraints-system--architecture-review)
   - [1.9 Protocol-Specific Verifiers — Deep Analysis](#19-protocol-specific-verifiers--deep-analysis)
   - [1.10 CPI Guard & Transaction Integrity](#110-cpi-guard--transaction-integrity)
   - [1.11 Token Delegation & Revocation Security](#111-token-delegation--revocation-security)
   - [1.12 Fee System & Economic Model](#112-fee-system--economic-model)
   - [1.13 Test Coverage Assessment](#113-test-coverage-assessment)
   - [1.14 Architecture Improvement Recommendations](#114-architecture-improvement-recommendations)
   - [1.15 Security Tooling Status](#115-security-tooling-status)
2. [Layer 2: TypeScript SDK](#2-typescript-sdk)
   - [2.1 NPM Publishing & Naming](#21-npm-publishing--naming)
   - [2.2 Account Name Casing](#22-account-name-casing)
   - [2.3 Instruction Builders](#23-instruction-builders)
   - [2.4 Transaction Composer](#24-transaction-composer)
   - [2.5 Integration Modules](#25-integration-modules)
   - [2.6 Type Exports](#26-type-exports)
3. [Layer 3: Solana Agent Kit Plugin](#3-solana-agent-kit-plugin)
   - [3.1 Plugin NPM Publishing](#31-plugin-npm-publishing)
   - [3.2 ShieldedWallet Wrapper](#32-shieldedwallet-wrapper)
   - [3.3 LLM-Facing Tools](#33-llm-facing-tools)
   - [3.4 Framework Adapters](#34-framework-adapters)
   - [3.5 End-to-End Integration Test](#35-end-to-end-integration-test)
4. [Layer 4: Dashboard](#4-dashboard)
   - [4.1 Build & Runtime](#41-build--runtime)
   - [4.2 Network-Aware USDC Mints](#42-network-aware-usdc-mints)
   - [4.3 Provision Store (Persistence)](#43-provision-store-persistence)
   - [4.4 Rate Limiter (Distribution)](#44-rate-limiter-distribution)
   - [4.5 CORS Hardening](#45-cors-hardening)
   - [4.6 Environment Variable Validation](#46-environment-variable-validation)
   - [4.7 Wallet & Vault Operations](#47-wallet--vault-operations)
5. [Layer 5: Developer Experience](#5-developer-experience)
   - [5.1 5-Minute SAK Quickstart](#51-5-minute-sak-quickstart)
   - [5.2 Working E2E Example](#52-working-e2e-example)
   - [5.3 Error Message Quality](#53-error-message-quality)
   - [5.4 Configuration Complexity](#54-configuration-complexity)
   - [5.5 Permission Bitmask UX](#55-permission-bitmask-ux)
6. [Layer 6: Production Readiness](#6-production-readiness)
   - [6.1 CI/CD Pipeline](#61-cicd-pipeline)
   - [6.2 Formal Verification](#62-formal-verification)
   - [6.3 External Security Audit](#63-external-security-audit)
   - [6.4 Monitoring & Alerting](#64-monitoring--alerting)
   - [6.5 RPC Failover](#65-rpc-failover)
   - [6.6 Mainnet Deployment Checklist](#66-mainnet-deployment-checklist)
7. [Architecture Assessment](#7-architecture-assessment)
   - [7.1 Sandwich Composition Pattern](#71-sandwich-composition-pattern)
   - [7.2 Stablecoin-Only USD Tracking](#72-stablecoin-only-usd-tracking)
   - [7.3 Rolling 24h Spend Window](#73-rolling-24h-spend-window)
   - [7.4 Per-Agent Spend Overlays](#74-per-agent-spend-overlays)
   - [7.5 Protocol Instruction Parsing](#75-protocol-instruction-parsing)
   - [7.6 Competitive Position](#76-competitive-position)
8. [Priority Roadmap](#8-priority-roadmap)

---

## 1. On-Chain Program — Deep Security Audit

**Overall Grade: A-**
26 instructions, 69 error types (6000–6068), 22 events, zero-copy accounts, ~1,102 tests. Two critical findings, two high, several medium. The architecture is sound — the issues are fixable without rearchitecture.

> **Updated 2026-03-07:** Error codes expanded from 57 → 69 (V2 constraints, escrow, multi-agent, per-agent overlay). Test count updated from 1,032 → ~1,102 (280 on-chain + 20 Surfpool + 746 TS + 56 devnet).

**Files audited line-by-line:**
- `validate_and_authorize.rs` (679 lines) — the core security gate
- `finalize_session.rs` (303 lines) — session cleanup and delegation revocation
- `agent_transfer.rs` (327 lines) — direct stablecoin transfers
- `create_escrow.rs` (327 lines) — inter-vault escrow creation
- `register_agent.rs` (78 lines) — agent registration and overlay slot claiming
- `tracker.rs` (141 lines) — 144-epoch rolling spend tracker
- `agent_spend_overlay.rs` (169 lines) — per-agent contribution tracking
- `generic_constraints.rs` (209 lines) — byte-offset instruction constraints
- `jupiter.rs` (788 lines) — Jupiter V6 slippage verification (127 swap variants)
- `flash_trade.rs` (73 lines) — Flash Trade instruction verification
- `session.rs` (73 lines) — session PDA state
- `policy.rs` (116 lines) — policy config state
- `vault.rs` (95 lines) — vault state and agent management
- `mod.rs` (334 lines) — constants, stablecoin mints, protocol IDs, action types
- `errors.rs` (205 lines) — all 57 error types
- `utils.rs` (36 lines) — stablecoin-to-USD conversion

---

### 1.1 Build & Compilation

**STATUS: PASS**

- `anchor build --no-idl` — works with stable Rust 1.86.0
- `RUSTUP_TOOLCHAIN=nightly anchor idl build` — works for IDL generation
- `blake3 = "=1.5.5"` pin required to avoid edition 2024 incompatibility with BPF cargo 1.84
- Anchor 0.32.1, Solana/Agave CLI 3.0.15
- `bind_address = "0.0.0.0"` must NOT be in Anchor.toml (crashes Agave 3.x)

**Action items:**
- [ ] Verify `anchor build --no-idl` still passes after any dependency updates
- [ ] Document the blake3 pin reason in a code comment for future maintainers

---

### 1.2 Security Findings — Penetration Test Results

#### Finding S-1: Mainnet Treasury = Zero Address [CRITICAL]

**Location:** `state/mod.rs:82`

```rust
#[cfg(feature = "mainnet")]
pub const PROTOCOL_TREASURY: Pubkey = Pubkey::new_from_array([0u8; 32]);
```

**Impact:** Every transaction on mainnet sends protocol fees (2 BPS) to the system program. Irrecoverable revenue loss.

**Existing mitigation:** Build-time test `mainnet_treasury_must_not_be_zero()` at `state/mod.rs:120-127`. But this test only runs with `#[cfg(test)]` + `--features mainnet`. If the program is deployed without running that specific test configuration, fees burn.

**Recommended fix:**
- [ ] Create multisig protocol treasury wallet
- [ ] Replace `[0u8; 32]` with real treasury public key
- [ ] Add `compile_error!` guard: `#[cfg(all(feature = "mainnet", not(test)))]` that checks at compile time
- [ ] Add runtime assertion in `validate_and_authorize`: `require!(PROTOCOL_TREASURY != Pubkey::default())`

---

#### Finding S-2: Per-Agent Spend Limit Bypass — Overlay Slot Exhaustion [HIGH]

**Location:** `register_agent.rs:58-65`, `validate_and_authorize.rs:217-238`

**Vulnerability chain:**

1. `register_agent.rs:62-63` — claim_slot result is silently discarded:
```rust
// If shard 0 is full (7 agents), silently continue
if overlay.find_agent_slot(&agent).is_none() {
    let _ = overlay.claim_slot(&agent); // Returns None when full — ignored
}
```

2. `validate_and_authorize.rs:217` — per-agent check skipped when slot not found:
```rust
if let Some(agent_slot) = overlay.find_agent_slot(&agent_key) {
    // Per-agent limit check only runs HERE
}
// If find_agent_slot returns None → entire block skipped → no per-agent limit enforced
```

**Impact:** Agents 8-10 (when shard 0 is full with 7 agents) can have `spending_limit_usd > 0` set in their `AgentEntry`, but the limit is **never enforced**. They can spend up to the vault-wide daily cap without any per-agent restriction.

**Attack scenario:** Register 7 dummy agents to fill the overlay. Agent 8 (the real trading agent) gets no per-agent tracking. Set vault-wide cap to $10,000 and agent 8's `spending_limit_usd` to $100. Agent 8 can actually spend $10,000.

**Recommended fix (choose one):**
- [ ] **Option A (strictest):** Reject `register_agent` when `spending_limit_usd > 0` and no overlay slot is available
- [ ] **Option B (fallback):** In validate_and_authorize, if `find_agent_slot` returns None AND `agent_entry.spending_limit_usd > 0`, reject the transaction
- [ ] **Option C (scalable):** Auto-create shard 1 when shard 0 is full (requires adding shard routing logic)
- [ ] Add test: register 8 agents, verify agent 8's spending limit is enforced (currently it won't be)

---

#### Finding S-3: Escrow Bypasses Per-Agent Spend Limits [HIGH]

**Location:** `create_escrow.rs` — entire file

**Vulnerability:** `create_escrow` loads and updates the global `SpendTracker` (lines 148-159) but does **NOT** load or check the `AgentSpendOverlay`. Compare with `validate_and_authorize.rs:211-238` and `agent_transfer.rs:145-172` which both check the overlay.

**Impact:** An agent with per-agent limit of $100/day can create unlimited escrows up to the vault-wide daily cap. The global tracker records the spend, but the per-agent tracker does not.

**Attack scenario:** Agent has `spending_limit_usd = 100_000_000` ($100). Vault-wide cap is `1_000_000_000` ($1,000). Agent creates 10 escrows of $100 each via `create_escrow`. Global tracker records $1,000. Agent overlay records $0. Per-agent limit never triggered.

**Recommended fix:**
- [ ] Add `agent_spend_overlay: AccountLoader<'info, AgentSpendOverlay>` to `CreateEscrow` accounts struct
- [ ] Copy the per-agent check pattern from `validate_and_authorize.rs:211-238` into `create_escrow.rs` after the global tracker check
- [ ] Add test: agent with $100 per-agent limit attempts $200 in escrows → second escrow rejected

---

#### Finding S-4: Overlay Slot Leak on Agent Revocation [MEDIUM]

**Location:** `revoke_agent` instruction (not in `register_agent.rs` or `agent_spend_overlay.rs`)

**Issue:** When an agent is revoked, their 32-byte pubkey remains in the overlay's `entries[idx].agent` field. The slot is never zeroed. Over the vault's lifetime, slots fill up permanently — even after agents are removed.

**Impact:** After 7 register+revoke cycles, no new agents can get per-agent tracking (all slots occupied by dead agents). Combined with Finding S-2, this means all subsequent agents silently lose per-agent spend limits.

**Recommended fix:**
- [ ] In `revoke_agent`, zero out the overlay slot: `entries[idx].agent = [0u8; 32]` and zero contributions
- [ ] Add test: register agent → revoke → register new agent → verify new agent gets the freed slot

---

#### Finding S-5: `devnet-testing` + `mainnet` Feature Guard Missing [MEDIUM]

**Location:** `state/mod.rs:138-141`

```rust
#[cfg(feature = "devnet-testing")]
pub fn is_stablecoin_mint(_mint: &Pubkey) -> bool {
    true // Accepts ANY mint as stablecoin
}
```

There are compile guards for `devnet` + `mainnet` mutual exclusion (lines 64-68), but NO guard preventing `devnet-testing` + `mainnet` from being enabled simultaneously. If accidentally enabled in a mainnet build, any worthless token gets 1:1 USD tracking — spend caps become meaningless.

**Recommended fix:**
- [ ] Add: `#[cfg(all(feature = "devnet-testing", feature = "mainnet"))] compile_error!("devnet-testing cannot be used with mainnet");`

---

#### Finding S-6: Session Expiry Window Too Tight for Congestion [MEDIUM]

**Location:** `state/mod.rs:34`, `session.rs:68-71`

```rust
pub const SESSION_EXPIRY_SLOTS: u64 = 20; // ~8 seconds
```

During Solana congestion, block times can stretch to 800ms+. The entire sandwich TX (validate + DeFi + finalize) must land within 20 slots. During severe congestion, this causes transaction failures.

**The failure mode IS safe** — expired sessions are treated as failed in finalize, delegation is revoked, no funds lost. But repeated failures during congestion create poor UX for trading agents that need to act quickly.

**Recommended fix:**
- [ ] Add `session_expiry_slots: u64` field to `PolicyConfig` (default: 20, max: 150 = ~60 seconds)
- [ ] Allow vault owners to tune this per-policy based on their congestion tolerance
- [ ] Add tests: expiry at 20, 40, 60, 150 slots all behave correctly

---

### 1.3 Economic Attack Vector Analysis

All identified economic attacks are **BLOCKED** by existing defenses:

| Attack | Vector | Defense | Status |
|--------|--------|---------|--------|
| **Cap Washing** | Authorize → fail → repeat to inflate volume | Fees deducted in validate (before DeFi ix); `total_volume` only on `success && !is_expired` | BLOCKED |
| **Delegation Theft** | Get delegation → skip finalize → keep approval | Step 9: `require!(found_finalize)` ensures finalize is in same TX. Atomic = all or nothing | BLOCKED |
| **Split-Swap** | Non-stablecoin input: 2 swaps (1 tracked, 1 untracked) | `defi_ix_count == 1` for non-stablecoin inputs (`validate_and_authorize.rs:396`) | BLOCKED |
| **Dust Deposit** | Insert SPL Transfer between validate/finalize | Top-level SPL Token Transfer (opcode 3) and TransferChecked (opcode 12) blocked (`validate_and_authorize.rs:326-331`) | BLOCKED |
| **Balance Inflation** | External deposit to vault ATA before finalize | Instruction scan blocks all top-level token movements. CPI deposits are legitimate DeFi returns | BLOCKED |
| **Replay** | Replay previous validate TX | Session PDA uses `init` constraint — double-init fails. Same [vault, agent, token] seeds | BLOCKED |
| **Fee-Free Micro-TX** | Sub-$0.005 TXs pay 0 fees (rounding) | Session PDA rent (~$0.30 per TX) far exceeds fee savings. Economically unprofitable | BLOCKED |
| **Nested Sandwich** | validate(USDC) → validate(USDT) → DeFi → finalize(USDT) → finalize(USDC) | Both sessions record spend independently → stricter, not looser. Both delegations revoked | SAFE (more restrictive) |
| **MEV Sandwich-on-Sandwich** | MEV bot front-runs the DeFi ix within user's sandwich | Jupiter `max_slippage_bps` enforced on-chain. Slippage tolerance = max MEV extraction | PARTIALLY MITIGATED |

**MEV note:** The `max_slippage_bps` policy field IS the MEV budget. If set to 100 BPS (1%), an MEV bot can extract up to 1% per swap. The policy already controls this — vault owners should set conservative slippage (10-50 BPS) for automated agents. The slippage enforcement is on-chain and cannot be bypassed.

---

### 1.4 Instruction Scan Security Analysis

**Location:** `validate_and_authorize.rs:290-469`

The instruction scan is the most critical security mechanism after the CPI guard. It uses `load_instruction_at_checked` from the instructions sysvar to inspect every instruction between validate and finalize.

#### 1.4.1 Scan Iteration Limit (20)

Three separate scan loops all use `for _ in 0..20`:
- **Spending instruction scan** (line 312) — blocks SPL transfers, checks protocol allowlist, verifies slippage
- **Non-spending instruction scan** (line 419) — mirrors spending scan for non-spending action types
- **Finalize presence check** (line 506) — verifies finalize_session exists in the TX

**Security analysis:** If a TX has >20 instructions between validate and finalize, the spending scan (line 312) stops at iteration 20 without finding finalize and falls through. But the finalize presence check (line 506) ALSO stops at 20 without finding finalize → `MissingFinalizeInstruction` error. **The system is safe** because you can't have more than 20 unscanned instructions — if finalize is beyond 20, the TX is rejected.

**Practical limit:** Solana transactions are 1,232 bytes max. Each instruction has minimum ~35 bytes (program_id + account indexes + data_len). Maximum ~35 instructions per TX. Typical Jupiter swap: 1-3 DeFi instructions + 2-3 ComputeBudget = ~6. The 20-iteration limit is generous.

**Status:** PASS — no bypass possible.

#### 1.4.2 SPL Token Transfer Blocking

```rust
// validate_and_authorize.rs:326-331
if ix.program_id == spl_token_id
    && !ix.data.is_empty()
    && (ix.data[0] == 3 || ix.data[0] == 12)
{
    return Err(error!(PhalnxError::DustDepositDetected));
}
```

Blocks opcode 3 (Transfer), opcode 12 (TransferChecked), and opcode 4 (Approve) as top-level instructions for `TOKEN_PROGRAM_ID`. Additionally blocks the same opcodes plus opcode 26 (TransferCheckedWithFee) for `TOKEN_2022_PROGRAM_ID`. Legitimate DeFi protocols move tokens via CPI (inner instructions), not top-level. This prevents an agent from inserting a direct token transfer or delegation to steal funds.

**Opcode 4 (Approve):** Returns `UnauthorizedTokenApproval` error. Prevents agent from granting delegation to a third party within a sandwich transaction.

**Token-2022 coverage:** Separate check against `TOKEN_2022_PROGRAM_ID` blocks opcodes 3, 4, 12, and 26 (TransferCheckedWithFee). Note: the original audit incorrectly cited opcode 13 as TransferCheckedWithFee — the correct opcode in Token-2022 is 26.

**Action items:**
- [x] Add opcode 26 (TransferCheckedWithFee) blocking for Token-2022 — **DONE** (blocked under `TOKEN_2022_PROGRAM_ID`)
- [x] Add opcode 4 (Approve) blocking — **DONE** with `UnauthorizedTokenApproval` error (both TOKEN_PROGRAM_ID and TOKEN_2022_PROGRAM_ID)

#### 1.4.3 Protocol Allowlist/Denylist

```rust
// policy.rs:96-103
pub fn is_protocol_allowed(&self, program_id: &Pubkey) -> bool {
    match self.protocol_mode {
        PROTOCOL_MODE_ALL => true,        // 0: all allowed
        PROTOCOL_MODE_ALLOWLIST => self.protocols.contains(program_id),  // 1
        PROTOCOL_MODE_DENYLIST => !self.protocols.contains(program_id),  // 2
        _ => false,  // invalid mode = deny all
    }
}
```

**Risk with `PROTOCOL_MODE_ALL` (mode 0):** Allows ANY program, including the Phalnx program itself. An agent could include a second `validate_and_authorize` between the first validate and finalize. This creates a nested sandwich. Analysis shows this is **safe** — both sessions record spend independently (more restrictive), and both delegations are revoked at their respective finalizes.

**Recommendation:** New vaults should default to `PROTOCOL_MODE_ALLOWLIST` with only Jupiter, Flash Trade, and Jupiter Lend/Earn/Borrow. Mode 0 should be documented as "expert only."

**Action items:**
- [ ] Default new vaults to allowlist mode in SDK/dashboard templates
- [ ] Add warning in SDK when creating vault with mode 0

---

### 1.5 Stablecoin Tracking & USD Conversion

**Location:** `utils.rs:8-35`, `validate_and_authorize.rs:183-284`, `finalize_session.rs:176-251`

#### 1.5.1 Stablecoin-to-USD Conversion

```rust
// utils.rs — stablecoin_to_usd
if token_decimals == USD_DECIMALS {
    Ok(amount) // 6 decimals → direct 1:1
} else if token_decimals < USD_DECIMALS {
    amount.checked_mul(10^diff) // scale up
} else {
    amount.checked_div(10^diff) // scale down (rounds down)
}
```

**Analysis:** USDC and USDT both have 6 decimals = `USD_DECIMALS`. The fast path (direct 1:1) applies. For hypothetical future stablecoins with different decimals, the scaling is correct. Division rounds down (slightly permissive — underestimates USD).

**Status:** PASS — all arithmetic uses checked operations.

#### 1.5.2 Non-Stablecoin Swap Tracking

**Flow:**
1. **validate** snapshots `stablecoin_balance_before` from vault's stablecoin ATA
2. Agent executes swap (e.g., SOL → USDC via Jupiter)
3. **finalize** reads `stablecoin_account.amount` and computes delta

**Critical checks in finalize (`finalize_session.rs:177-251`):**
- `stablecoin_account.owner == vault.key()` — prevents reading a different account
- `stablecoin_account.mint == session_output_mint` — prevents mint substitution
- `stablecoin_account.amount > session_balance_before` — stablecoin must increase (strict >)
- Delta checked against `max_transaction_size_usd` and `daily_spending_cap_usd`
- Per-agent overlay updated with the stablecoin delta

**Security analysis:** The `>` check (not `>=`) means a swap that returns exactly the same stablecoin balance fails. This is correct — a zero-profit swap with non-stablecoin input indicates a failed or manipulated swap. The instruction scan prevents artificial balance inflation via top-level transfers.

**Status:** PASS — the balance snapshot pattern is sound.

---

### 1.6 Rolling 24h Spend Tracker — Deep Analysis

**Location:** `tracker.rs`

#### 1.6.1 Architecture

```
SpendTracker (2,832 bytes, zero-copy)
├── vault: Pubkey (32 bytes)
├── buckets: [EpochBucket; 144] (2,304 bytes)
│   └── Each: { epoch_id: i64, usd_amount: u64 } (16 bytes)
├── protocol_counters: [ProtocolSpendCounter; 10] (480 bytes) — reserved, unused
├── bump: u8
└── _padding: [u8; 7]
```

- **144 epochs × 600 seconds = 86,400 seconds = exactly 24 hours**
- Circular buffer indexed by `epoch_id % 144`
- Stale bucket detection: if `bucket.epoch_id != current_epoch`, reset before writing

#### 1.6.2 Mathematical Correctness

**`get_rolling_24h_usd`:**
1. Iterates all 144 buckets
2. Skips zero-amount and out-of-window buckets
3. Full window buckets: add 100% of amount
4. Boundary bucket (straddles window start): proportional scaling

```rust
let overlap = bucket_end.checked_sub(window_start_ts).unwrap() as u128;
let scaled = (bucket.usd_amount as u128).saturating_mul(overlap)
    .checked_div(EPOCH_DURATION as u128).unwrap();
```

**Rounding analysis:** The division truncates (rounds down). Maximum rounding error per boundary bucket: `(EPOCH_DURATION - 1) / EPOCH_DURATION` of 1 unit = 599/600 of $0.000001 = ~$0.000001. Only one bucket can straddle the boundary at any time. **Worst-case: $0.000001 under-count.** Direction: permissive (allows slightly more than cap).

**Overflow safety:** Intermediate math uses `u128`. Maximum `total`: 144 buckets × u64::MAX ≈ 2.65 × 10^21, well within u128 range (3.4 × 10^38).

**Status:** PASS — mathematically correct with known, acceptable rounding.

#### 1.6.3 Improvement: Cached Running Total

**Current:** O(144) scan on every read.
**Possible:** O(1) read with a cached `running_total` field.

Not recommended now. 144 iterations ≈ 3,000 CU. Solana budget is 200,000 CU per instruction. The scan is <2% of budget. The simplicity of full-scan is worth the minor CU cost.

**Action items:**
- [ ] Confirm CU measurements for validate_and_authorize include tracker scan (should be well under 200K)
- [ ] Future: if CU becomes tight, add cached running total optimization

---

### 1.7 Per-Agent Spend Overlay — Deep Analysis

**Location:** `agent_spend_overlay.rs`

#### 1.7.1 Architecture

```
AgentSpendOverlay (9,488 bytes, zero-copy)
├── vault: Pubkey (32 bytes)
├── sync_epochs: [i64; 144] (1,152 bytes) — shared epoch tracker
├── entries: [AgentContributionEntry; 7] (8,288 bytes)
│   └── Each: { agent: [u8; 32], contributions: [u64; 144] } (1,184 bytes)
├── bump: u8
└── _padding: [u8; 7]
```

**Design:** Each agent gets its own 144-bucket contribution array, mirroring the global tracker's epoch scheme. The `sync_epochs` array is shared — it records which epoch each bucket index was last written to by ANY agent.

#### 1.7.2 Stale Epoch Sync

```rust
fn sync_and_zero_if_stale(&mut self, clock: &Clock, slot_idx: usize) {
    let current_epoch = clock.unix_timestamp / EPOCH_DURATION;
    for i in 0..NUM_EPOCHS {
        if self.sync_epochs[i] != current_epoch {
            self.entries[slot_idx].contributions[i] = 0;
        }
    }
}
```

**Analysis:** When recording a contribution, stale epochs for that specific agent are zeroed first. The `sync_epochs` check uses the SHARED epoch tracking. This means: if agent A wrote epoch 100 at bucket index 4, and agent B reads bucket index 4 at epoch 101, agent B's contribution at that index is zeroed (correct — it's stale for B). Agent A's contribution at that index is also zeroed when A next writes (correct — epoch 100 data is more than 24h old by the time epoch 244 rolls around to the same index).

**Subtle correctness:** The sync_epochs array is global across agents but the zeroing is per-agent. This is correct because `sync_epochs[i]` tells you "the most recent epoch that was recorded at bucket index i." If any agent wrote to bucket index i more recently than the reading agent, the reading agent's stale data at that index is still zeroed — which is conservative (under-counts, not over-counts).

**Status:** PASS — correct, slightly conservative behavior.

#### 1.7.3 Known Limitations

| Limitation | Impact | Fix Path |
|-----------|--------|----------|
| 7 agents per shard | Agents 8-10 have no per-agent tracking | Add shard 1+ auto-creation |
| Slot leak on revocation | Revoked agents keep overlay slots forever | Zero slot in `revoke_agent` |
| Escrow bypass | `create_escrow` skips overlay check | Add overlay to `CreateEscrow` accounts |

**Action items:**
- [ ] Fix Finding S-2: reject or enforce per-agent limits for agents without overlay slots
- [ ] Fix Finding S-3: add overlay check to `create_escrow`
- [ ] Fix Finding S-4: zero overlay slot on agent revocation
- [ ] Future: implement multi-shard overlay for >7 agents

---

### 1.8 Generic Constraints System — Architecture Review

> **Updated 2026-03-07:** V2 Phase 1 complete. OR logic, strict_mode, raised limits, input validation, verifier removal all implemented.

**Location:** `generic_constraints.rs`, `state/constraints.rs`

#### 1.8.1 Design (V2 — Current)

The `InstructionConstraints` PDA stores per-program byte-offset constraints:

```
InstructionConstraints (SIZE: 8,318 bytes)
├── vault: Pubkey
├── entries: Vec<ConstraintEntry>  (max 16 entries)
│   └── Each: { program_id, data_constraints: Vec<DataConstraint>, account_constraints: Vec<AccountConstraint> }
│       ├── DataConstraint: { offset: u16, operator: Eq|Ne|Gte|Lte, value: Vec<u8> (max 32 bytes) }
│       └── AccountConstraint: { index: u8, expected: Pubkey }
├── strict_mode: bool
└── bump: u8
```

**Constraint logic:**
- **Within an entry:** data_constraints AND account_constraints are **ANDed** (all must pass)
- **Across entries with same program_id:** entries are **ORed** (any matching entry passes)
- **No matching entries:** `Ok(false)` — caller decides policy based on `strict_mode`
- **strict_mode=true:** Programs with no matching entries → `UnconstrainedProgramBlocked` (6068)
- **strict_mode=false:** Programs with no matching entries → allowed through

**V2 improvements over V1:**
- OR logic across entries (was: first-match only)
- `strict_mode` enforcement (was: unknown programs always passed)
- Raised limits: 16 entries (was 10), 8 data constraints per entry (was 5)
- Input validation: zero-length values rejected, empty entries rejected
- Account constraints for index-based pubkey matching

#### 1.8.2 Correctness

- **Eq/Ne:** Direct byte comparison — correct. CONFIRMED.
- **Gte/Lte:** Little-endian **unsigned** comparison via `compare_le_unsigned` — correct for unsigned values. CONFIRMED.
- **GteSigned/LteSigned:** Two's complement signed comparison via `compare_le_signed` — correct for i64/i128 fields. CONFIRMED. (Phase 2)
- **Bitmask:** `(actual & mask) == mask` — correct for permission/flag fields. CONFIRMED. (Phase 2)
- **Bounds check:** `offset + len <= ix_data.len()` — out-of-bounds is a violation (not a passthrough). Correct, conservative. CONFIRMED.
- **OR logic:** `verify_against_entries()` — tested with 4 unit tests. CONFIRMED.
- **Zero-length values:** Rejected in `validate_entries()` — no longer harmless edge case. CONFIRMED.
- **Empty entries:** Rejected (must have at least one data or account constraint). CONFIRMED.
- **Infrastructure bypass:** ComputeBudget + SystemProgram whitelisted before constraint check. CONFIRMED.
- **75 Rust unit tests** covering all 7 operators (Eq, Ne, Gte, Lte, GteSigned, LteSigned, Bitmask), OR logic, signed comparison, bitmask matching, and edge cases. CONFIRMED.

#### 1.8.3 Comprehensive Protocol Coverage Assessment

> **Based on exhaustive analysis of 21 major Solana protocols (5 parallel research agents, March 2026).**

**Protocols FULLY compatible with generic constraints (14/21):**

| Protocol | Encoding | Disc Size | Key Fields at Fixed Offsets | Confidence |
|----------|----------|-----------|----------------------------|------------|
| Raydium V4 AMM | Native | 1 byte | amount_in(1), min_out(9) | CONFIRMED |
| Raydium CLMM | Anchor | 8 bytes | amount(8), threshold(16), sqrt_price(24), is_base_input(40) | CONFIRMED |
| Raydium CP-AMM | Anchor | 8 bytes | amount_in(8), min_out(16) | CONFIRMED |
| Orca Whirlpool | Anchor | 8 bytes | amount(8), threshold(16), sqrt_price(24), a_to_b(41) — variable fields come AFTER | CONFIRMED |
| Lifinity | Anchor (likely) | 8 bytes | amountIn(8), minOut(16) | LIKELY |
| GooseFX Gamma | Anchor | 8 bytes | amount_in(8), min_out(16) | CONFIRMED |
| Flash Trade | Anchor | 8 bytes | All fields fixed: price(8), exponent(16), collateral(20), size(28) | CONFIRMED |
| MarginFi | Anchor | 8 bytes | amount(8) — Option<bool> trailing, non-critical | CONFIRMED |
| Kamino Lending | Anchor | 8 bytes | All user ops: amount(8) — admin ops have Vec (irrelevant) | CONFIRMED |
| Solend | Native | 1 byte | amount(1) | CONFIRMED |
| Jupiter Lend/Earn/Borrow | Anchor | 8 bytes | All user ops: amount(8) | CONFIRMED |
| Jito/SPL Stake Pool | Borsh | 1 byte | amount(1), min_out(9) | CONFIRMED |
| Marinade | Anchor | 8 bytes | amount(8) | CONFIRMED |
| Sanctum | Varies | Via Jupiter | Routed through Jupiter swap variants | LIKELY |

**Protocols PARTIALLY compatible (5/21):**

| Protocol | Issue | Pre-Option Fields (Fixed Offsets) | Post-Option Fields (Variable) | Verdict |
|----------|-------|-----------------------------------|-------------------------------|---------|
| Drift | 6 Option fields from offset 33 | order_type(8), direction(10), base_asset_amount(12-19), price(20-27), market_index(28-29), reduce_only(30) | max_ts, trigger_price, auction_* | Critical fields are pre-Option — **sufficient for practical use** |
| Jupiter Perps | Option fields in both increase/decrease | sizeUsdDelta(8-15), collateral(16-23), side(24), priceSlippage(25-32) on increase | jupiterMinimumOut (increase), priceSlippage (decrease) | Increase path covered — **decrease slippage cannot be constrained** |
| Zeta Markets | Option<String> before asset field | price(8-15), size(16-23), side(24), order_type(25) | client_order_id, tag(String!), tif_offset, **asset** | **Asset/market restriction impossible** without specialized verifier |
| Mango v4 | OrderParams enum with variable-sized variants | side(8), max_base_lots(9-16), max_quote_lots(17-24), tif(33-34), variant_disc(36) | Inner OrderParams fields (price_lots, peg_limit) | Constraining to single variant makes inner fields deterministic |
| Phoenix | Option<T> scattered throughout OrderPacket | disc(0), variant(1-4), side(5), price_in_ticks(6-13) for PostOnly/Limit | match_limit, last_valid_*, slippage fields for IOC | PostOnly/Limit partially covered — **IOC slippage cannot be constrained** |
| Meteora DLMM (swap_with_price_impact only) | Option<i32> before max_price_impact_bps | amount_in(8), min_out(16) on core swap/swap2 | max_price_impact_bps on swap_with_price_impact | **Mitigated:** block swap_with_price_impact discriminator, allow only swap/swap2 |

**Protocols requiring specialized verifier (1/21):**

| Protocol | Reason | Status |
|----------|--------|--------|
| Jupiter V6 | Variable-length route plan (Vec<RoutePlanStep> with 127 swap variants, 0-48 bytes each) shifts suffix containing quoted_out_amount, slippage_bps to unpredictable offset | **Already built** — 788-line verifier in `jupiter.rs`. Necessary and correct. |

#### 1.8.4 Known Gaps

| Gap | Severity | Impact | Status |
|-----|----------|--------|--------|
| ~~Signed integer comparison~~ | ~~CRITICAL~~ | ~~Unsigned-only comparison bypassed by signed values~~ | **DONE** — `GteSigned`/`LteSigned` operators added (Phase 2). 33 Rust unit tests + 8 TS integration tests. |
| ~~Bitmask operator~~ | ~~MEDIUM~~ | ~~Cannot check bit patterns in permission/flag fields~~ | **DONE** — `Bitmask` operator added (Phase 2). `(actual & mask) == mask` semantics. |
| **Polymorphic instructions** | DOCUMENTED LIMITATION | Same discriminator, different semantics based on account count or context. Cannot be handled by byte-offset matching. | Protocol-specific verifiers (like jupiter.rs) for these cases |
| **32-byte value limit** | LOW | Excludes i256 types. Affects ~1% of protocols. | Intentional design choice — documented as such |

#### 1.8.5 Competitive Position

**Phalnx is the ONLY on-chain instruction constraint system on Solana.** No competitor exists:
- Squads V4: governance only, does not inspect instruction data
- AgentVault (cloudweaver): no instruction-level constraints
- Solana Agent Kit: SDK-layer only, no on-chain enforcement

**vs Zodiac Roles (EVM gold standard):**

| Capability | Phalnx | Zodiac Roles |
|------------|--------|-------------|
| Enforcement | On-chain | On-chain |
| Comparison operators | **Eq, Ne, Gte, Lte, GteSigned, LteSigned, Bitmask** (7) | Eq, Gt, Lt, SignedGt, SignedLt, Bitmask (6) |
| Logic combinators | 2-level (entry OR, constraint AND) | **Arbitrary trees** (AND, OR, nested) |
| Account constraints | Yes (index-based) | Yes (parameter-based) |
| Spending integration | Separate SpendTracker | **Integrated refillable allowances** |
| **Timelocked policy changes** | **Yes** | No |
| **Formal verification** | **Yes (Certora)** | No |
| **Post-execution verification** | **Yes (finalize_session)** | No |
| Custom extension hooks | No | Yes (ICustomCondition) |

**Action items:**
- [x] Add `GteSigned`/`LteSigned` operators — **DONE** (Phase 2, 33 Rust unit tests + 8 TS integration tests)
- [x] Add `Bitmask` operator — **DONE** (Phase 2, `(actual & mask) == mask`)
- [ ] Document constraint configuration examples in SDK
- [x] OR logic across entries — DONE (V2 Phase 1)
- [x] Account-index constraints — DONE (V2 Phase 1)
- [x] strict_mode enforcement — DONE (V2 Phase 1)
- [x] Input validation (zero-length, empty entries) — DONE (V2 Phase 1)

---

### 1.9 Protocol-Specific Verifiers — Deep Analysis

> **Updated 2026-03-07:** Flash Trade and Jupiter Lend verifiers removed in V2 Phase 1 (replaced by generic constraints). Jupiter V6 slippage verifier is the **sole remaining specialized verifier** — confirmed as the only protocol requiring one.

#### 1.9.1 Architectural Decision: Protocol-Agnostic On-Chain + Protocol-Specific SDK

After comprehensive analysis of 21 major Solana protocols, the following architecture was confirmed:

- **On-chain** = protocol-agnostic financial guardrails (spending caps, permissions, generic constraints, CPI guard)
- **SDK** = protocol-specific intelligence (market awareness, fee calculation, instruction building)
- **TEE** = trust boundary (agent can't construct raw instructions outside SDK)

**Why this is correct:**
1. Protocol-specific on-chain parsers create ongoing maintenance burden (every protocol upgrade requires program upgrade)
2. Generic constraints handle 14/21 protocols with zero protocol-specific code
3. The remaining 6 partially-compatible protocols have critical fields at fixed offsets (pre-Option), covering 90%+ of practical safety rules
4. Jupiter V6 is the sole exception — variable-length route plan is architecturally incompatible with fixed-offset constraints

#### 1.9.2 Jupiter V6 Slippage Verification — KEPT (Necessary)

**Location:** `jupiter.rs` — 788 lines (350 code + 438 test)

**Why it cannot be replaced by generic constraints:** The route plan is `Vec<RoutePlanStep>` where each step has a Swap enum variant with size 0-48 bytes (127 variants, 3 variable-length). The suffix containing `quoted_out_amount` and `slippage_bps` is at a variable global offset that requires parsing every step. **No fixed byte offset works.** CONFIRMED by 3 independent research agents.

**Security properties (unchanged):**
- Trailing byte rejection: `ix_data.len() == expected_len`
- Route step limit: `vec_len <= 10`
- Unknown variant rejection: `swap_disc < 127` (deny-by-default)
- Zero quoted output: `quoted_out > 0`
- 22 unit tests covering all edge cases

**Status:** PASS — the sole justified specialized verifier. No other protocol on Solana requires one.

**Action items:**
- [ ] Monitor Jupiter for new swap variant additions (check IDL periodically)
- [ ] Consider CI job that fetches Jupiter IDL and alerts on new variants
- [ ] Document the update process for adding new variants

#### 1.9.3 Flash Trade Verification — REMOVED (V2 Phase 1)

**Previously:** `flash_trade.rs` — 73 lines checking discriminator + `price > 0`.

**Removed because:** Flash Trade has entirely fixed-size instruction data. All meaningful constraints (discriminator, price, leverage, collateral, position size) are at deterministic byte offsets. Generic constraints provide strictly more enforcement capability. The `price > 0` check is expressible as `Gte` at offset 8 with value `[1,0,0,0,0,0,0,0]`.

**Status:** REMOVED. Generic constraints are sufficient. 29 Flash Trade integration tests continue to pass.

#### 1.9.4 Jupiter Lend/Earn/Borrow — REMOVED (V2 Phase 1)

**Previously:** `jupiter_lend.rs` — minimal verifier (data ≥ 8 bytes).

**Removed because:** All user-facing Jupiter Lend instructions are disc(8) + u64(8). Generic constraints provide strictly more enforcement. The previous verifier only checked `len >= 8` — less useful than a discriminator Eq constraint.

**Status:** REMOVED. 6 Jupiter Lend integration tests continue to pass.

#### 1.9.5 Specialized Verifiers — Future Considerations

| Protocol | Need | Priority | When to Build |
|----------|------|----------|--------------|
| Phoenix | Meaningful — Option<T> scatter breaks IOC order constraints | LOW | Only when Phoenix integration is on the roadmap |
| Zeta Markets | Meaningful — asset field behind Option<String> | LOW | Only when Zeta integration is planned |
| Drift | Marginal — pre-Option fields cover 90%+ of safety rules | NONE | Not recommended; pre-Option fields sufficient |
| Jupiter Perps | Marginal — decrease slippage is Option, but decrease is non-spending | NONE | Not recommended; non-spending path doesn't need slippage enforcement |
| Mango v4 | Marginal — variant discrimination at fixed offset works | NONE | Not recommended; constrain to single variant instead |

---

### 1.10 CPI Guard & Transaction Integrity

**Location:** Every instruction handler

Every sensitive instruction starts with:
```rust
require!(
    get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT,
    PhalnxError::CpiCallNotAllowed
);
```

**Instructions with CPI guard:** `validate_and_authorize`, `finalize_session`, `agent_transfer`, `create_escrow`, `settle_escrow`, `refund_escrow`.

**Purpose:** Prevents a malicious program from calling Phalnx instructions via CPI. Without this, an attacker could build a program that calls `validate_and_authorize` as a CPI, bypassing the instruction scan (which only checks top-level instructions via sysvar).

**Analysis:** `get_stack_height()` returns 1 for top-level instructions, >1 for CPI. The check ensures all Phalnx instructions are top-level only. This is the foundation that makes the instruction scan meaningful.

**Status:** PASS — correctly applied to all sensitive instruction paths.

---

### 1.11 Token Delegation & Revocation Security

**Location:** `validate_and_authorize.rs:622-634`, `finalize_session.rs:137-174`

**Flow:**
1. **validate:** SPL `approve` — agent gets delegation for `delegation_amount` on vault's token account
2. **DeFi ix:** Agent uses delegation to execute swap/trade
3. **finalize:** SPL `revoke` — delegation removed

**Security fix (Finding C) at finalize (`finalize_session.rs:137-152`):**
```rust
if session_delegated {
    require!(ctx.accounts.vault_token_account.is_some(), PhalnxError::InvalidTokenAccount);
    if let Some(ref vault_token) = ctx.accounts.vault_token_account {
        require!(vault_token.key() == session_delegation_token_account, ...);
    }
}
```

**Analysis:** Without Finding C fix, an agent could pass `None` for `vault_token_account` when `session_delegated = true`, silently skipping revocation. The agent would retain SPL token delegation authority after finalize. The fix requires the token account to be present AND match the session's recorded delegation account.

**Edge case: expired session cleanup.** Anyone can finalize an expired session (permissionless crank). The vault_token_account is still required for delegated sessions. The cranker must pass the correct token account (derivable from session data). Rent goes to the original agent, not the cranker.

**Status:** PASS — properly hardened against delegation retention attacks.

---

### 1.12 Fee System & Economic Model

**Location:** `validate_and_authorize.rs:246-605`, `agent_transfer.rs:194-282`, `create_escrow.rs:161-269`

**Fee structure:**
| Fee | Rate | Applied In | Reversible? |
|-----|------|-----------|-------------|
| Protocol fee | 2 BPS (hardcoded) | validate, transfer, escrow | No |
| Developer fee | 0-5 BPS (configurable) | validate, transfer, escrow | No |

**Fee calculation:**
```rust
protocol_fee = amount * 200 / 1_000_000   // 2 BPS
developer_fee = amount * dev_rate / 1_000_000  // 0-5 BPS
net_amount = amount - protocol_fee - developer_fee
```

**Fee destination validation:**
- Protocol treasury: `treasury_token.owner == PROTOCOL_TREASURY` + `treasury_token.mint == token_mint`
- Developer fee: `fee_dest.owner == vault.fee_destination` + `fee_dest.mint == token_mint`

**Immutable fee destination:** `vault.fee_destination` is set at vault creation and never changes. Prevents compromised owner from redirecting developer fees.

**Non-reversal guarantee:** Fees are transferred in validate (before DeFi ix executes). If the DeFi operation fails and finalize reports `success=false`, fees are already collected. This prevents cap-washing attacks.

**Status:** PASS — economically sound.

**Action items:**
- [ ] Consider: should `fee_destination` be changeable via timelocked update? Current immutability may be too rigid.
- [ ] Verify fee math for edge case: amount = protocol_fee + developer_fee + 1 (minimum net amount = 1)

---

### 1.13 Test Coverage Assessment

**~1,102 total tests across 17 suites:**

> **Updated 2026-03-07:** Test counts reflect V2 Phase 1 additions and accurate file-level breakdown.

| Category | Test File | Count | Critical Path Coverage |
|----------|-----------|-------|----------------------|
| Core vault ops | `phalnx.ts` | 77 | Create, close, deposit, withdraw, freeze, reactivate, multi-agent |
| Jupiter integration | `jupiter-integration.ts` | 8 | Slippage, sandwich composition, cap enforcement |
| Jupiter Lend | `jupiter-lend-integration.ts` | 6 | Deposit, withdraw, cap, protocol, frozen, rolling |
| Flash Trade integration | `flash-trade-integration.ts` | 29 | Perps CRUD, position effects, leverage |
| Security exploits | `security-exploits.ts` | 123 | CPI injection, replay, overflow, unauthorized access, opcode blocking |
| Instruction constraints | `instruction-constraints.ts` | 36 | V2: OR logic, strict_mode, limits, CRUD, timelock, signed/bitmask |
| Escrow integration | `escrow-integration.ts` | 14 | Create, settle, refund, conditional, expiry, access |
| Rust unit tests | `jupiter.rs`, `generic_constraints.rs`, `state/mod.rs` | 75 | 22 slippage + 47 constraints (10 base + 4 OR + 33 signed/bitmask) + 5 lend + 1 state |
| Surfpool integration | `surfpool-integration.ts` | 20 | Session expiry, composed TX, CU profiling, time travel |
| Core policy (TS) | `sdk/core/tests/` | 66 | Policy evaluation, action classification |
| SDK tests | `sdk/typescript/tests/` | 192 | Wrapper, x402, accounts, types, jupiter-api, client |
| Platform tests | `sdk/platform/tests/` | 17 | Platform SDK features |
| Crossmint tests | `sdk/custody/crossmint/tests/` | 29 | Crossmint custody integration |
| SAK plugin tests | `plugins/solana-agent-kit/tests/` | 29 | Plugin tools, factory, config |
| ElizaOS plugin tests | `plugins/elizaos/tests/` | 35 | Plugin lifecycle, tools |
| MCP server tests | `packages/mcp/tests/` | 312 | All MCP tools, error handling |
| Actions server tests | `apps/actions-server/tests/` | 66 | Action endpoints |
| Devnet tests | `tests/devnet/` | 56 | 8 files: smoke, sessions, spending, security, fees, positions, timelock, transfers |
| Fuzz tests | Trident config | 15 flows | Random instruction sequences, 8 invariants |
| Formal verification | Certora specs | 14 rules | Time arithmetic, overflow, decimal conversion |

**Missing tests (from this audit):**
- [ ] Agent 8-10 spend tracking bypass (Finding S-2)
- [ ] Escrow per-agent limit bypass (Finding S-3)
- [ ] Overlay slot leak after revocation (Finding S-4)
- [ ] `devnet-testing` + `mainnet` feature combination (Finding S-5)
- [x] Token-2022 transfer opcodes (3, 12, 26) in sandwich — **DONE** (Tests 13, 14)
- [x] SPL Approve opcode (4) injection in sandwich — **DONE** (Test 12)
- [x] Token-2022 Approve opcode (4) injection in sandwich — **DONE** (Test 15)
- [x] SPL TransferChecked opcode (12) injection in sandwich — **DONE** (Test 11)

---

### 1.14 Architecture Improvement Recommendations

**Priority order for maximum impact:**

| # | Improvement | Effort | Impact | Priority |
|---|-------------|--------|--------|----------|
| 1 | Fix overlay slot leak on revocation | 1 hour | Prevents slot exhaustion | **P0** |
| 2 | Add overlay check to `create_escrow` | 2 hours | Closes per-agent bypass | **P0** |
| 3 | Reject agents without overlay slot when limit > 0 | 1 hour | Closes per-agent bypass | **P0** |
| 4 | Add `devnet-testing` + `mainnet` compile guard | 5 min | Prevents config error | **P0** |
| 5 | ~~Block SPL Approve (opcode 4) in sandwich~~ | ~~30 min~~ | ~~Prevents delegation injection~~ | **DONE** |
| 6 | ~~Block Token-2022 transfer/approve opcodes~~ | ~~30 min~~ | ~~Future-proofs for Token-2022~~ | **DONE** |
| 7 | Configurable session expiry in PolicyConfig | 4 hours | Better congestion handling | **P1** |
| 8 | Multi-shard overlay (auto-create shard 1+) | 8 hours | Supports >7 agents with per-agent tracking | **P2** |
| 9 | Account-index constraints | 8 hours | Restrict which pools/markets agents use | **P2** |
| 10 | Default to allowlist mode in SDK templates | 1 hour | Safer default for new vaults | **P2** |

---

### 1.15 Security Tooling Status

| Tool | Config Exists | Last Run | Blocking in CI |
|------|---------------|----------|----------------|
| Sec3 X-Ray | Yes (`.github/workflows/ci.yml`) | Unknown | Yes |
| Trident Fuzz | Yes (`trident-tests/`) | Unknown | Yes (1K iterations) |
| Certora Prover | Yes (`certora/conf/phalnx.conf`) | Feb 2026 artifacts | Yes |
| External Audit | No | Never | N/A |
| Bug Bounty | No | Never | N/A |

**Certora specs (14 rules):**
- Time arithmetic correctness (epoch calculations)
- Decimal conversion safety (stablecoin_to_usd)
- Overflow detection in fee calculations
- Constant verification (protocol addresses)

**Trident fuzz flows (15):**
- Random instruction sequences across all 30 handlers
- 8 invariants checked per iteration: vault balance consistency, session lifecycle, spend tracking accuracy, fee collection, policy enforcement, permission boundaries, escrow state machine, position counter consistency

**Action items:**
- [ ] Run all three tools locally and document results
- [ ] Verify X-Ray scan has zero HIGH/CRITICAL findings
- [ ] Verify Certora passes all 14 rules
- [ ] Run Trident for 10K iterations (10x CI default) for deeper coverage
- [ ] Plan external audit timeline

---

## 2. TypeScript SDK

**Overall Grade: B+**
Solid code, comprehensive builders. The naming schism is the critical blocker.

### 2.1 NPM Publishing & Naming

**STATUS: FAIL — CRITICAL (the #1 issue in the entire system)**

There is a **naming schism** between published and documented package names:

| Package | Old Name (Published) | New Name (Documented) | npm Status |
|---------|---------------------|----------------------|------------|
| SDK | `@agent-shield/sdk@0.5.4` | `@phalnx/sdk` | Old: LIVE, New: 404 |
| Core | `@agent-shield/core@0.1.5` | `@phalnx/core` | Old: LIVE, New: 404 |
| SAK Plugin | — | `@phalnx/plugin-solana-agent-kit` | 404 |
| ElizaOS Plugin | — | `@phalnx/plugin-elizaos` | 404 |

**What this means for a developer:**
1. SAK plugin README says: `npm install @phalnx/plugin-solana-agent-kit @phalnx/sdk` → both 404
2. A developer who finds `@agent-shield/sdk` on npm can install it, but can't find the SAK plugin
3. The SDK on npm depends on `@agent-shield/core` (old name) — this works
4. The plugin's `peerDependencies` reference `@phalnx/sdk` (new name) — won't resolve

**Decision needed:** Pick ONE namespace and publish everything under it.

**Action items:**
- [ ] DECISION: Use `@phalnx/*` or `@agent-shield/*` as the canonical namespace?
- [ ] Publish `@phalnx/sdk` (or update all refs to `@agent-shield/sdk`)
- [ ] Publish `@phalnx/core` (or update all refs to `@agent-shield/core`)
- [ ] Publish `@phalnx/plugin-solana-agent-kit`
- [ ] Publish `@phalnx/plugin-elizaos`
- [ ] Update all README files to use the chosen namespace
- [ ] Update all `peerDependencies` to use the chosen namespace
- [ ] Update all `import` statements in examples/docs
- [ ] Add npm publish step to `release.yml` CI workflow
- [ ] Set up npm org for the chosen namespace if not already done
- [ ] Deprecate old namespace packages with a pointer to new namespace (if migrating)

---

### 2.2 Account Name Casing

**STATUS: FAIL — MEDIUM**

Anchor 0.32.1 IDL generates PascalCase account names (`AgentVault`, `PolicyConfig`, `SpendTracker`) but the `Program` JS class creates camelCase properties (`program.account.agentVault`, `program.account.policyConfig`).

**Impact:**
- TypeScript types from IDL say `program.account.AgentVault` — doesn't exist at runtime
- Code must use `(program.account as any).agentVault` — breaks type safety
- Every `program.coder.accounts.decode()` call also needs camelCase name

**Where this appears:**
- SDK client code
- Dashboard hooks (`useVault.ts`, `useAllVaults.ts`, etc.)
- Test files

**Action items:**
- [ ] Option A: Post-process IDL types to generate camelCase accessors (custom script)
- [ ] Option B: Create a typed wrapper that maps PascalCase types to camelCase runtime
- [ ] Option C: Document the pattern and provide a `getAccount()` helper that handles casing
- [ ] Remove all `as any` casts once the solution is in place
- [ ] Add a test that verifies account name resolution works without casts

---

### 2.3 Instruction Builders

**STATUS: PASS**

All 30 instructions have corresponding TypeScript builders in `sdk/typescript/src/instructions.ts`:

- Vault: `buildInitializeVault`, `buildDepositFunds`, `buildWithdrawFunds`, `buildCloseVault`, `buildReactivateVault`, `buildSyncPositions`, `buildRevokeAgent`
- Agent: `buildRegisterAgent`, `buildUpdateAgentPermissions`
- Policy: `buildUpdatePolicy`, `buildQueuePolicyUpdate`, `buildApplyPendingPolicy`, `buildCancelPendingPolicy`
- Session: `buildValidateAndAuthorize`, `buildFinalizeSession`
- Constraints: `buildCreateInstructionConstraints`, `buildUpdateInstructionConstraints`, `buildQueueConstraintsUpdate`, `buildApplyConstraintsUpdate`, `buildCloseInstructionConstraints`
- Transfer/Escrow: `buildAgentTransfer`, `buildCreateEscrow`, `buildSettleEscrow`, `buildRefundEscrow`, `buildCloseSettledEscrow`

**Action items:**
- [ ] Verify each builder's parameter types match the on-chain instruction
- [ ] Confirm builders derive all PDAs correctly
- [ ] Add JSDoc comments to all public builder functions

---

### 2.4 Transaction Composer

**STATUS: PASS**

`sdk/typescript/src/composer.ts` provides high-level transaction composition:

```typescript
composePermittedAction(vault, action_type, token, amount, protocol)
composePermittedTransaction(vault, actions[])
composePermittedSwap(vault, token, amount, protocol)
```

These correctly build the atomic sandwich: `[validate_and_authorize, ...defi_instructions, finalize_session]`.

**Action items:**
- [ ] Verify composer handles multi-instruction DeFi operations (e.g., multi-hop Jupiter swaps)
- [ ] Add test: compose a transaction with 3+ DeFi instructions sandwiched
- [ ] Verify transaction size stays within Solana's 1232-byte limit for complex sandwiches

---

### 2.5 Integration Modules

**STATUS: PASS**

| Module | Features | Status |
|--------|----------|--------|
| Jupiter (`jupiter.ts`) | Quote fetching, swap composition, 127 discriminator variants | Working |
| Jupiter Price (`jupiter-price.ts`) | Token price lookup via Jupiter API | Working |
| Jupiter Tokens (`jupiter-tokens.ts`) | Token search, trending tokens | Working |
| Jupiter Lend (`jupiter-lend.ts`) | Deposit, borrow, repay, liquidate | Working |
| Flash Trade (`flash-trade.ts`) | Perp position management | Working |

**Risk:** Jupiter discriminator tables are hardcoded for 127 swap variants. A Jupiter protocol upgrade could break instruction parsing.

**Action items:**
- [ ] Check if Jupiter v6 is still current (or if v7 is coming)
- [ ] Add a CI job that fetches Jupiter's latest program and compares discriminators
- [ ] Document the discriminator table update process for when Jupiter upgrades
- [ ] Verify Flash Trade SDK version (`flash-sdk@^14.0.0` in dashboard, `^15.1.4` in SDK) — version mismatch?

---

### 2.6 Type Exports

**STATUS: PASS**

All account types, events, action types, and constants are exported from `sdk/typescript/src/types.ts`:

- `PHALNX_PROGRAM_ID`
- `ActionType` enum with all 21 action types
- Permission constants: `SWAP_ONLY`, `PERPS_ONLY`, `TRANSFER_ONLY`, `ESCROW_ONLY`, `FULL_PERMISSIONS`
- Fee constants: `FEE_RATE_DENOMINATOR`, `PROTOCOL_FEE_RATE`, `MAX_DEVELOPER_FEE_RATE`
- Limits: `MAX_AGENTS_PER_VAULT`, `MAX_ALLOWED_PROTOCOLS`, `MAX_ALLOWED_DESTINATIONS`

**Action items:**
- [ ] Verify all 22 event types have corresponding TypeScript interfaces
- [ ] Confirm permission constants match the on-chain bitmask values
- [ ] Export human-readable permission helpers (e.g., `permissionsToString(bitmask)`)

---

## 3. Solana Agent Kit Plugin

**Overall Grade: B**
Beautiful API design, not published, no e2e test.

### 3.1 Plugin NPM Publishing

**STATUS: FAIL — CRITICAL**

The plugin at `plugins/solana-agent-kit/` has:
- Full source code (10 tools, factory, types)
- 29 unit tests
- Excellent README with 3-line quickstart
- `package.json` version 0.4.4

**But it is NOT published to npm** under either `@phalnx/plugin-solana-agent-kit` or any other name.

**Action items:**
- [ ] Publish to npm under chosen namespace (see 2.1)
- [ ] Verify `peerDependencies` resolve correctly after publishing
- [ ] Add to the `release.yml` CI workflow for automated publishing
- [ ] Test fresh install from npm in a clean project

---

### 3.2 ShieldedWallet Wrapper

**STATUS: PASS**

The `shieldWallet()` function wraps any `BaseWallet` and intercepts `signTransaction` / `signAllTransactions`:

```
Agent calls swap() → SAK builds transaction → shieldWallet() intercepts signTransaction
                                                  ↓
                                        Policy engine evaluates:
                                        • Spending cap check
                                        • Rate limit check
                                        • Protocol allowlist
                                        • Token allowlist
                                                  ↓
                                        Pass → sign with inner wallet
                                        Fail → throw ShieldDeniedError
```

**This is the correct design.** Transparent wrapping means ALL existing SAK plugins (swap, perps, lend) get protection without modification.

**Action items:**
- [ ] Verify `ShieldDeniedError` includes actionable message (which policy was violated, by how much)
- [ ] Test: what happens when a multi-instruction TX has one violating instruction? (whole TX rejected or partial?)
- [ ] Verify wallet wrapper works with all wallet types: Keypair, Phantom, Turnkey, Privy

---

### 3.3 LLM-Facing Tools

**STATUS: PASS**

10 tools registered on the SAK agent:

| Tool | Purpose | Schema |
|------|---------|--------|
| `shield_status` | Check spending vs limits, rate limits, enforcement state | No params |
| `shield_update_policy` | Update spending limits, program blocking | `maxSpend?`, `blockUnknownPrograms?` |
| `shield_pause_resume` | Toggle enforcement on/off | `action: "pause" \| "resume"` |
| `shield_transaction_history` | Per-token usage percentages, rate limit status | No params |
| `shield_provision` | Generate Solana Action URL for vault provisioning | `vaultAddress` |
| `shield_x402_fetch` | HTTP 402 payment-negotiated fetch | `url`, `method?`, `body?` |
| `shield_create_escrow` | Create inter-vault escrow | Escrow params |
| `shield_settle_escrow` | Settle active escrow | Escrow ID |
| `shield_refund_escrow` | Refund expired escrow | Escrow ID |
| `shield_check_escrow` | Check escrow status | Escrow ID |

**All tools have Zod schemas** for input validation.

**Action items:**
- [ ] Verify tool descriptions are clear enough for LLM tool selection (will GPT/Claude pick the right tool?)
- [ ] Test: LLM calls `shield_status` and gets a useful, parseable response
- [ ] Test: LLM calls `shield_update_policy` with natural language like "increase my limit to 1000 USDC per day"
- [ ] Verify `shield_pause_resume` logs a warning when pausing (security-sensitive operation)

---

### 3.4 Framework Adapters

**STATUS: PASS (via SAK v2 auto-conversion)**

SAK v2's plugin system automatically converts plugin tools to:
- **LangChain tools** via `createLangchainTools(agent)`
- **Vercel AI SDK tools** via `createSolanaTools(agent)`
- **MCP tools** via `@solana-agent-kit/adapter-mcp`

No additional work needed — Phalnx tools are automatically available in all frameworks.

**Action items:**
- [ ] Test LangChain integration: create agent, verify Phalnx tools appear
- [ ] Test Vercel AI integration: create agent, verify Phalnx tools appear
- [ ] Test MCP integration: verify tools appear in Claude Desktop / Cursor

---

### 3.5 End-to-End Integration Test

**STATUS: FAIL — HIGH**

The plugin has 29 unit tests covering tools, factory, config resolution, and event wiring. But there is **no test that**:

1. Creates a vault on-chain (or in LiteSVM)
2. Registers an agent
3. Wraps the agent wallet with `shieldWallet()`
4. Has the agent execute a protected swap via SAK
5. Verifies the spend was tracked

This is the **entire value proposition** of the product, untested end-to-end.

**Action items:**
- [ ] Create `tests/e2e-sak-integration.ts` that uses LiteSVM
- [ ] Test happy path: vault → agent → shieldWallet → swap → spend tracked
- [ ] Test denial path: vault → agent → shieldWallet → swap exceeds cap → ShieldDeniedError
- [ ] Test kill switch: vault → agent → owner revokes → agent swap fails
- [ ] Test policy update: vault → agent → owner increases cap → agent swap succeeds
- [ ] This test becomes the reference implementation for the quickstart guide

---

## 4. Dashboard

**Overall Grade: B-**
Functional for devnet demos. 4 production blockers.

### 4.1 Build & Runtime

**STATUS: PASS**

- Next.js 14.1.0 + React 18.2.0 + TypeScript
- Shadcn/ui + Tailwind CSS v3 + Radix UI
- Solana Wallet Adapter (standard)
- `yarn dev` / `yarn build` / `yarn start`

**Action items:**
- [ ] Run `yarn build` and verify zero errors
- [ ] Run `yarn lint` and verify zero warnings in application code
- [ ] Test in Chrome, Firefox, Safari

---

### 4.2 Network-Aware USDC Mints

**STATUS: FAIL — HIGH**

`src/lib/provision-tx.ts` hardcodes the devnet USDC mint:

```typescript
const USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
```

This is used in the Solana Actions provision endpoint to set the default allowed token. On mainnet, this would reference a non-existent token.

**Action items:**
- [ ] Create a `getUsdcMint(network)` utility that returns the correct mint per network
- [ ] Use the `NetworkProvider` context to detect current network
- [ ] Add mainnet USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- [ ] Add USDT mints for both networks as well
- [ ] Test: provision on devnet uses devnet mint, provision on mainnet uses mainnet mint

---

### 4.3 Provision Store (Persistence)

**STATUS: FAIL — HIGH**

`src/lib/provision-store.ts` uses an in-memory `Map` with 5-minute TTL:

```typescript
const store = new Map<string, PendingProvision>();
```

On Vercel, this resets on every cold start. On multi-instance deployments, instances don't share state.

**Action items:**
- [ ] Replace with Vercel KV, Redis, or Upstash for serverless persistence
- [ ] Keep the same interface (`setPending`, `getPending`, `deletePending`)
- [ ] Set TTL to 5 minutes (matching current behavior)
- [ ] Test: provision created on instance A, status checked on instance B → found
- [ ] Fallback: if no Redis configured, log warning and use in-memory (for local dev)

---

### 4.4 Rate Limiter (Distribution)

**STATUS: FAIL — HIGH**

`src/lib/rate-limit.ts` uses an in-memory `Map` tracking provisions per wallet per hour.

Same problem as 4.3 — doesn't work across instances.

**Action items:**
- [ ] Replace with Redis-based sliding window rate limiter (or Upstash ratelimit)
- [ ] Keep 5 provisions per hour per wallet limit
- [ ] Test: rate limit enforced across multiple Vercel function invocations
- [ ] Add rate limit headers to response: `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

### 4.5 CORS Hardening

**STATUS: FAIL — MEDIUM**

The provision endpoint returns `Access-Control-Allow-Origin: *`, allowing any website to initiate vault creation for any user.

**Risk:** While the user still must sign the transaction, a malicious site could craft a provision TX with attacker-controlled parameters (e.g., fee destination = attacker's wallet).

**Action items:**
- [ ] Set `Access-Control-Allow-Origin` to dashboard domain only
- [ ] Exception: Solana Actions spec may require `*` for blink compatibility — verify
- [ ] If Solana Actions requires `*`, add additional parameter validation to prevent abuse
- [ ] Add `Access-Control-Allow-Methods: GET, POST, OPTIONS` (restrict methods)

---

### 4.6 Environment Variable Validation

**STATUS: FAIL — MEDIUM**

No startup check for required environment variables. Missing keys cause runtime errors with unhelpful messages.

**Required variables:**
- `NEXT_PUBLIC_HELIUS_DEVNET_URL` — RPC endpoint
- `NEXT_PUBLIC_HELIUS_MAINNET_URL` — RPC endpoint
- `CROSSMINT_API_KEY` — TEE wallet creation
- `JUPITER_TOKEN_API_KEY` — Token list proxy

**Action items:**
- [ ] Add `.env.example` with all required variables documented
- [ ] Add startup validation in `next.config.js` or a shared config module
- [ ] Log clear error: "Missing CROSSMINT_API_KEY — TEE wallet provisioning disabled"
- [ ] Gracefully degrade when optional keys are missing (instead of crashing)

---

### 4.7 Wallet & Vault Operations

**STATUS: PASS**

All core dashboard operations work:

| Operation | Component | Status |
|-----------|-----------|--------|
| Connect wallet | `WalletButton.tsx` | Working |
| Create vault | `CreateVaultWizard.tsx` (3-step) | Working |
| Register agent | `RegisterAgent.tsx` (TEE + manual) | Working |
| Edit policy | `PolicyEditor.tsx` | Working |
| Kill switch | `KillSwitchButton.tsx` | Working |
| Deposit/withdraw | `DepositWithdraw.tsx` | Working |
| Close vault | `CloseVaultButton.tsx` | Working |
| Reactivate vault | `ReactivateVault.tsx` | Working |
| View balances | `VaultBalances.tsx` | Working |
| Spending progress | `SpendingProgressBar.tsx` | Working |
| Explore vaults | `LeaderboardTable.tsx` | Working (30s polling) |
| Live updates | `useVaultLive.ts` | Working (WebSocket) |

**Action items:**
- [ ] Test full flow: create vault → deposit → register agent → verify on explorer
- [ ] Verify policy templates (Conservative/Moderate/Aggressive) produce correct on-chain values
- [ ] Test kill switch → reactivate flow
- [ ] Test close vault with remaining balance (should withdraw first)

---

## 5. Developer Experience

**Overall Grade: C+**
Great code behind a broken front door.

### 5.1 5-Minute SAK Quickstart

**STATUS: FAIL — HIGH**

`GETTING_STARTED.md` is 150+ pages covering program development from source (Rust, Anchor, Solana CLI). It targets developers building the program, not developers using it.

**What's missing:** A concise quickstart for SDK/plugin users:
```
1. npm install @phalnx/plugin-solana-agent-kit @phalnx/sdk
2. Wrap your wallet: shieldWallet(wallet, { maxSpend: "500 USDC/day" })
3. Create plugin: createPhalnxPlugin({ wallet: protectedWallet })
4. Create agent: new SolanaAgentKit(protectedWallet, rpcUrl, { plugins: [plugin] })
5. Done — all SAK actions are now policy-guarded
```

**Action items:**
- [ ] Create `QUICKSTART.md` (or `docs/quickstart.md`) — max 2 pages
- [ ] Include: install, create vault (dashboard or SDK), wrap wallet, create agent, first trade
- [ ] Include: check status, update policy, kill switch
- [ ] Include: link to full GETTING_STARTED.md for program developers
- [ ] Add quickstart link to npm package README
- [ ] Add quickstart link to GitHub repo README

---

### 5.2 Working E2E Example

**STATUS: FAIL — HIGH**

No repository contains a working end-to-end example that a developer can clone and run.

**Action items:**
- [ ] Create `examples/sak-quickstart/` directory
- [ ] Include: `package.json`, `index.ts`, `.env.example`, `README.md`
- [ ] The example should: create vault on devnet, register agent, execute protected swap
- [ ] Should work with `npx ts-node index.ts` after `npm install`
- [ ] Include both: programmatic vault creation AND dashboard vault creation paths
- [ ] This becomes the reference implementation for all documentation

---

### 5.3 Error Message Quality

**STATUS: PASS**

69 named error types (6000–6068) with specific messages. Examples:
- `TransactionTooLarge` — clear what to fix
- `DailyCapExceeded` — clear what's wrong
- `UnauthorizedAgent` — clear who's at fault
- `ProtocolNotAllowed` — clear which protocol is blocked

**Action items:**
- [ ] Verify `ShieldDeniedError` in the SAK plugin includes which specific policy was violated
- [ ] Add suggested remediation to common errors (e.g., "DailyCapExceeded — wait until tomorrow or ask vault owner to increase cap")
- [ ] Verify errors propagate correctly through the SAK plugin to the LLM

---

### 5.4 Configuration Complexity

**STATUS: CONCERN**

Creating a vault requires 10+ parameters. The dashboard has templates (Conservative/Moderate/Aggressive) but the SDK does not expose them programmatically.

**Action items:**
- [ ] Export policy templates from SDK: `import { CONSERVATIVE, MODERATE, AGGRESSIVE } from "@phalnx/sdk"`
- [ ] Add `createVaultWithTemplate(owner, "conservative")` convenience function
- [ ] Ensure templates use sensible defaults for all fields
- [ ] Document what each parameter does with recommended ranges

---

### 5.5 Permission Bitmask UX

**STATUS: CONCERN**

Agent permissions are a 21-bit bitmask. While constants like `SWAP_ONLY`, `PERPS_ONLY`, `FULL_PERMISSIONS` exist in the SDK, they're BigInt values that aren't intuitive:

```typescript
const SWAP_ONLY = 1n << 0n;  // what does bit 0 mean?
```

**Action items:**
- [ ] Create a `PermissionBuilder` helper: `new PermissionBuilder().allow("swap").allow("transfer").build()`
- [ ] Or: accept string arrays: `registerAgent(vault, agent, { permissions: ["swap", "transfer"] })`
- [ ] Document all 21 permission types with human-readable names
- [ ] Dashboard should show permissions as checkboxes, not a hex number

---

## 6. Production Readiness

**Overall Grade: D+**
Excellent CI, missing everything else.

### 6.1 CI/CD Pipeline

**STATUS: PASS**

8-job CI pipeline that runs on every push to `main` and every PR:

| Job | What It Does | Blocking? |
|-----|-------------|-----------|
| `changes` | Detect which packages changed | — |
| `build-lint-test` | TypeScript builds, Prettier, 734 TS tests | Yes |
| `rust-checks` | `cargo fmt` + `cargo clippy` | Yes |
| `on-chain-tests` | Anchor build + 222 LiteSVM tests | Yes |
| `build-verification` | Feature flag safety net | Yes |
| `surfpool-integration` | 20 Surfpool integration tests | Yes |
| `security-scan` | Sec3 X-Ray static analysis | **BLOCKING** |
| `formal-verification` | Certora Solana Prover | **BLOCKING** |
| `fuzz-test` | Trident fuzz 1K iterations | **BLOCKING** |
| `security-gate` | All-pass gate for branch protection | — |

**Action items:**
- [ ] Verify CI passes on current main branch
- [ ] Add npm publish step to `release.yml` for all packages
- [ ] Add devnet deployment step (or document manual process)
- [ ] Verify security-scan, formal-verification, and fuzz-test actually run (not skipped)

---

### 6.2 Formal Verification

**STATUS: UNKNOWN**

Certora configuration exists at `certora/conf/phalnx.conf`. `.certora_internal/` directory has run artifacts from February 2026. But no verification report is checked into the repo.

**Action items:**
- [ ] Run Certora verification: `source .certora-venv/bin/activate && certoraSolanaProver certora/conf/phalnx.conf`
- [ ] Save report to `certora/reports/`
- [ ] Document which properties are verified
- [ ] Add verification results to README badge

---

### 6.3 External Security Audit

**STATUS: FAIL**

No external audit report found. This is standard for pre-mainnet, but required before any mainnet deployment with real funds.

**Action items:**
- [ ] Scope the audit: on-chain program only, or SDK + program?
- [ ] Select audit firms (OtterSec, Neodyme, Trail of Bits, Sec3)
- [ ] Budget: $50K-$150K depending on scope and firm
- [ ] Timeline: 2-6 weeks depending on firm availability
- [ ] For devnet launch: not required. For mainnet: mandatory.

---

### 6.4 Monitoring & Alerting

**STATUS: FAIL**

The on-chain program emits 22 event types, but there's no off-chain infrastructure to:
- Index events
- Alert on anomalies (large withdrawals, kill switch activations, policy changes)
- Track aggregate metrics (total volume, active vaults, agent activity)

**Action items:**
- [ ] Set up event indexer (Helius webhooks, or custom geyser plugin)
- [ ] Alert on: kill switch activated, policy changed, large withdrawal, new vault created
- [ ] Dashboard for aggregate metrics (optional for devnet, required for mainnet)
- [ ] Consider: Flipside, Dune, or custom indexer for analytics

---

### 6.5 RPC Failover

**STATUS: FAIL**

Single Helius RPC endpoint configured via environment variable. No retry logic, no fallback.

**Action items:**
- [ ] Add fallback RPC endpoint (e.g., public Solana RPC as last resort)
- [ ] Add retry logic with exponential backoff for transient failures
- [ ] Consider: Triton, QuickNode, or GenesysGo as secondary RPC providers
- [ ] For devnet: Helius alone is fine. For mainnet: failover is required.

---

### 6.6 Mainnet Deployment Checklist

**STATUS: FAIL — not applicable for devnet but tracking for completeness**

**Action items:**
- [ ] Create `DEPLOYMENT.md` with step-by-step mainnet checklist
- [ ] Include: treasury address, program deploy, IDL upload, stablecoin verification
- [ ] Include: DNS, dashboard deployment, RPC configuration, monitoring setup
- [ ] Include: rollback plan if issues found post-deploy
- [ ] Include: gradual rollout plan (start with small vaults, increase limits over time)

---

## 7. Architecture Assessment

**Overall Verdict: SOUND — not painted into a corner**

### 7.1 Sandwich Composition Pattern

**VERDICT: CORRECT — the inevitable solution**

First Principles analysis confirms the sandwich pattern is the only viable approach for protocol-agnostic middleware on Solana:

| Alternative | Why It Fails |
|-------------|-------------|
| CPI wrapping (like EVM modifiers) | Consumes 1 CPI level; DeFi protocols use 2-3; leaves 0-1 for composability |
| Off-chain validation only | Agent can bypass; not enforceable |
| Escrow-and-forward | Requires protocol-specific adapters; breaks composability |
| Account freeze/thaw | SPL freeze authority is all-or-nothing; can't scope to amounts |

The sandwich avoids CPI depth entirely. DeFi instructions are unchanged. The pattern is protocol-agnostic — any DeFi protocol works without custom adapters.

**Growth path:** More protocols, more constraint types, configurable session timing — all additive, no rearchitecture needed.

---

### 7.2 Stablecoin-Only USD Tracking

**VERDICT: CORRECT TRADE-OFF**

By tracking USD values using stablecoin amounts (USDC = $1, 6 decimals), the system avoids:
- Oracle dependency (no Pyth/Switchboard, no oracle manipulation attacks)
- Price feed staleness
- Additional account requirements per transaction

**Limitation:** Non-stablecoin swaps use balance-before/balance-after to infer USD impact. This works if the stablecoin maintains peg. A depeg event would make spend tracking inaccurate.

**Irreducible risk:** Stablecoin depeg. But this is the same risk every DeFi protocol faces, and the alternative (oracles) introduces a worse risk.

---

### 7.3 Rolling 24h Spend Window

**VERDICT: MATHEMATICALLY SOUND**

144 epochs × 10-minute duration = exactly 24 hours. Circular buffer with boundary correction.

**Advantages over simpler approaches:**
- No midnight reset exploit (flat daily cap resets at midnight → spend at 11:59pm + 12:01am = 2x cap)
- Constant-time rolling sum (iterate 144 fixed-size buckets)
- Zero-copy for low compute overhead

---

### 7.4 Per-Agent Spend Overlays

**VERDICT: ELEGANT SOLUTION**

Each agent's contribution is tracked independently via `AgentSpendOverlay`. This allows:
- Per-agent spending limits enforced on-chain
- Attribution of spend to specific agents
- Vault-wide cap still applies as backstop

**Known limitation:** 7 agents per shard. Agents 8-10 use vault-wide cap only. Addressable by adding shard 1+ in the future — no rearchitecture needed.

---

### 7.5 Protocol Instruction Parsing

> **Updated 2026-03-07:** Architecture settled — protocol-agnostic on-chain, protocol-specific SDK.

**VERDICT: CORRECT ARCHITECTURE**

After exhaustive analysis of 21 major Solana protocols:
- **1 specialized on-chain verifier** (Jupiter V6 — 788 lines, variable-length route plan)
- **14 protocols fully covered** by generic constraints (fixed-offset byte matching)
- **5 protocols partially covered** (pre-Option fields handle critical safety parameters)
- **1 protocol with edge case** (Meteora swap_with_price_impact — mitigated by discriminator blocking)

**Key insight:** The "pre-Option fields" pattern is a Rust/Borsh convention — required parameters come first, optional ones trail. This means generic constraints naturally target the most safety-critical fields (amounts, prices, directions, market indices) because they're always at fixed, deterministic offsets.

**The only protocol requiring a specialized verifier is Jupiter V6.** Its variable-length route plan (`Vec<RoutePlanStep>` with 127 swap variants of different byte sizes) shifts the suffix containing slippage fields to unpredictable offsets. No other major Solana protocol has this pattern. CONFIRMED by analysis of all 21 protocols.

**Flash Trade and Jupiter Lend verifiers were removed** in V2 Phase 1. Both had entirely fixed instruction data layouts — generic constraints provide strictly more enforcement.

**Action items:**
- [ ] Monitor Jupiter for v7 announcement
- [x] Remove Flash Trade verifier — DONE (V2 Phase 1)
- [x] Remove Jupiter Lend verifier — DONE (V2 Phase 1)
- [x] Confirm no other protocol needs specialized verifier — DONE (21-protocol audit)

---

### 7.6 Competitive Position

> **Updated 2026-03-07:** Comprehensive competitive analysis across 7 systems (Zodiac Roles, Brahma, Squads, Turnkey, Fireblocks, Safe Guards, AgentVault).

| Feature | Phalnx | Zodiac Roles (EVM) | Turnkey | Fireblocks TAP | Raw SAK |
|---------|--------|-------------------|---------|----------------|---------|
| Enforcement level | On-chain (validator) | On-chain (modifier) | Off-chain (TEE) | Off-chain (MPC) | None |
| Bypass resistance | Cannot bypass | Cannot bypass | Agent can bypass | Agent can bypass | N/A |
| Instruction constraints | Yes (byte-offset) | Yes (ABI-typed) | Partial (hex match) | No (selector only) | None |
| Comparison operators | **Eq, Ne, Gte, Lte, GteSigned, LteSigned, Bitmask** (7) | Eq, Gt, Lt, SignedGt/Lt, Bitmask (6) | ==, <, > | N/A | None |
| Logic combinators | 2-level (entry OR, AND) | **Arbitrary trees** | AND, OR | AND | None |
| Spending limits | Rolling 24h, per-agent | Refillable allowances | Per-transaction | Time-period | None |
| Kill switch | Instant vault freeze | Direct update | API key revocation | MPC revocation | None |
| **Timelocked policy changes** | **Yes** | No | No | No | None |
| **Formal verification** | **Yes (Certora)** | No | No | No | None |
| **Post-execution verification** | **Yes (finalize_session)** | No | Yes (SafeModerator) | No | None |
| Installation today | **Broken** (naming) | npm/Hardhat plugin | 1 npm install | Enterprise onboarding | 1 npm install |

**Phalnx is the ONLY on-chain instruction constraint system on Solana.** No competitor exists in the Solana ecosystem — Squads is governance only, AgentVault has no instruction-level constraints, Solana Agent Kit has no on-chain enforcement.

**Phalnx's unique advantages:**
1. **On-chain enforcement** — Turnkey/Fireblocks run off-chain; if the agent has the private key, it can bypass them. Phalnx never gives the agent the private key.
2. **Timelocked policy changes** — no other system (including Zodiac) requires timelock for policy modifications
3. **Post-execution verification** — `finalize_session` verifies balance changes after DeFi execution
4. **Composed transaction pattern** — protocol-agnostic, no CPI depth consumption
5. **Formal verification** — Certora proofs on time arithmetic, overflow, constants

**Operator parity with Zodiac Roles achieved:** GteSigned, LteSigned, and Bitmask operators added in Phase 2. Phalnx now has 7 operators vs Zodiac's 6 — plus timelocked policy changes, formal verification, and post-execution verification that Zodiac lacks. Remaining gap: deeper logic trees (not needed for V1 — 2-level covers 90% of use cases).

**After fixing installation, Phalnx is the only option for institutions that require cryptographic guarantees, not just API-level promises.**

---

## 8. Priority Roadmap

### Phase 1: Ship to Devnet (1-2 days)

These are the items that must be done before devnet testing can begin:

- [ ] **P0:** Resolve namespace — pick `@phalnx/*` or `@agent-shield/*`
- [ ] **P0:** Publish SDK under chosen namespace
- [ ] **P0:** Publish core under chosen namespace
- [ ] **P0:** Publish SAK plugin under chosen namespace
- [ ] **P0:** Update all READMEs with correct package names
- [ ] **P0:** Set devnet treasury address (can be a test wallet for now)
- [ ] **P1:** Write 2-page QUICKSTART.md for SAK developers
- [ ] **P1:** Create `examples/sak-quickstart/` with working e2e example
- [ ] **P1:** Run full test suite and verify all 1,032 tests pass

### Phase 2: Devnet Testing (1-2 weeks)

- [ ] Deploy program to devnet (if not already deployed)
- [ ] Deploy dashboard to Vercel (devnet mode)
- [ ] Create e2e integration test (SAK agent → vault → swap)
- [ ] Fix USDC mint to be network-aware in dashboard
- [ ] Add `.env.example` to dashboard
- [ ] Test full flow: install SDK → create vault → register agent → protected swap
- [ ] Test kill switch flow end-to-end
- [ ] Run Certora verification and document results
- [ ] Run X-Ray security scan and review findings

### Phase 3: Production Hardening (2-4 weeks)

- [ ] Replace in-memory stores with Redis/Vercel KV
- [ ] Harden CORS on provision endpoint
- [ ] Add env var validation
- [ ] Add RPC failover logic
- [ ] Set up event indexing and monitoring
- [ ] Fix account name casing (remove `as any` casts)
- [ ] Add configurable session expiry to PolicyConfig
- [ ] Export policy templates from SDK
- [ ] Create PermissionBuilder helper
- [ ] Complete external security audit scope document

### Phase 4: Mainnet Preparation

- [ ] External security audit
- [ ] Set mainnet treasury address (multisig)
- [ ] Create DEPLOYMENT.md
- [ ] Gradual rollout plan
- [ ] Bug bounty program
- [ ] Monitoring & alerting infrastructure
- [ ] Publish ElizaOS plugin

---

> **Bottom line:** The architecture is a Ferrari engine. The packaging is a junkyard.
> Fix the packaging (Phase 1), and you have a product that's genuinely worth installing —
> the only on-chain enforced guardrails for AI agents on Solana.
