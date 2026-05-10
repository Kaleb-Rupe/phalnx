# V1 Launch Runbook — AgentShield

## CRITICAL: Program upgrade authority

The Sigil program at `4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL` has a single
on-chain field that bypasses every constraint, every CPI guard, every
discriminator check, every blocklist: the **upgrade authority**.

Anyone who controls the upgrade authority can:
- Deploy a new program binary with all guards removed
- Drain every vault on the next agent action
- Replace error variants to silently bypass dashboard error parsing

**Drift Protocol April 2026 lost $285M to exactly this attack class** —
durable-nonce pre-signed admin-transfer transactions executed at slots the
attacker chose. The on-chain code held; the upgrade-authority key holder
was social-engineered.

### Squads vault PDA (pinned, V1):

```
Base58:    7tvi5yJZyjpxXnbPTcR42mKVK7qbnjRjViTXv1rckNsy
Threshold: 3-of-5
Members:   5 distinct humans (3 hardware wallets + 2 hot keys)
Network:   IDENTICAL on devnet and mainnet (Squads V4 createKey reuse)
```

This address is hard-coded into the program at
`programs/sigil/src/state/mod.rs` under `cfg(feature = "mainnet")`. Any
attempt to build a mainnet binary with a different `PROTOCOL_TREASURY`
must edit that constant, which is reviewed under the
`mainnet-build-readiness` CI gate.

**Devnet rehearsal mode:** Squads exposes a devnet UI at
`https://app.squads.so/?cluster=devnet`. Because Squads V4 vault PDAs
derive from `createKey + program id` (network-agnostic), the
**rehearsal address is the literal mainnet address**. Members joining the
multisig on devnet pre-flight are joining the same multisig that will
hold mainnet upgrade authority. Treat devnet acceptance as binding.

### Pre-mainnet (BEFORE deploying):

- [x] Squads V4 multisig configured: 3-of-5 signers, geographic distribution
      (5 humans across distinct locations)
- [ ] **Hot-key signer risk acknowledged.** 2 of 5 members use hot keys
      (audit-preferred state was 5/5 hardware). Compensating mitigations:
      - Hot-key members co-located with primary device offline-cold-storage
        seed backup, never on the signing machine
      - Multisig threshold (3-of-5) means full hot-key compromise alone
        cannot ship an upgrade — adversary must additionally social-engineer
        at least one hardware-wallet signer
      - V1.1 plan: rotate hot-key members to hardware via Squads
        `member_add` + `member_remove` proposals, no protocol change needed
      - Document the rotation runbook in `docs/SECURITY.md` Q3 section
- [ ] Devnet rehearsal: transfer upgrade authority to Squads vault PDA via SAT
      (Safe Authority Transfer), verify via `solana program show <PROGRAM_ID>`.
      Sign at `https://app.squads.so/?cluster=devnet` — rehearsal address
      `7tvi5yJZyjpxXnbPTcR42mKVK7qbnjRjViTXv1rckNsy` IS the mainnet address.
- [ ] Recovery procedure documented: signer death/loss/compromise paths, with
      specific contact list and 72-hour rotation SLA
- [ ] Test: signers practice rejecting a "routine update" that's actually
      malicious — durable-nonce pre-signed apply_pending_policy from a
      fresh-looking address with a fresh-looking diff

### V1.0 mainnet deploy day:

- [ ] Deploy with hot key (faster iteration)
- [ ] Smoke-test 1 read-only ix on mainnet
- [ ] Upload IDL via PMP under hot key
- [ ] Run 1 real ix (vault create) end-to-end
- [ ] **Then** transfer upgrade authority to Squads via SAT
- [ ] Verify `Authority` field on `solana program show` equals
      `7tvi5yJZyjpxXnbPTcR42mKVK7qbnjRjViTXv1rckNsy` (string-match, byte-match)
- [ ] Within 24h: smoke-test a Squad-routed upgrade with no-op IDL bump

### V1.1 (within 30 days post-mainnet):

- [ ] Add slot-bounded freshness check on `apply_*` instructions (F-10 fix
      lands separately at `fix/sigil-apply-instructions-slot-freshness`)
- [ ] Multi-signer ceremony for Squads transactions: every apply_* requires
      a structured-data review (full diff displayed) before signing
- [ ] Consider a "freeze upgrade authority" fork: V2 considers null upgrade
      authority once protocol stabilizes

### V2 (eventual):

- [ ] Set upgrade authority to None — protocol becomes immutable
