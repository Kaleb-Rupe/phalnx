# INTERFACES_V2.md — Sigil v2 ID Registry

**Status:** Source of truth for all IDs used across Stage 0+ docs (K1-K7, TA-01..TA-16, AC-1..AC-11, D-01..D-09, plus T-21 / T-DoS-1/2 / T-K6-1 / Def-1..Def-6).
**Last updated:** 2026-05-17
**Companion docs:** [REVAMP_PLAN.md](./REVAMP_PLAN.md), [THREAT_MODEL_V2.md](./THREAT_MODEL_V2.md), [ACCEPTANCE_V2.md](./ACCEPTANCE_V2.md)

> **All other docs in this directory cite IDs from this file as canonical. Cross-doc ID drift = §RP CRITICAL finding.**
> Modifications here require a §RP Review Protocol pass per [REVAMP_PLAN.md §12](./REVAMP_PLAN.md#12-rp-review-protocol).

---

## Foundational Features (K1-K7)

These are pre-V2 primitives carried forward unchanged. They are NOT enumerated in Tier A and do NOT count toward the 16-TA surface; they form the substrate on which Tier A enforces.

### K1 — Vault PDA + token accounts
The `AgentVault` PDA at seeds `[b"vault", owner, vault_id]` plus its associated USDC/USDT ATAs. Foundation since V0.

### K2 — Session keys (TTL + nonce-based bulk revocation)
The `SessionAuthority` PDA at seeds `[b"session", vault, agent, token_mint]` with `expiry_unix` and `nonce` fields. Closes AC-5 stale-key class via TTL; load-bearing for TA-06 cooldown and TA-15 N1 temporal binding. Foundation since V0.

### K3 — `freeze_vault` kill switch
Owner-only instruction that transitions `vault.status` from `Active` to `Frozen`. Closes AC-1 (agent leak) and AC-2 (owner leak) blast radius once detected. Foundation since V0.

### K4 — `register_agent` / `revoke_agent` / `pause_agent` / `unpause_agent`
Owner-only lifecycle instructions for agents. K4 is the substrate for TA-04 capability split (which encodes the *type* of agent permission). Foundation since V0.

### K5 — Timelock on policy mutations
`PendingPolicyUpdate` + `PendingConstraintsUpdate` PDAs gate every owner-initiated change with `min_delay_seconds` (default 172,800 = 48h). Closes AC-2 timelock-window attack window. Foundation since V0.

### K6 — Mandatory Anchor event emission
Every instruction calls `emit!(...)` per project CLAUDE.md mandate. Foundation since V0 for audit/dashboard observability.

### K7 — NM-E primitive (T1-only)
Net-Movement Enforcement — per-instruction semantic delta assertions. Reserved for the T1 verified short-list (~10 protocols with hand-written parsers). T2/T3 use vault-balance delta only. Foundation since V1; scope-reduced in V2 to T1-only per [REVAMP_PLAN.md §2.5](./REVAMP_PLAN.md#25-generic-byte-offset-nm-e-for-arbitrary-programs).

---

## Tier A Primitives (TA-01..TA-16)

These are the NEW V2 constraint surface enforced on every seal() bundle. Each cites its tier applicability. Full implementation specs are deferred to the Stage 2 prompt; this section provides one-line definitions for cross-doc reference.

### TA-01 — Per-vault+agent protocol allowlist
`PolicyConfig.allowed_protocols: Vec<Pubkey>` runtime-bounded to 10. Default-deny. Entry guard rejects any seal() whose next DeFi-instruction program ID is absent. Tiers: T1, T2, T3.

### TA-02 — Wallet allowlist default-deny
`PolicyConfig.allowed_destinations: Vec<Pubkey>` runtime-bounded to 10. Default-deny per Ondo USDY precedent. Tiers: T1, T2, T3.

### TA-03 — USDC/USDT mint pinning
Cluster-pinned mints at build time. Mainnet USDC `EPjFWdd5...`, mainnet USDT `Es9vMFrz...`, devnet USDC `4zMMC9sr...`. Entry guard rejects any non-pinned mint. Tiers: T1, T2, T3.

### TA-04 — Per-agent capability split
`SessionAuthority.capability: u8` per `state/vault.rs:6-8`: `DISABLED=0`, `OBSERVER=1`, `OPERATOR=2`. Reserved 3..=255 reject with `ErrInvalidCapability`. Tiers: T1, T2, T3.

### TA-05 — Operating hours UTC bitmask
`PolicyConfig.operating_hours: u32` — bit `i` (0..=23) set ⇒ hour `i` UTC is permitted. Tiers: T1, T2, T3.

### TA-06 — Per-action cooldown
`PolicyConfig.cooldown_seconds: u32`. Entry guard rejects if `clock.unix_timestamp - last_action_unix < cooldown_seconds`. Tiers: T1, T2, T3.

### TA-07 — First-time-destination friction
`PolicyConfig.destination_graylist: Vec<(Pubkey, i64)>` runtime-bounded to 10. New destination → graylist with `unlock_unix = now + 86400`. `auto_promote_grays: bool` defaults `false`. Tiers: T1, T2, T3.

### TA-08 — Token-2022 dangerous-extension blocklist
Entry guard rejects mints with: `TransferFee`, `TransferHook`, `PermanentDelegate`, `DefaultAccountState::Frozen`, `MintCloseAuthority`. Tiers: T1, T2, T3.

### TA-09 — Cosign workflow
Elevated owner operations (raise daily cap, expand allowlist) require owner+session co-signature on the policy-update instruction. Tiers: T1, T2, T3.

### TA-10 — Sandwich integrity N2 via instructions-sysvar
Entry guard reads `instructions` sysvar and asserts: (a) 1..=4 `validate_and_authorize` + `finalize_session` pairs in transaction, (b) immediate-next instruction after each `validate_and_authorize` is an allowed protocol program ID, (c) no foreign instruction inside any seal window writes to protected accounts. Tiers: T1, T2, T3.

### TA-11 — Protected-writable deny-list N4
Protected set: `{vault, tracker, session, policy}` PDAs. Entry guard rejects if any foreign instruction in the bundle lists a protected account as writable. Tiers: T1, T2, T3.

### TA-12 — Stablecoin balance floor
`PolicyConfig.stable_balance_floor: u64` (6-decimal USDC face value). `finalize_session` rejects if `usdc_balance + usdt_balance < stable_balance_floor`. Tiers: T1, T2, T3.

### TA-13 — Rolling 24h tracker
`SpendTracker` PDA (zero-copy, 2,840 bytes), keyed by `(vault, agent, protocol)`. Each entry tracks rolling-24h outflow in USDC face value. Tiers: T1, T2, T3.

### TA-14 — Per-recipient daily cap
`SpendTracker.per_recipient: Vec<(Pubkey, u64, i64)>` runtime-bounded to 10. Tiers: T1, T2, T3.

### TA-15 — Audit-log circular buffer (with N1 temporal binding per C22)
**Two separate buffers per C24 Stage 3-A LOCKED disposition:**
- Success buffer: 128 entries × 64 bytes = **8,192 bytes**.
- Rejected buffer: 64 entries × 64 bytes = **4,096 bytes**.
- **Total: 12,288 bytes** (192 entries combined; success and rejected isolated to eliminate ordering ambiguity under contention).

Each entry: `(discriminator, target_protocol, balance_delta_in, balance_delta_out, timestamp, slot_hash, blockhash)`. Each entry double-bound by slot + blockhash (C22 macaroon-style). Tiers: T1, T2, T3.

### TA-16 — T1 parser version fail-closed (C23)
`InstructionConstraints.parser_version: u8` field. If a T1 parser version mismatch is detected (SDK ≠ on-chain), the entry guard rejects with `ErrParserVersionMismatch`. Field on InstructionConstraints, no new ix. Tiers: T1 only (T2/T3 have no parser).

---

## Attacker Classes (AC-1..AC-10)

Per [THREAT_MODEL_V2.md §2](./THREAT_MODEL_V2.md#2-attacker-classes--environmental-hazards) for full characterization. Brief here:

### AC-1 — Agent key leak
Session-key compromise via prompt injection, malicious tool call, agent host compromise, supply-chain attack.

### AC-2 — Owner key leak
Single-key owner phishing / hardware compromise / key-management failure. Mitigated by Squads V4 multisig per [D-05](#d-05--squads-v4-upgrade-authority) at the SDK layer (off-chain detection helper) plus [D-06](#d-06--tierregistry-asymmetric-threshold) registry-write threshold. **NOT a numbered TA primitive** — Squads detection is off-chain SDK ergonomics, not an on-chain enforcement primitive.

### AC-3 — Sigil program bug
Assertion bypass, integer overflow, missing constraint check, account validation gap in Sigil itself.

### AC-4 — Token-2022 silent drain
Malicious mint with `TransferFee`, `TransferHook`, `PermanentDelegate`, `DefaultAccountState::Frozen`, or `MintCloseAuthority` extensions.

### AC-5 — Protocol exploit
Exploit in a target protocol (Jupiter, Kamino, Drift, etc.) causing vault asset loss when the vault interacts with the exploited protocol.

### AC-6 — Stablecoin depeg
USDC or USDT depegs significantly from $1.00. Environmental hazard; accepted per documented unit-of-account.

### AC-7 — Network halt
Solana mainnet halts. Environmental hazard; Sigil cannot operate during halt. Symmetric (attacker can't drain either).

### AC-8 — CU exhaustion
Adversarial transaction crafted to exceed compute budget (1.4M CU) and revert. DoS, not theft.

### AC-9 — Sandwich injection
Attacker injects an instruction between Sigil's `validate_and_authorize` and `finalize_session` to perform a non-Sigil-authorized operation atomically.

### AC-10 — Durable nonce replay
A signed transaction using a durable nonce remains valid indefinitely. A leaked pre-signed instruction can execute at any time. Drift's April 2026 $285M loss precedent.

### AC-11 — Oracle staleness (V1 OUT-OF-SCOPE)
Pyth or Switchboard returns stale price data, leading a protocol to mis-price a vault position. Sigil does not consume oracles in V1. Folded into N1 TA-15 temporal binding (slot+blockhash double-bind) per D-09. v1.1 candidate for dual-floor with Pyth lazy fetch only when within 10% of floor.

### T-21 — Owner Policy Underspecification (workflow-mitigated)
Trust-assumption inversion: users empirically cannot pre-specify policy correctly. Maestro 60%+ default-policy rate. Workflow mitigations M-T21-1..4 (learning mode, attestation, onboarding wizard, tier-visibility UI). NOT an on-chain primitive.

### T-DoS-1 — Auto-revoke spam
Adversary spams crafted-failing bundles to trigger auto-revoke counter, denying legitimate agent service. V1 mitigation: auto-revoke deferred + per-action cooldown TA-06 rate-limits any counter increment.

### T-DoS-2 — Cosign lost-key brick
Agent session key lost; TA-09 cosign workflow wedges elevated operations. V1 mitigation: owner-only `force_unbind_session(vault, session)` with K5 timelock (48h).

### T-K6-1 — K6 silent emit failure
Highest-leverage single dependency per Architect 2026-05-17. CI static check + Stage 5 Inv-K6 formal verification target.

---

## Decisions (D-01..D-09)

### D-01 — Architecture pivot
Deep-parsing universal walker → generic Maestro-floor + N1/N2/N4 always-on + NM-E for T1 verified short-list only.

### D-02 — Three-tier model
T1 verified (~10 protocols), T2 Anchor-IDL (~48), T3 No-IDL (fail-closed default).

### D-03 — Unit of account
USDC face value at 1:1, not USD. No Pyth oracle in V1. Maestro precedent.

### D-04 — Funding gate
External audit + bug bounty are mainnet-only gates ($100K-$350K obligation per [ACCEPTANCE_V2.md §4](./ACCEPTANCE_V2.md#4-funding-plan)). Stage 6 sequencing.

### D-05 — Squads V4 upgrade authority
Closes DEEP-9 (single-key upgrade authority) + DEEP-10 (solo founder bus factor). Program ID `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`. 3-of-5 + 24-72hr timelock + autonomous mode (`config_authority == Pubkey::default()`).

### D-06 — TierRegistry asymmetric threshold
Tier registry writes require 4-of-5 (strictly greater than 3-of-5 program upgrade threshold). Rationale: malicious tier promotion harder to detect than code change (bytecode hash unchanged); asymmetric threshold makes the registry the hardest surface to compromise. Per Council Debate output 2026-05-17.

### D-07 — Lighthouse pattern: INSPIRE not FORK
Sigil's PostExecutionAssertions IR shape is inspired by Lighthouse's 14 assertion types (per GeminiResearcher validation 2026-05-17: actual count is 14, not the previously-cited 8). No CPI to Lighthouse program; no fork of Lighthouse source. Append-only top-level instructions = zero upgrade-key contagion.

### D-08 — Anchor 0.32.1 for audit
Stay on Anchor 0.32.1 for the V2 audit cycle. Defer Anchor 1.0 migration to v1.1 post-mainnet. Rationale: minimize moving parts during audit; the 0.32 → 1.0 migration is a separate ~1-day effort once ecosystem stabilizes.

### D-09 — AC-11 oracle staleness out-of-V1
AC-11 (oracle staleness) is explicitly out-of-scope for V1. Folded into N1 TA-15 temporal binding (slot+blockhash double-bind) for any caller that wants oracle-style verification. v1.1 candidate for dual-floor dollar-value tracking with Pyth lazy fetch.

---

## Error Code Allocation

Per `programs/sigil/src/errors.rs` (post-Stage-1 escrow removal — variant count shifted from 88 → 81 after 7 escrow variants were deleted):
- **6000-6080**: V1 error codes (81 variants currently). Sigil v1.0 stable.
- **6081-6103**: Reserved for V2 additions (Stage 2-3 implementation):
  - 6081 `ErrDestinationNotAllowed` (TA-02)
  - 6082 `ErrMintNotPinned` (TA-03)
  - 6083 `ErrStableFloorViolation` (TA-12)
  - 6084 `ErrDailyCapExceeded` (TA-13)
  - 6085 `ErrRecipientCapExceeded` (TA-14)
  - 6086 `ErrVelocityCapExceeded` (TA-06 cooldown)
  - 6087 `ErrInvalidCapability` (TA-04)
  - 6088 `ErrOutsideOperatingHours` (TA-05)
  - 6089 `ErrCooldownActive` (TA-06)
  - 6090 `ErrGraylistFriction` (TA-07)
  - 6091 `ErrGraylistFull` (TA-07)
  - 6092 `ErrToken2022ExtensionForbidden` (TA-08)
  - 6093 `ErrSandwichIntegrity` (TA-10)
  - 6094 `ErrProtectedWritable` (TA-11)
  - 6095 `ErrCosignRequired` (TA-09)
  - 6096 `ErrSessionNonceMismatch` (K2 + AC-10)
  - 6097 `ErrParserVersionMismatch` (TA-16)
  - 6098-6103 Reserved for V2.x additions

The project-root `CLAUDE.md` cites range "6000-6070" — that is stale. Real current count is 6000-6080 (81 variants verified via `grep -c '#\[msg' programs/sigil/src/errors.rs` on `revamp/v2-2026-05`). `ErrAutoRevoked` is NOT allocated in V2 — auto-revoke is deferred per [REVAMP_PLAN.md §6.1 Def-6](./REVAMP_PLAN.md#61-deferred-to-v11-post-mainnet); if added in v1.1, allocate from 6098+.

---

**END OF INTERFACES_V2.md**
