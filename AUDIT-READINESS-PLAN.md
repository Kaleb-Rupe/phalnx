# Audit Readiness Plan

**Goal:** Pass a formal security audit with zero CRITICAL/HIGH findings.
**Status:** 7 gaps identified. Each has a concrete fix.

---

## Gap 1: 5 Pentest Failures Unresolved

### What an auditor would find
5 of 52 devnet pentest tests fail (ISC-15, 19, 25, 39, 40). Even if these are test encoding bugs, an auditor will ask "did you test these edge cases?" and the answer is "we tried but our tests were broken."

### Root cause (VERIFIED by agent analysis)

| Test | Type | Root Cause |
|------|------|------------|
| ISC-15 | Test bug | `expires_at` encoded as u64 instead of i64 (Borsh type mismatch) |
| ISC-19 | Test bug | `proof: Vec<u8>` encoded as vec-of-items instead of byte-vector |
| ISC-25 | Test bug | Setup revokes agent then reactivates without adding new one → NoAgentRegistered |
| ISC-39 | Test design | Mock DeFi = 0 actual_spend → protocol cap check skipped (on-chain is correct by design) |
| **ISC-40** | **ON-CHAIN BUG** | **Protocol caps mismatch gated by `!protocol_caps.is_empty()` — allows `protocols=[X], caps=[]` silently** |

### Fix
1. **ISC-15:** Add `encodeI64()` to exploit-helpers.ts, use for `expires_at` in `buildCreateEscrowIx`
2. **ISC-19:** Create `encodeBytes()` for `Vec<u8>` encoding (length prefix + raw bytes)
3. **ISC-25:** Fix test setup — reactivate with a new agent, THEN try registering owner
4. **ISC-39:** Document as on-chain design decision (outcome-based caps only fire when `actual_spend > 0`)
5. **ISC-40 (ON-CHAIN FIX REQUIRED):** In `initialize_vault.rs` and `update_policy.rs`, change the protocol caps validation:
   ```rust
   // BEFORE (line ~100 of initialize_vault.rs):
   if !protocol_caps.is_empty() {
       require!(protocol_caps.len() == protocols.len(), ...);
   }

   // AFTER:
   if has_protocol_caps {
       require!(protocol_caps.len() == protocols.len(), SigilError::ProtocolCapsMismatch);
   }
   ```
   This ensures that when `has_protocol_caps=true`, the caps array MUST match the protocols array length.

### Evidence for auditor
- 52/52 pentest results JSON (after fixes)
- ISC-40 on-chain fix with LiteSVM test proving the mismatch is now caught
- Each test documents the exact attack vector and expected error code

---

## Gap 2: CPI Blind Spot

### What an auditor would find
The instruction scan only sees top-level instructions. A whitelisted DeFi program could internally CPI into SPL Token to `approve_checked`, `burn`, or `set_authority` on vault tokens. The scan can't detect this.

### CPI Analysis Result: PRACTICAL VULNERABILITY (agent verified)

**The CPI blind spot IS exploitable.** Here's the attack chain:

1. `validate_and_authorize` calls `spl_token::approve(agent, delegation_amount)` — agent becomes delegate on vault token account
2. The agent signed the top-level transaction
3. A compromised whitelisted DeFi program (e.g., compromised Jupiter V6) CPIs into `spl_token::burn(vault_ata, agent_as_delegate)`
4. Solana runtime checks: "Is the agent a signer in the top-level TX?" → **YES** → CPI burn succeeds
5. Vault tokens are burned BEFORE `finalize_session` can revoke the delegation
6. Sigil instruction scan can't see the inner CPI — completely blind

**Key insight:** The agent's top-level signature propagates to inner CPI. The DeFi program doesn't need its own authority — it leverages the agent's existing delegation + signature.

### Fix (3 layers)

**Layer 1 — Post-execution balance audit (code change, ~4h):**
In `finalize_session`, AFTER the DeFi instruction executes but BEFORE analytics/events:
```rust
// Verify vault balance decreased by at most delegation_amount + fees
// If more was lost, a CPI attack occurred
if session_delegated {
    let expected_max_decrease = delegation_amount + protocol_fee + developer_fee;
    let actual_decrease = session_balance_before.saturating_sub(current_balance);
    require!(
        actual_decrease <= expected_max_decrease,
        SigilError::UnexpectedBalanceDecrease  // New error code
    );
}
```
This catches CPI burn/transfer attacks because the balance decrease would exceed the delegation amount.

**Layer 2 — Off-chain delegation monitoring (SDK change, ~2h):**
After `executeAndConfirm()`, query the vault's token account delegate field. If delegate is NOT `Pubkey::default()` (should have been revoked), alert.

**Layer 3 — Trust model documentation (docs, ~1h):**
Document in SECURITY.md: whitelisted protocols are trusted. Protocol allowlist is the defense boundary. The post-execution balance audit catches CPI attacks from compromised programs.

### Evidence for auditor
- Post-execution balance audit in finalize_session.rs with test
- Trust model document
- Delegation monitoring specification in SDK

---

## Gap 3: No Formal Verification of SDK

### What an auditor would find
The on-chain program has Certora formal verification specs (`programs/sigil/src/certora/specs/`). The SDK has 884 unit tests but no property-based testing or formal proofs. The SDK's `getRolling24hUsd()` and `getAgentRolling24hUsd()` mirror on-chain Rust logic — any divergence would cause the SDK to under-report spending, letting transactions through that on-chain would reject.

### Fix
1. **Property-based tests for SDK math functions:**
   - `getRolling24hUsd()` must match on-chain `SpendTracker::get_rolling_24h_usd()` for all inputs
   - `getAgentRolling24hUsd()` must match `AgentSpendOverlay::get_agent_rolling_24h_usd()`
   - `ceilFee()` must match on-chain `ceil_fee()` for all (amount, rate) pairs
   - Use `fast-check` or similar property-based testing library

2. **Cross-validation test:**
   - Generate random SpendTracker data (144 epoch buckets with random values)
   - Compute rolling 24h in BOTH the SDK (TypeScript) and on-chain (Rust via LiteSVM)
   - Assert results are identical

3. **Boundary exhaustion:**
   - Test at u64::MAX, 0, negative timestamps, epoch boundary transitions
   - Test with all-zero buckets, all-max buckets, alternating patterns

### Evidence for auditor
- Property-based test suite with 10,000+ random inputs
- Cross-validation report showing SDK ↔ on-chain match rate = 100%

---

## Gap 4: Delegation Window (8 seconds)

### What an auditor would find
Between `validate_and_authorize` (Approve) and `finalize_session` (Revoke), the agent holds SPL Token delegation over the vault's token account for ~8 seconds. A compromised agent could submit a SEPARATE transaction to transfer delegated tokens before the composed transaction's finalize executes.

### Why it's mitigated but not eliminated
- **On-chain defense:** The delegation amount is bounded by `amount - fees`. The agent can't drain more than the declared amount.
- **Cap defense:** Even if the separate TX succeeds, finalize_session measures the ACTUAL balance delta and applies it to spending caps. The vault owner's daily cap still limits total extraction.
- **Custody defense:** Agent keys are managed by Turnkey TEE — the private key never leaves the enclave.

### Fix
1. **Document the trust model** — the delegation window is an INHERENT property of the composed transaction pattern. It cannot be eliminated without changing to a CPI-based architecture (which hits Solana's 4-level CPI depth limit).
2. **Quantify the risk** — max loss per delegation window = `min(delegation_amount, vault_balance)`. Max loss per day = `daily_spending_cap_usd`. Document these bounds.
3. **Verify Turnkey integration** — confirm agent key attestation works, document the custody flow
4. **Add delegation monitoring** — after every `seal()` + send, check that the vault's token account delegate is zeroed (revoked). If not, alert.

### Evidence for auditor
- Trust model document with risk quantification
- Turnkey integration test results (key attestation, signing flow)
- Monitoring specification for delegation state

---

## Gap 5: replaceAgentAtas WRITABLE-Only Change

### What an auditor would find
The WRITABLE-only replacement was a security fix (ADV-3) but it changes behavior for ALL DeFi instructions. If any legitimate instruction puts a token ATA as READONLY, the replacement would miss it.

### Verification Result: SAFE (agent verified across 7 protocols)

Checked ALL token account roles across Jupiter V6, Flash Trade, Phoenix V1, GooseFX, Lifinity V2, Marinade Finance, and Zeta Markets. **100% of user token ATAs are WRITABLE.** No exceptions found.

READONLY accounts in DeFi instructions are: mints, oracles, authorities, and programs — never token ATAs. The SPL Token standard requires token accounts to be writable for any transfer/burn/approve operation.

### Fix
1. ~~Verify against real layouts~~ — **DONE. Verified safe.**
2. Document the verification results in a comment in `replaceAgentAtas()`
3. The existing ADV-3 test (`replaceAgentAtas preserves READONLY accounts`) already covers the behavior

### Evidence for auditor
- Verification report: 7 protocols checked, all token ATAs are WRITABLE
- Protocols: Jupiter V6, Flash Trade, Phoenix V1, GooseFX DEX, Lifinity V2, Marinade Finance, Zeta Markets
- ADV-3 unit test confirms READONLY preservation
- **Gap 5 is CLOSED. No further work needed.**

---

## Gap 6: No Fuzz Testing of SDK

### What an auditor would find
884 tests are example-based (specific inputs → specific outputs). No randomized testing. An auditor would question whether edge cases between tested values have been covered.

### Fix
1. **Install `fast-check`** (property-based testing library for TypeScript)
2. **Fuzz `seal()` input validation:**
   - Random actionType (0-20 + out-of-range values)
   - Random amount (0, 1, u64::MAX, u64::MAX+1, negative, very large)
   - Random tokenMint (USDC, USDT, random addresses)
   - Random instruction counts (0, 1, 5, 100)
   - Random discriminator bytes (0-255) in SPL Token instructions
3. **Fuzz `detectDrainAttempt()`:**
   - Random balance deltas (positive, negative, zero, u64::MAX)
   - Random totalVaultBalance (0, 1, u64::MAX)
   - Random thresholds (0-100, negative, >100, NaN, Infinity)
   - Random knownRecipients (empty, partial, complete)
4. **Fuzz `replaceAgentAtas()`:**
   - Random instruction counts with random account roles
   - Verify WRITABLE replaced, READONLY preserved for all inputs
5. **Fuzz `ceilFee()`:**
   - Random (amount, rate) pairs — verify SDK matches on-chain formula

### Evidence for auditor
- fast-check test suite with 10,000+ iterations per property
- No failures found (or failures documented and fixed)

---

## Gap 7: Token-2022 Extension Blocklist Fragility

### What an auditor would find
The blocklist approach (block specific discriminators) is reactive — new Token-2022 extensions could introduce new ways to move tokens that aren't in the blocklist. The auditor will recommend an allowlist or a more robust defense.

### Fix
1. **Document the defense-in-depth model:**
   - Layer 1: Instruction scan blocklist (catches known dangerous ops)
   - Layer 2: Protocol allowlist (only whitelisted programs execute)
   - Layer 3: Outcome-based balance verification (finalize measures actual delta)
   - Layer 4: Spending caps (on-chain rolling 24h limit)
   - Even if a new Token-2022 extension bypasses Layer 1, Layers 2-4 still protect

2. **Add Token-2022 extension detection:**
   - In `seal()`, check if the vault's token account is a Token-2022 account
   - If yes, warn that Token-2022 extensions may affect security assumptions
   - Block known-dangerous extensions (ConfidentialTransfer, TransferHook) with explicit checks

3. **Monitor Token-2022 ecosystem:**
   - Document which extensions USDC/USDT currently use (none that affect us)
   - Set up a watch for Circle/Tether enabling new extensions
   - Plan a program upgrade if ConfidentialTransfer is enabled on USDC

4. **Consider allowlist for Token-2022 in `strict_mode`:**
   - When instruction constraints are configured with `strict_mode=true`, block ALL Token-2022 instructions (not just the blocklist)
   - This gives vault owners the option to opt into maximum security

### Evidence for auditor
- Defense-in-depth document showing all 4 layers
- Token-2022 extension compatibility matrix
- Monitoring plan for stablecoin extension changes

---

## Implementation Priority

| # | Gap | Effort | Risk if Unaddressed | Priority |
|---|-----|--------|---------------------|----------|
| 1a | ISC-40 on-chain bug (protocol caps) | 2h | **HIGH** — allows misconfigured vaults | **P0** |
| 2 | CPI post-execution balance audit | 4h | **HIGH** — CPI burn attack is practical | **P0** |
| 1b | 4 pentest test fixes | 3h | MEDIUM — auditor questions coverage | P1 |
| 3 | SDK formal verification (property tests) | 8h | MEDIUM — no math cross-validation | P1 |
| 6 | Fuzz testing (fast-check) | 8h | MEDIUM — auditor expects fuzzing | P1 |
| 4 | Delegation window docs + monitoring | 2h | LOW — inherent to design | P2 |
| 5 | ~~WRITABLE-only ATA verification~~ | ~~2h~~ | **CLOSED** — verified across 7 protocols | ~~P2~~ |
| 7 | Token-2022 defense-in-depth docs | 4h | INFORMATIONAL | P2 |

**Total: ~35 hours. P0 items: ~6 hours (must do before audit).**

---

## Success Criteria

An audit firm (OtterSec, Neodyme, Trail of Bits) would produce:

| Severity | Expected Count | Target |
|----------|---------------|--------|
| CRITICAL | 0 | 0 |
| HIGH | 0 | 0 |
| MEDIUM | 2-3 (CPI, SDK verification, fuzzing) | 0 |
| LOW | 1-2 (delegation window, Token-2022) | ≤2 |
| INFORMATIONAL | 3-5 (docs, monitoring) | ≤5 |

After implementing this plan: **0 CRITICAL, 0 HIGH, 0 MEDIUM, ≤2 LOW, ≤5 INFORMATIONAL.**
