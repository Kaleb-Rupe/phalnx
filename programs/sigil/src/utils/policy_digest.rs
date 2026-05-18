//! TA-19 — canonical policy preview digest.
//!
//! Both the SDK (`computePolicyPreviewDigest` in `sdk/kit/src/policy/`) and the
//! on-chain handlers compute the same SHA-256 over the same Borsh-encoded bytes.
//! The owner signs the digest at `queue_policy_update` (or `initialize_vault`),
//! and `apply_pending_policy` re-asserts it before any field is copied to the
//! live policy.
//!
//! CANONICAL ENCODING (FIXED — DO NOT REORDER, breaking this changes existing
//! pending digests). All fields use stock Borsh:
//!
//! 1. `daily_spending_cap_usd: u64`   (8 bytes, LE)
//! 2. `max_transaction_size_usd: u64` (8 bytes, LE)
//! 3. `max_slippage_bps: u16`         (2 bytes, LE)
//! 4. `developer_fee_rate: u16`       (2 bytes, LE) — PEN-CROSS-6 (Phase 2 close-up)
//! 5. `protocol_mode: u8`             (1 byte)
//! 6. `protocols: Vec<Pubkey>`        (4 byte LE len ++ each Pubkey 32 bytes)
//! 7. `destination_mode: u8`          (1 byte)
//! 8. `allowed_destinations: Vec<Pubkey>` (4 byte LE len ++ each Pubkey 32 bytes)
//! 9. `timelock_duration: u64`        (8 bytes, LE)
//! 10. `session_expiry_seconds: u64`  (8 bytes, LE)
//! 11. `observe_only: bool`           (1 byte, 0 or 1)
//! 12. `has_constraints: bool`        (1 byte, 0 or 1)
//! 13. `has_post_assertions: u8`      (1 byte)
//! 14. `created_at_slot: u64`         (8 bytes, LE) — PEN-CROSS-2 (Phase 2 close-up)
//! 15. `operating_hours: u32`         (4 bytes, LE) — TA-05 (Phase 3 pre-exec)
//! 16. `auto_promote_grays: bool`     (1 byte, 0/1)  — TA-07 (Phase 3 pre-exec)
//! 17. `auto_revoke_threshold: u8`    (1 byte)       — TA-17 (Phase 3 pre-exec)
//! 18. `stable_balance_floor: u64`    (8 bytes, LE)  — TA-12 (Phase 5 post-exec)
//!
//! Phase 3 append-only additions (TA-05/07/17): the three new policy-owned
//! fields are appended at positions 15-17 to preserve the existing 14-field
//! prefix (F-14 APPEND-ONLY rule).
//!
//! Phase 5 append-only addition (TA-12): `stable_balance_floor` appended at
//! position 18. The owner's chosen reserve is part of the signed policy —
//! a compromised SDK or pending-PDA tamperer cannot silently lower it.
//!
//! The graylist itself (`destination_graylist: Vec<(Pubkey, i64)>`) is
//! intentionally NOT in the digest. Reasoning: graylist entries are
//! derived/ephemeral — they auto-populate when the owner adds a new
//! destination via `queue_policy_update`, and they only delay an already-
//! signed allowlist entry. The owner-signed digest already binds the
//! destination allowlist (position 8). Promoting via
//! `promote_graylist_destination` only accelerates the existing unlock — it
//! cannot widen the allowlist. So including the graylist would force the
//! owner to re-sign the digest on every unlock-time advancement, which is
//! ephemeral noise. The allowlist (position 8) carries the load-bearing
//! authorisation; the graylist is unsigned friction. By contrast,
//! `auto_promote_grays` IS in the digest: the owner's CHOICE to bypass
//! friction is configuration, not ephemeral state.

use anchor_lang::prelude::*;
// Note: `anchor_lang::solana_program::hash` is NOT re-exported in Anchor 0.32.1.
// Use the `solana-program` direct dep (declared in Cargo.toml).
use solana_program::hash::hashv;

/// Canonical preview fields. Owner re-creates this off-chain via the SDK; the
/// handler re-creates it on-chain from the resulting `PolicyConfig` (or the
/// merge of `PolicyConfig + PendingPolicyUpdate`). The two SHA-256 digests
/// must match.
pub struct PolicyPreviewFields<'a> {
    pub daily_spending_cap_usd: u64,
    pub max_transaction_size_usd: u64,
    pub max_slippage_bps: u16,
    /// PEN-CROSS-6 (Phase 2 close-up): `developer_fee_rate` lives on
    /// `PolicyConfig` but was previously NOT in the digest. A compromised SDK
    /// could insert a non-zero fee rate that bypasses the user's signed
    /// digest. Now bound at position 4 of the canonical encoding.
    pub developer_fee_rate: u16,
    pub protocol_mode: u8,
    pub protocols: &'a [Pubkey],
    pub destination_mode: u8,
    pub allowed_destinations: &'a [Pubkey],
    pub timelock_duration: u64,
    pub session_expiry_seconds: u64,
    pub observe_only: bool,
    pub has_constraints: bool,
    pub has_post_assertions: u8,
    /// PEN-CROSS-2 (Phase 2 close-up): the slot at which the vault was
    /// initialized. Closes the close+reinit replay window — replaying a
    /// signed `initialize_vault` against a fresh (owner, vault_id) PDA
    /// produces a slot mismatch and `PolicyPreviewMismatch` rejects it.
    pub created_at_slot: u64,
    /// TA-05 (Phase 3): 24-bit UTC operating-hours bitmask. Bit `n` set →
    /// the vault permits spending at UTC hour `n`. Bound at position 15 of
    /// the canonical digest so owner-blind-sign cannot land a permissive
    /// 0xFFFFFF when the owner thought they signed a narrow market-hours
    /// mask. Upper 8 bits (24..=31) MUST be zero — handler rejects with
    /// `ErrOutsideOperatingHours` if violated.
    pub operating_hours: u32,
    /// TA-07 (Phase 3): owner's "skip 24h graylist friction" toggle. The
    /// graylist Vec itself is NOT in the digest (derived/ephemeral, gated
    /// by the already-bound allowlist at position 8), but the owner's
    /// CHOICE to bypass it IS — silent flips can't change the friction
    /// model. Bound at position 16.
    pub auto_promote_grays: bool,
    /// TA-17 (Phase 3): consecutive-failure threshold for auto-revoke.
    /// Range 3..=20 enforced at policy-write time. Bound at position 17.
    pub auto_revoke_threshold: u8,
    /// TA-12 (Phase 5): owner-chosen hard floor on combined USDC + USDT
    /// vault balance, asserted at the end of every finalize_session
    /// spending path. 6-decimal USDC face value. Bound at position 18.
    pub stable_balance_floor: u64,
}

/// SHA-256 over the canonical Borsh encoding of the preview fields.
///
/// On-chain memory budget: bounded by `MAX_ALLOWED_PROTOCOLS` (10) +
/// `MAX_ALLOWED_DESTINATIONS` (10) at 32 bytes each + the fixed-width scalars.
/// Worst-case ~700 bytes, comfortably below the BPF stack limit. We use
/// `hashv` on a contiguous `Vec<u8>` rather than incremental hashing because
/// SHA-256 is single-pass and the bound is tight.
pub fn compute_policy_preview_digest(fields: &PolicyPreviewFields<'_>) -> [u8; 32] {
    // Pre-size: 8+8+2+2+1 + 4+32*10 + 1 + 4+32*10 + 8+8+1+1+1+8+4 = ~692 bytes worst case
    let mut buf: Vec<u8> = Vec::with_capacity(720);

    // 1. daily_spending_cap_usd: u64 LE
    buf.extend_from_slice(&fields.daily_spending_cap_usd.to_le_bytes());
    // 2. max_transaction_size_usd: u64 LE
    buf.extend_from_slice(&fields.max_transaction_size_usd.to_le_bytes());
    // 3. max_slippage_bps: u16 LE
    buf.extend_from_slice(&fields.max_slippage_bps.to_le_bytes());
    // 4. developer_fee_rate: u16 LE — PEN-CROSS-6 (Phase 2 close-up)
    buf.extend_from_slice(&fields.developer_fee_rate.to_le_bytes());
    // 5. protocol_mode: u8
    buf.push(fields.protocol_mode);
    // 6. protocols: Vec<Pubkey> — Borsh u32-LE length then concatenated pubkey bytes
    buf.extend_from_slice(&(fields.protocols.len() as u32).to_le_bytes());
    for pk in fields.protocols.iter() {
        buf.extend_from_slice(pk.as_ref());
    }
    // 7. destination_mode: u8
    buf.push(fields.destination_mode);
    // 8. allowed_destinations: Vec<Pubkey>
    buf.extend_from_slice(&(fields.allowed_destinations.len() as u32).to_le_bytes());
    for pk in fields.allowed_destinations.iter() {
        buf.extend_from_slice(pk.as_ref());
    }
    // 9. timelock_duration: u64 LE
    buf.extend_from_slice(&fields.timelock_duration.to_le_bytes());
    // 10. session_expiry_seconds: u64 LE
    buf.extend_from_slice(&fields.session_expiry_seconds.to_le_bytes());
    // 11. observe_only: bool as 1 byte (0/1)
    buf.push(u8::from(fields.observe_only));
    // 12. has_constraints: bool as 1 byte
    buf.push(u8::from(fields.has_constraints));
    // 13. has_post_assertions: u8
    buf.push(fields.has_post_assertions);
    // 14. created_at_slot: u64 LE — PEN-CROSS-2 (Phase 2 close-up)
    buf.extend_from_slice(&fields.created_at_slot.to_le_bytes());
    // 15. operating_hours: u32 LE — TA-05 (Phase 3 pre-exec)
    buf.extend_from_slice(&fields.operating_hours.to_le_bytes());
    // 16. auto_promote_grays: bool as 1 byte (0/1) — TA-07 (Phase 3 pre-exec)
    buf.push(u8::from(fields.auto_promote_grays));
    // 17. auto_revoke_threshold: u8 — TA-17 (Phase 3 pre-exec)
    buf.push(fields.auto_revoke_threshold);
    // 18. stable_balance_floor: u64 LE — TA-12 (Phase 5 post-exec invariant)
    buf.extend_from_slice(&fields.stable_balance_floor.to_le_bytes());

    hashv(&[&buf]).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(b: u8) -> Pubkey {
        Pubkey::new_from_array([b; 32])
    }

    #[test]
    fn digest_is_deterministic() {
        let protocols = [pk(1), pk(2)];
        let dests = [pk(10)];
        let f = PolicyPreviewFields {
            daily_spending_cap_usd: 500_000_000,
            max_transaction_size_usd: 100_000_000,
            max_slippage_bps: 100,
            developer_fee_rate: 0,
            protocol_mode: 1,
            protocols: &protocols,
            destination_mode: 0,
            allowed_destinations: &dests,
            timelock_duration: 1800,
            session_expiry_seconds: 30,
            observe_only: false,
            has_constraints: false,
            has_post_assertions: 0,
            created_at_slot: 0,
            operating_hours: 0,
            auto_promote_grays: false,
            auto_revoke_threshold: 0,
            stable_balance_floor: 0,
        };
        let d1 = compute_policy_preview_digest(&f);
        let d2 = compute_policy_preview_digest(&f);
        assert_eq!(d1, d2, "same fields must produce same digest");
    }

    #[test]
    fn digest_changes_on_observe_only_flip() {
        let protocols = [pk(1)];
        let dests = [pk(10)];
        let base = PolicyPreviewFields {
            daily_spending_cap_usd: 1,
            max_transaction_size_usd: 1,
            max_slippage_bps: 0,
            developer_fee_rate: 0,
            protocol_mode: 1,
            protocols: &protocols,
            destination_mode: 0,
            allowed_destinations: &dests,
            timelock_duration: 1800,
            session_expiry_seconds: 30,
            observe_only: false,
            has_constraints: false,
            has_post_assertions: 0,
            created_at_slot: 0,
            operating_hours: 0,
            auto_promote_grays: false,
            auto_revoke_threshold: 0,
            stable_balance_floor: 0,
        };
        let mut flipped = base.daily_spending_cap_usd;
        let _ = &mut flipped; // suppress unused
        let d_base = compute_policy_preview_digest(&base);
        let f_observe = PolicyPreviewFields {
            observe_only: true,
            ..base
        };
        let d_flip = compute_policy_preview_digest(&f_observe);
        assert_ne!(d_base, d_flip, "observe_only flip MUST change digest");
    }

    #[test]
    fn digest_changes_on_protocols_reorder() {
        // Same set, different order — encoding is ordered, so digest differs.
        // (SDK and on-chain both encode in slice order, so the two sides agree.)
        let a = [pk(1), pk(2)];
        let b = [pk(2), pk(1)];
        let dests = [pk(10)];
        let f1 = PolicyPreviewFields {
            daily_spending_cap_usd: 1,
            max_transaction_size_usd: 1,
            max_slippage_bps: 0,
            developer_fee_rate: 0,
            protocol_mode: 1,
            protocols: &a,
            destination_mode: 0,
            allowed_destinations: &dests,
            timelock_duration: 1800,
            session_expiry_seconds: 30,
            observe_only: false,
            has_constraints: false,
            has_post_assertions: 0,
            created_at_slot: 0,
            operating_hours: 0,
            auto_promote_grays: false,
            auto_revoke_threshold: 0,
            stable_balance_floor: 0,
        };
        let f2 = PolicyPreviewFields {
            protocols: &b,
            ..f1
        };
        let d1 = compute_policy_preview_digest(&f1);
        let d2 = compute_policy_preview_digest(&f2);
        assert_ne!(d1, d2, "ordered slice → reorder must change digest");
    }

    /// TA-05 (Phase 3 pre-exec): flipping operating_hours from 0x00FFFFFF
    /// (all 24 hours) to a narrower mask MUST change the canonical digest.
    /// Without this, an owner who signed a narrow market-hours mask could
    /// be tricked into landing a permissive 0xFFFFFF on-chain.
    #[test]
    fn digest_changes_on_operating_hours_flip() {
        let protocols = [pk(1)];
        let dests = [pk(10)];
        let base = PolicyPreviewFields {
            daily_spending_cap_usd: 500_000_000,
            max_transaction_size_usd: 100_000_000,
            max_slippage_bps: 100,
            developer_fee_rate: 0,
            protocol_mode: 1,
            protocols: &protocols,
            destination_mode: 0,
            allowed_destinations: &dests,
            timelock_duration: 1800,
            session_expiry_seconds: 30,
            observe_only: false,
            has_constraints: false,
            has_post_assertions: 0,
            created_at_slot: 12345,
            operating_hours: 0x00FFFFFF,
            auto_promote_grays: false,
            auto_revoke_threshold: 0,
            stable_balance_floor: 0,
        };
        let narrow = PolicyPreviewFields {
            // 13:00-17:00 UTC = bits 13..17 = 0x1E000
            operating_hours: 0x0001E000,
            ..base
        };
        let d_base = compute_policy_preview_digest(&base);
        let d_narrow = compute_policy_preview_digest(&narrow);
        assert_ne!(
            d_base, d_narrow,
            "operating_hours flip MUST change digest"
        );
    }

    /// TA-07 (Phase 3): flipping auto_promote_grays MUST change the digest.
    /// The owner's CHOICE to bypass graylist friction is bound by TA-19 —
    /// silent flips can't change the friction model.
    #[test]
    fn digest_changes_on_auto_promote_grays_flip() {
        let protocols = [pk(1)];
        let dests = [pk(10)];
        let base = PolicyPreviewFields {
            daily_spending_cap_usd: 500_000_000,
            max_transaction_size_usd: 100_000_000,
            max_slippage_bps: 100,
            developer_fee_rate: 0,
            protocol_mode: 1,
            protocols: &protocols,
            destination_mode: 0,
            allowed_destinations: &dests,
            timelock_duration: 1800,
            session_expiry_seconds: 30,
            observe_only: false,
            has_constraints: false,
            has_post_assertions: 0,
            created_at_slot: 12345,
            operating_hours: 0x00FFFFFF,
            auto_promote_grays: false,
            auto_revoke_threshold: 5,
            stable_balance_floor: 0,
        };
        let flipped = PolicyPreviewFields {
            auto_promote_grays: true,
            ..base
        };
        let d_base = compute_policy_preview_digest(&base);
        let d_flip = compute_policy_preview_digest(&flipped);
        assert_ne!(
            d_base, d_flip,
            "auto_promote_grays flip MUST change digest"
        );
    }

    /// TA-17 (Phase 3): auto_revoke_threshold is bound by the digest. A
    /// threshold of 3 vs 20 produces distinct digests.
    #[test]
    fn digest_changes_on_auto_revoke_threshold_flip() {
        let protocols = [pk(1)];
        let dests = [pk(10)];
        let base = PolicyPreviewFields {
            daily_spending_cap_usd: 500_000_000,
            max_transaction_size_usd: 100_000_000,
            max_slippage_bps: 100,
            developer_fee_rate: 0,
            protocol_mode: 1,
            protocols: &protocols,
            destination_mode: 0,
            allowed_destinations: &dests,
            timelock_duration: 1800,
            session_expiry_seconds: 30,
            observe_only: false,
            has_constraints: false,
            has_post_assertions: 0,
            created_at_slot: 12345,
            operating_hours: 0x00FFFFFF,
            auto_promote_grays: false,
            auto_revoke_threshold: 5,
            stable_balance_floor: 0,
        };
        let lower = PolicyPreviewFields {
            auto_revoke_threshold: 3,
            ..base
        };
        let d_base = compute_policy_preview_digest(&base);
        let d_lower = compute_policy_preview_digest(&lower);
        assert_ne!(
            d_base, d_lower,
            "auto_revoke_threshold flip MUST change digest"
        );
    }

    /// TA-12 (Phase 5 post-exec): flipping stable_balance_floor MUST change
    /// the canonical digest. The owner's chosen reserve is part of the
    /// signed policy — silent flips can't drop the floor and let an attacker
    /// drain past it.
    #[test]
    fn digest_changes_on_stable_balance_floor_flip() {
        let protocols = [pk(1)];
        let dests = [pk(10)];
        let base = PolicyPreviewFields {
            daily_spending_cap_usd: 500_000_000,
            max_transaction_size_usd: 100_000_000,
            max_slippage_bps: 100,
            developer_fee_rate: 0,
            protocol_mode: 1,
            protocols: &protocols,
            destination_mode: 0,
            allowed_destinations: &dests,
            timelock_duration: 1800,
            session_expiry_seconds: 30,
            observe_only: false,
            has_constraints: false,
            has_post_assertions: 0,
            created_at_slot: 12345,
            operating_hours: 0x00FFFFFF,
            auto_promote_grays: false,
            auto_revoke_threshold: 5,
            stable_balance_floor: 0,
        };
        let raised = PolicyPreviewFields {
            // $100 floor in 6-decimal USDC face value
            stable_balance_floor: 100_000_000,
            ..base
        };
        let d_base = compute_policy_preview_digest(&base);
        let d_raised = compute_policy_preview_digest(&raised);
        assert_ne!(
            d_base, d_raised,
            "stable_balance_floor flip MUST change digest"
        );
    }

    #[test]
    fn digest_known_value_for_minimal_policy() {
        // Pin a known-good byte sequence so SDK + on-chain regressions surface
        // immediately. Empty vectors, all-zero scalars, baseline RESTRICTED.
        let f = PolicyPreviewFields {
            daily_spending_cap_usd: 0,
            max_transaction_size_usd: 0,
            max_slippage_bps: 0,
            developer_fee_rate: 0,
            protocol_mode: 1,
            protocols: &[],
            destination_mode: 0,
            allowed_destinations: &[],
            timelock_duration: 0,
            session_expiry_seconds: 0,
            observe_only: false,
            has_constraints: false,
            has_post_assertions: 0,
            created_at_slot: 0,
            // Minimal fixture uses operating_hours=0 (no hours enabled — an
            // inert configuration, but the bytes are deterministic).
            operating_hours: 0,
            // TA-07/17 minimal pins: both zero.
            auto_promote_grays: false,
            auto_revoke_threshold: 0,
            // TA-12 minimal pin: zero floor (default — no reserve).
            stable_balance_floor: 0,
        };
        // Encoding: 8 zero + 8 zero + 2 zero + 2 zero (developer_fee_rate)
        //   + 0x01 + 4 zero + 0x00 + 4 zero + 8 zero + 8 zero + 0 + 0 + 0
        //   + 8 zero (created_at_slot) + 4 zero (operating_hours TA-05)
        //   + 0 (auto_promote_grays TA-07) + 0 (auto_revoke_threshold TA-17)
        //   + 8 zero (stable_balance_floor TA-12)
        // = 69 bytes deterministic input.
        let digest = compute_policy_preview_digest(&f);
        // Cross-impl pin — same fixture is asserted byte-for-byte in
        // sdk/kit/tests/policy/preview-digest.test.ts. If either side
        // changes the canonical encoding, BOTH digests change and the
        // two tests fail in lock-step. Prior digests:
        //   Pre-PEN-CROSS-6:
        //     29f9a0caa6851902abe7de24ac30380ef50c220d25d541f8fe1762793152b623
        //   Post-PEN-CROSS-6 (pre-PEN-CROSS-2):
        //     0ad67bf0d81b972c60abe82ebea425d4b30d0ef910bcc7b76584fae36a0f1252
        //   Post-PEN-CROSS-2 (pre-TA-05):
        //     63974a2661afc539fc8f1e55245adcef9e3b91f82a191c757ed3c795e8e59148
        //   Post-TA-05 (pre-TA-07/17):
        //     f48fb07695e4b5da504654ad5281f0d39e9fcff6fa9cde64a463f1d8a8471322
        //   Post-TA-07/17 (pre-TA-12):
        //     eec4230cd52f7f567e06e9b197a0dacdc3955808d1a5a256d5975a4ac1177beb
        // TA-12 (Phase 5) appends 8 more bytes (stable_balance_floor=0) at
        // position 18. New digest computed by the test below — re-pinned
        // here for the SDK-side fixture parity.
        let expected: [u8; 32] = REGENERATED_HEX_MINIMAL;
        assert_eq!(
            digest, expected,
            "minimal-policy digest must match SDK fixture (sdk/kit/tests/policy/preview-digest.test.ts)"
        );
    }

    #[test]
    fn digest_known_value_for_realistic_policy() {
        // Realistic policy: 2 protocols, 1 destination, common scalars. Same
        // fixture asserted in sdk/kit/tests/policy/preview-digest.test.ts.
        // Pubkey fill bytes used: [1u8;32], [2u8;32], [10u8;32].
        let protocols = [pk(1), pk(2)];
        let dests = [pk(10)];
        let f = PolicyPreviewFields {
            daily_spending_cap_usd: 500_000_000,
            max_transaction_size_usd: 100_000_000,
            max_slippage_bps: 100,
            developer_fee_rate: 0,
            protocol_mode: 1,
            protocols: &protocols,
            destination_mode: 0,
            allowed_destinations: &dests,
            timelock_duration: 1800,
            session_expiry_seconds: 30,
            observe_only: false,
            has_constraints: false,
            has_post_assertions: 0,
            // PEN-CROSS-2: realistic fixture exercises a non-zero
            // created_at_slot to lock the byte layout of an active vault.
            created_at_slot: 12345,
            // TA-05: realistic fixture pins operating_hours = 0x00FFFFFF
            // (all 24h) so the test exercises a representative production
            // value rather than the inert 0.
            operating_hours: 0x00FFFFFF,
            // TA-07: realistic fixture pins auto_promote_grays=false
            // (default — owner did not opt out of friction).
            auto_promote_grays: false,
            // TA-17: realistic fixture pins the default threshold of 5.
            auto_revoke_threshold: 5,
            // TA-12 realistic pin: $100 floor in 6-decimal USDC face value.
            // Exercises a non-zero floor on the canonical byte layout.
            stable_balance_floor: 100_000_000,
        };
        let digest = compute_policy_preview_digest(&f);
        // Prior digests:
        //   Pre-PEN-CROSS-6:
        //     33d743a9643fcc6d39c30ac5f8c159d6e94d31ce354d6dd3843367773b3a8502
        //   Post-PEN-CROSS-6 (pre-PEN-CROSS-2, created_at_slot=0 not yet encoded):
        //     ed9ac12d21e0f03933bbf789eae99944c311f2ff6f1baff992058307174de316
        //   Post-PEN-CROSS-2 (pre-TA-05):
        //     ac54284579f4b8afd714b290ec22df745bddbede9a5b366f17c8db776fab53c7
        //   Post-TA-05 (pre-TA-07/17):
        //     af3990ea433e3de25baa05627f9a38ab497dffcba1e202aac99343b1de9cfc8c
        //   Post-TA-07/17 (pre-TA-12):
        //     35ed9a9f97b0fa21ca581bd45f11b28c2932525101e9be063cc0d2f6bebc3c48
        // TA-12 (Phase 5) appends 8 more bytes (stable_balance_floor=100_000_000)
        // at position 18. New digest below.
        let expected: [u8; 32] = REGENERATED_HEX_REALISTIC;
        assert_eq!(
            digest, expected,
            "realistic-policy digest must match SDK fixture"
        );
    }
}

/// TA-12 Phase 5 minimal-policy expected digest.
///
/// Computed over the canonical 69-byte encoding:
///   - all 17 prior fields zero (or default), plus
///   - stable_balance_floor = 0 (u64 LE, 8 bytes)
///
/// = `d3e731941e95cb1c426ccc6f2b5c53525c033f498bdb79a593bc86c98508c67a`
#[cfg(test)]
const REGENERATED_HEX_MINIMAL: [u8; 32] = [
    0xd3, 0xe7, 0x31, 0x94, 0x1e, 0x95, 0xcb, 0x1c, 0x42, 0x6c, 0xcc, 0x6f, 0x2b, 0x5c, 0x53, 0x52,
    0x5c, 0x03, 0x3f, 0x49, 0x8b, 0xdb, 0x79, 0xa5, 0x93, 0xbc, 0x86, 0xc9, 0x85, 0x08, 0xc6, 0x7a,
];

/// TA-12 Phase 5 realistic-policy expected digest.
///
/// Realistic fixture with 2 protocols, 1 destination, common scalars, and
/// `stable_balance_floor = 100_000_000` ($100 reserve).
///
/// = `6523cb9b64baef661d919c802a8762332d1091cb53e8245d1624f52839fc9c8c`
#[cfg(test)]
const REGENERATED_HEX_REALISTIC: [u8; 32] = [
    0x65, 0x23, 0xcb, 0x9b, 0x64, 0xba, 0xef, 0x66, 0x1d, 0x91, 0x9c, 0x80, 0x2a, 0x87, 0x62, 0x33,
    0x2d, 0x10, 0x91, 0xcb, 0x53, 0xe8, 0x24, 0x5d, 0x16, 0x24, 0xf5, 0x28, 0x39, 0xfc, 0x9c, 0x8c,
];
