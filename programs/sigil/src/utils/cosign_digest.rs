//! TA-09 (Phase 3 pre-execution guard #6): cosign-digest binding.
//!
//! `queue_policy_update` binds an "elevated mutation" pending PDA to a
//! specific cosign by hashing the canonical instruction-data of the
//! pending args + the cosign session pubkey. The cosigning session must
//! sign the SAME transaction (Solana's `is_signer`). The handler stores
//! the digest on `PendingPolicyUpdate`; `apply_pending_policy` re-computes
//! it from the persisted pending args + recorded session pubkey and
//! re-asserts equality.
//!
//! Why a digest, not just "presence of a signer"?
//!
//! The HARDENED prompt is explicit: "The session signature must cover the
//! SAME instruction-data hash (sha256 of pending args) that the owner
//! signed." A bare signer-presence check would let an attacker swap
//! pending args between queue and apply (e.g. discriminator-collision on
//! the pending PDA) while keeping the same cosign Pubkey — the apply
//! handler would see a valid signer history and a pending PDA with new
//! args. By binding the digest of the pending-args bytes + the session
//! pubkey, any mutation between queue and apply produces a digest
//! mismatch and a hard reject.
//!
//! Forward-compat note: the canonical encoding here is APPEND-ONLY — new
//! fields land at the END to preserve replayable digests for in-flight
//! pending PDAs across upgrades.
//!
//! Same `solana-program` direct-dep hash path as `policy_digest.rs`
//! (Anchor 0.32.1 doesn't re-export `solana_program::hash`).

use anchor_lang::prelude::*;
use solana_program::hash::hashv;

/// Canonical inputs to the cosign digest. All Option<…> fields are
/// encoded as `[u8; 1] discriminator (0 = None, 1 = Some) ++ payload`.
pub struct CosignDigestFields<'a> {
    /// The same `cosign_session` pubkey the queue accepted.
    pub cosign_session: &'a Pubkey,
    /// daily_spending_cap_usd Option<u64>
    pub daily_spending_cap_usd: Option<u64>,
    /// max_transaction_amount_usd Option<u64>
    pub max_transaction_amount_usd: Option<u64>,
    /// allowed_destinations Option<&[Pubkey]>
    pub allowed_destinations: Option<&'a [Pubkey]>,
    /// protocols Option<&[Pubkey]>
    pub protocols: Option<&'a [Pubkey]>,
}

/// SHA-256 over the canonical encoding of the cosign-relevant inputs.
///
/// Only the FIELDS that participate in "elevated mutation" detection are
/// in scope. Non-elevated fields (developer_fee_rate, max_slippage_bps,
/// session_expiry_seconds, timelock_duration narrowing, protocol_mode,
/// destination_mode, has_protocol_caps, protocol_caps shrinking) do NOT
/// require cosign and are NOT bound by this digest — they are still
/// bound by the existing TA-19 policy_preview_digest at queue time.
pub fn compute_cosign_digest(fields: &CosignDigestFields<'_>) -> [u8; 32] {
    // Pre-size: 32 (session) + 9 + 9 + 4+32*10 + 4+32*10 + 4 markers
    let mut buf: Vec<u8> = Vec::with_capacity(720);

    // 1. cosign_session pubkey (32 bytes raw)
    buf.extend_from_slice(fields.cosign_session.as_ref());

    // 2. daily_spending_cap_usd Option<u64>
    match fields.daily_spending_cap_usd {
        Some(v) => {
            buf.push(1);
            buf.extend_from_slice(&v.to_le_bytes());
        }
        None => buf.push(0),
    }

    // 3. max_transaction_amount_usd Option<u64>
    match fields.max_transaction_amount_usd {
        Some(v) => {
            buf.push(1);
            buf.extend_from_slice(&v.to_le_bytes());
        }
        None => buf.push(0),
    }

    // 4. allowed_destinations Option<&[Pubkey]>
    match fields.allowed_destinations {
        Some(dests) => {
            buf.push(1);
            buf.extend_from_slice(&(dests.len() as u32).to_le_bytes());
            for pk in dests.iter() {
                buf.extend_from_slice(pk.as_ref());
            }
        }
        None => buf.push(0),
    }

    // 5. protocols Option<&[Pubkey]>
    match fields.protocols {
        Some(protos) => {
            buf.push(1);
            buf.extend_from_slice(&(protos.len() as u32).to_le_bytes());
            for pk in protos.iter() {
                buf.extend_from_slice(pk.as_ref());
            }
        }
        None => buf.push(0),
    }

    hashv(&[&buf]).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(b: u8) -> Pubkey {
        Pubkey::new_from_array([b; 32])
    }

    /// Deterministic: same inputs → same digest.
    #[test]
    fn cosign_digest_is_deterministic() {
        let cosigner = pk(1);
        let dests = [pk(10), pk(11)];
        let f = CosignDigestFields {
            cosign_session: &cosigner,
            daily_spending_cap_usd: Some(500_000_000),
            max_transaction_amount_usd: None,
            allowed_destinations: Some(&dests),
            protocols: None,
        };
        let d1 = compute_cosign_digest(&f);
        let d2 = compute_cosign_digest(&f);
        assert_eq!(d1, d2);
    }

    /// Cosign-session flip MUST change the digest. Defends against
    /// session-swap between queue and apply.
    #[test]
    fn cosign_digest_changes_on_session_flip() {
        let cosigner_a = pk(1);
        let cosigner_b = pk(2);
        let f_a = CosignDigestFields {
            cosign_session: &cosigner_a,
            daily_spending_cap_usd: Some(500_000_000),
            max_transaction_amount_usd: None,
            allowed_destinations: None,
            protocols: None,
        };
        let f_b = CosignDigestFields {
            cosign_session: &cosigner_b,
            ..f_a
        };
        assert_ne!(compute_cosign_digest(&f_a), compute_cosign_digest(&f_b));
    }

    /// Cap-flip MUST change the digest. Defends against args-swap
    /// between queue and apply.
    #[test]
    fn cosign_digest_changes_on_cap_raise() {
        let cosigner = pk(1);
        let f_a = CosignDigestFields {
            cosign_session: &cosigner,
            daily_spending_cap_usd: Some(500_000_000),
            max_transaction_amount_usd: None,
            allowed_destinations: None,
            protocols: None,
        };
        let f_b = CosignDigestFields {
            cosign_session: &cosigner,
            daily_spending_cap_usd: Some(1_000_000_000), // doubled
            max_transaction_amount_usd: None,
            allowed_destinations: None,
            protocols: None,
        };
        assert_ne!(compute_cosign_digest(&f_a), compute_cosign_digest(&f_b));
    }

    /// None vs Some(0) MUST produce distinct digests (the discriminator
    /// is the load-bearing byte). Defends against the "swap None to
    /// Some(0)" attack which would also be elevated-detection-bypass.
    #[test]
    fn cosign_digest_distinguishes_none_from_some_zero() {
        let cosigner = pk(1);
        let f_none = CosignDigestFields {
            cosign_session: &cosigner,
            daily_spending_cap_usd: None,
            max_transaction_amount_usd: None,
            allowed_destinations: None,
            protocols: None,
        };
        let f_some_zero = CosignDigestFields {
            cosign_session: &cosigner,
            daily_spending_cap_usd: Some(0),
            max_transaction_amount_usd: None,
            allowed_destinations: None,
            protocols: None,
        };
        assert_ne!(
            compute_cosign_digest(&f_none),
            compute_cosign_digest(&f_some_zero)
        );
    }

    /// Destinations reorder MUST change the digest (ordered encoding).
    #[test]
    fn cosign_digest_changes_on_destinations_reorder() {
        let cosigner = pk(1);
        let a = [pk(10), pk(11)];
        let b = [pk(11), pk(10)];
        let f_a = CosignDigestFields {
            cosign_session: &cosigner,
            daily_spending_cap_usd: None,
            max_transaction_amount_usd: None,
            allowed_destinations: Some(&a),
            protocols: None,
        };
        let f_b = CosignDigestFields {
            cosign_session: &cosigner,
            allowed_destinations: Some(&b),
            ..f_a
        };
        assert_ne!(compute_cosign_digest(&f_a), compute_cosign_digest(&f_b));
    }

    /// G4 (audit close) — cross-impl byte-equality pin (minimal fixture).
    ///
    /// Pins a deterministic SHA-256 over the 37-byte canonical encoding for the
    /// minimal-cosign case:
    ///   - cosign_session = pk(1) → 32 bytes
    ///   - all four Option<…> fields = None → 4 zero discriminator bytes
    ///   - (no payload bytes for any Option since all are None)
    /// = 36 bytes deterministic input.
    ///
    /// Same fixture is asserted byte-for-byte in
    /// `sdk/kit/tests/policy/cosign-digest.test.ts` (HEX_MINIMAL). If either
    /// side mutates the canonical encoding, BOTH digests change and the two
    /// tests fail in lock-step — the goal, not silent acceptance of a
    /// divergent format.
    #[test]
    fn cosign_digest_known_value_for_minimal() {
        let cosigner = pk(1);
        let f = CosignDigestFields {
            cosign_session: &cosigner,
            daily_spending_cap_usd: None,
            max_transaction_amount_usd: None,
            allowed_destinations: None,
            protocols: None,
        };
        let digest = compute_cosign_digest(&f);
        let expected: [u8; 32] = COSIGN_HEX_MINIMAL;
        assert_eq!(
            digest, expected,
            "minimal-cosign digest must match SDK fixture (sdk/kit/tests/policy/cosign-digest.test.ts)"
        );
    }

    /// G4 (audit close) — cross-impl byte-equality pin (realistic fixture).
    ///
    /// Realistic cosign args mirroring an "elevated mutation that raises the
    /// daily cap, raises the max-tx, adds a destination, and adds a protocol".
    ///   - cosign_session = pk(1)
    ///   - daily_spending_cap_usd = Some(500_000_000)
    ///   - max_transaction_amount_usd = Some(100_000_000)
    ///   - allowed_destinations = Some(&[pk(10)])
    ///   - protocols = Some(&[pk(1), pk(2)])
    /// Encoding length:
    ///   32 (session)
    ///   + 1 + 8 (daily Some(u64))
    ///   + 1 + 8 (max_tx Some(u64))
    ///   + 1 + 4 + 32 (destinations Some(Vec<Pubkey> len=1))
    ///   + 1 + 4 + 32*2 (protocols Some(Vec<Pubkey> len=2))
    /// = 156 bytes deterministic input.
    #[test]
    fn cosign_digest_known_value_for_realistic() {
        let cosigner = pk(1);
        let dests = [pk(10)];
        let protos = [pk(1), pk(2)];
        let f = CosignDigestFields {
            cosign_session: &cosigner,
            daily_spending_cap_usd: Some(500_000_000),
            max_transaction_amount_usd: Some(100_000_000),
            allowed_destinations: Some(&dests),
            protocols: Some(&protos),
        };
        let digest = compute_cosign_digest(&f);
        let expected: [u8; 32] = COSIGN_HEX_REALISTIC;
        assert_eq!(
            digest, expected,
            "realistic-cosign digest must match SDK fixture"
        );
    }
}

/// G4 (audit close) — pinned cosign digest for the minimal fixture.
///
/// Computed over the canonical 36-byte encoding:
///   - cosign_session = pk(1) ([1u8; 32]) → 32 bytes
///   - daily_spending_cap_usd = None → 1 zero byte
///   - max_transaction_amount_usd = None → 1 zero byte
///   - allowed_destinations = None → 1 zero byte
///   - protocols = None → 1 zero byte
///
/// = `3f6c2724a21a3b29ef886a52aa414bec96c46f7af137c636065209ff892cee6c`
///
/// Same value pinned at `sdk/kit/tests/policy/cosign-digest.test.ts` as
/// `HEX_MINIMAL`.
#[cfg(test)]
const COSIGN_HEX_MINIMAL: [u8; 32] = [
    0x3f, 0x6c, 0x27, 0x24, 0xa2, 0x1a, 0x3b, 0x29, 0xef, 0x88, 0x6a, 0x52, 0xaa, 0x41, 0x4b, 0xec,
    0x96, 0xc4, 0x6f, 0x7a, 0xf1, 0x37, 0xc6, 0x36, 0x06, 0x52, 0x09, 0xff, 0x89, 0x2c, 0xee, 0x6c,
];

/// G4 (audit close) — pinned cosign digest for the realistic fixture.
///
/// Computed over the canonical 156-byte encoding (see test for full layout).
///
/// = `5a881caee096c1c8d60348f3cca70bc966d5ca92b32ddaf014ebc0dbc8edf1af`
///
/// Same value pinned at `sdk/kit/tests/policy/cosign-digest.test.ts` as
/// `HEX_REALISTIC`.
#[cfg(test)]
const COSIGN_HEX_REALISTIC: [u8; 32] = [
    0x5a, 0x88, 0x1c, 0xae, 0xe0, 0x96, 0xc1, 0xc8, 0xd6, 0x03, 0x48, 0xf3, 0xcc, 0xa7, 0x0b, 0xc9,
    0x66, 0xd5, 0xca, 0x92, 0xb3, 0x2d, 0xda, 0xf0, 0x14, 0xeb, 0xc0, 0xdb, 0xc8, 0xed, 0xf1, 0xaf,
];
