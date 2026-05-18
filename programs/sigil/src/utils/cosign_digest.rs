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
}
