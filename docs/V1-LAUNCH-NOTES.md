# V1 Launch Notes — Sigil

## Known V1 Limitations

### Slippage enforcement is Jupiter-only

`policy.max_slippage_bps` is enforced ONLY when the agent's DeFi instruction
is one of:
- Jupiter aggregator (`JUP6Lkb...`)
- Flash Trade (`FLASH6Lo...`)
- Jupiter Lend / Earn / Borrow

If you allowlist a non-recognized protocol via `policy.allowed_protocols` —
e.g., Marinade, OpenBook v2, Phoenix DEX, Mango v4, Drift v2 — your slippage
policy IS NOT ENFORCED for that protocol. The on-chain program will accept
any DeFi instruction within the daily spend cap, with no slippage check.

**Workaround for V1**: only allowlist the 5 recognized DeFi programs. For
all other protocols, configure `policy.max_protocol_slippage_bps`
(post-execution stablecoin-delta cap, V1.1) once it ships.

### ~3-entry-per-call ceiling on createConstraints

The Day-0 5-instruction allocate+extend chain caps at ~3 fully-populated
ConstraintEntries per `createConstraints` call due to Solana's 1232-byte
transaction size limit. Larger constraint sets must be split across
multiple `queueConstraintsUpdate` calls. V1.1 adds an `append_constraint_entries`
instruction to remove this ceiling.

### Async-fulfillment programs blocked

Jupiter Perpetuals, Drift v2, and Drift JIT proxy are blocked outright in V1
because Sigil cannot measure spending for keeper-fulfilled transactions
(spend recorded as 0 at finalize because the actual transfer hasn't
happened yet). V1.1 adds an opt-in `policy.allow_async_fulfillment: bool`
for owners who explicitly accept this risk.

### Session expiry under network congestion

`session_expiry_slots = 20` (default) ≈ 8 seconds at 400ms/slot but can
extend to 30+ seconds during congestion (slot times can reach 1.5s). The
documented 8-second freeze-to-revoke window is a lower bound, not a
guarantee.

### Token-2022 deferred opcodes (CpiGuard, ConfTransferFee)

Opcodes 34 (CpiGuardExtension) and 37 (ConfidentialTransferFeeExtension)
are NOT in the V1 blocklist. Each has legitimate setup-only use cases that
require explicit owner-allowlist UX. V1.1 adds per-opcode
`policy.allowed_token2022_setup_opcodes: u8` bitmask. Until then, do NOT
allowlist Token-2022 mints with these extensions enabled if your agent
should not be able to call them.

### Cap pollution from abandoned sessions

The fee-to-cap fallback in `finalize_session` charges fees against the
rolling 24h cap when a session expires without a real DeFi instruction.
At 7 bps total fees, ~715 abandoned validates fully exhaust a $500 daily
cap with $0 of real spending. Mitigation: monitor for high abandoned-validate
rate via `SessionFinalized.success` events.
