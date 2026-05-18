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
    // 14. created_at_slot: u64 LE — PEN-CROSS-2 (Phase 2 close-up)
    buf.extend_from_slice(&fields.created_at_slot.to_le_bytes());

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
            created_at_slot: 0,
        };
        // Encoding: 8 zero + 8 zero + 2 zero + 2 zero (developer_fee_rate)
        //   + 0x01 + 4 zero + 0x00 + 4 zero + 8 zero + 8 zero + 0 + 0 + 0
        //   + 8 zero (created_at_slot)
        // = 57 bytes deterministic input.
        let digest = compute_policy_preview_digest(&f);
        // Cross-impl pin — same fixture is asserted byte-for-byte in
        // sdk/kit/tests/policy/preview-digest.test.ts. If either side
        // changes the canonical encoding, BOTH digests change and the
        // two tests fail in lock-step. Prior digests:
        //   Pre-PEN-CROSS-6:
        //     29f9a0caa6851902abe7de24ac30380ef50c220d25d541f8fe1762793152b623
        //   Post-PEN-CROSS-6 (pre-PEN-CROSS-2):
        //     0ad67bf0d81b972c60abe82ebea425d4b30d0ef910bcc7b76584fae36a0f1252
        // Adding 8 bytes of zero (created_at_slot=0) at position 14 shifts the
        // encoding once more and forces the new known-good digest below.
        let expected: [u8; 32] = [
            0x63, 0x97, 0x4a, 0x26, 0x61, 0xaf, 0xc5, 0x39, 0xfc, 0x8f, 0x1e, 0x55, 0x24, 0x5a,
            0xdc, 0xef, 0x9e, 0x3b, 0x91, 0xf8, 0x2a, 0x19, 0x1c, 0x75, 0x7e, 0xd3, 0xc7, 0x95,
            0xe8, 0xe5, 0x91, 0x48,
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
            // PEN-CROSS-2: realistic fixture exercises a non-zero
            // created_at_slot to lock the byte layout of an active vault.
            created_at_slot: 12345,
        };
        let digest = compute_policy_preview_digest(&f);
        // Prior digests:
        //   Pre-PEN-CROSS-6:
        //     33d743a9643fcc6d39c30ac5f8c159d6e94d31ce354d6dd3843367773b3a8502
        //   Post-PEN-CROSS-6 (pre-PEN-CROSS-2, created_at_slot=0 not yet encoded):
        //     ed9ac12d21e0f03933bbf789eae99944c311f2ff6f1baff992058307174de316
        // Adding 8 bytes of created_at_slot=12345 at position 14 forces the
        // new known-good digest below.
        let expected: [u8; 32] = [
            0xac, 0x54, 0x28, 0x45, 0x79, 0xf4, 0xb8, 0xaf, 0xd7, 0x14, 0xb2, 0x90, 0xec, 0x22,
            0xdf, 0x74, 0x5b, 0xdd, 0xbe, 0xde, 0x9a, 0x5b, 0x36, 0x6f, 0x17, 0xc8, 0xdb, 0x77,
            0x6f, 0xab, 0x53, 0xc7,
        ];
        assert_eq!(
            digest, expected,
            "realistic-policy digest must match SDK fixture"
        );
    }
}
