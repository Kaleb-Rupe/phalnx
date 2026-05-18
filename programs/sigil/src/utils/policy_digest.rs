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
}

/// SHA-256 over the canonical Borsh encoding of the preview fields.
///
/// On-chain memory budget: bounded by `MAX_ALLOWED_PROTOCOLS` (10) +
/// `MAX_ALLOWED_DESTINATIONS` (10) at 32 bytes each + the fixed-width scalars.
/// Worst-case ~700 bytes, comfortably below the BPF stack limit. We use
/// `hashv` on a contiguous `Vec<u8>` rather than incremental hashing because
/// SHA-256 is single-pass and the bound is tight.
pub fn compute_policy_preview_digest(fields: &PolicyPreviewFields<'_>) -> [u8; 32] {
    // Pre-size: 8+8+2+1 + 4+32*10 + 1 + 4+32*10 + 8+8+1+1+1 = ~684 bytes worst case
    let mut buf: Vec<u8> = Vec::with_capacity(700);

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
        };
        let f2 = PolicyPreviewFields {
            protocols: &b,
            ..f1
        };
        let d1 = compute_policy_preview_digest(&f1);
        let d2 = compute_policy_preview_digest(&f2);
        assert_ne!(d1, d2, "ordered slice → reorder must change digest");
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
        };
        // Encoding: 8 zero + 8 zero + 2 zero + 2 zero (developer_fee_rate)
        //   + 0x01 + 4 zero + 0x00 + 4 zero + 8 zero + 8 zero + 0 + 0 + 0
        // = 49 bytes deterministic input.
        let digest = compute_policy_preview_digest(&f);
        // Cross-impl pin — same fixture is asserted byte-for-byte in
        // sdk/kit/tests/policy/preview-digest.test.ts. If either side
        // changes the canonical encoding, BOTH digests change and the
        // two tests fail in lock-step. Pre-PEN-CROSS-6 digest was
        //   29f9a0caa6851902abe7de24ac30380ef50c220d25d541f8fe1762793152b623.
        // Adding 2 bytes of zero (developer_fee_rate=0) at position 4 shifts
        // the encoding and forces a new known-good digest below.
        // Post-PEN-CROSS-6 known-good digest of the 49-byte encoding above.
        let expected: [u8; 32] = [
            0x0a, 0xd6, 0x7b, 0xf0, 0xd8, 0x1b, 0x97, 0x2c, 0x60, 0xab, 0xe8, 0x2e, 0xbe, 0xa4,
            0x25, 0xd4, 0xb3, 0x0d, 0x0e, 0xf9, 0x10, 0xbc, 0xc7, 0xb7, 0x65, 0x84, 0xfa, 0xe3,
            0x6a, 0x0f, 0x12, 0x52,
        ];
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
        };
        let digest = compute_policy_preview_digest(&f);
        // Post-PEN-CROSS-6 known-good digest. Pre-fix was
        //   33d743a9643fcc6d39c30ac5f8c159d6e94d31ce354d6dd3843367773b3a8502.
        let expected: [u8; 32] = [
            0xed, 0x9a, 0xc1, 0x2d, 0x21, 0xe0, 0xf0, 0x39, 0x33, 0xbb, 0xf7, 0x89, 0xea, 0xe9,
            0x99, 0x44, 0xc3, 0x11, 0xf2, 0xff, 0x6f, 0x1b, 0xaf, 0xf9, 0x92, 0x05, 0x83, 0x07,
            0x17, 0x4d, 0xe3, 0x16,
        ];
        assert_eq!(
            digest, expected,
            "realistic-policy digest must match SDK fixture"
        );
    }
}
