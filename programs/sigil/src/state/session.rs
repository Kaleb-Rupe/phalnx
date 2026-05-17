use anchor_lang::prelude::*;

#[account]
pub struct SessionAuthority {
    /// Associated vault
    pub vault: Pubkey,

    /// The agent who initiated this session
    pub agent: Pubkey,

    /// Whether this session has been authorized by the permission check
    pub authorized: bool,

    /// Authorized action details (for verification in finalize)
    pub authorized_amount: u64,
    pub authorized_token: Pubkey,
    pub authorized_protocol: Pubkey,

    /// Wall-clock expiry: session is valid until this `Clock::unix_timestamp`.
    ///
    /// **Why timestamp, not slot:** Solana slot times vary 400ms-1.5s under
    /// congestion. Slot-based expiry produced a 3.75x variance window between
    /// the documented and worst-case session lifetime — see audit F5-H1.
    /// Wall-clock enforcement is congestion-immune.
    pub expires_at_timestamp: i64,

    /// Whether token delegation was set up (approve CPI)
    pub delegated: bool,

    /// The vault's token account that was delegated to the agent
    /// (only meaningful when delegated == true)
    pub delegation_token_account: Pubkey,

    /// Protocol fee collected during validate (for event logging in finalize)
    pub protocol_fee: u64,

    /// Developer fee collected during validate (for event logging in finalize)
    pub developer_fee: u64,

    /// Stablecoin mint for outcome-based spending detection.
    /// For stablecoin input: set to authorized_token (the stablecoin being spent).
    /// For non-stablecoin input: set to the expected stablecoin output mint.
    /// Pubkey::default() for non-spending actions (no outcome check needed).
    pub output_mint: Pubkey,

    /// Snapshot of the relevant stablecoin account balance before the swap.
    /// For stablecoin input: vault_token_account.amount (taken before fee collection).
    /// For non-stablecoin input: output_stablecoin_account.amount.
    /// 0 for non-spending actions.
    pub stablecoin_balance_before: u64,

    /// Bump seed for PDA
    pub bump: u8,

    /// Phase B2: Snapshots of target account bytes captured in validate_and_authorize
    /// before DeFi instruction executes. Index i corresponds to PostAssertionEntry i.
    /// Used by delta assertion modes (1=MaxDecrease, 2=MaxIncrease, 3=NoChange).
    pub assertion_snapshots: [[u8; 32]; 4],

    /// Phase B2: Actual value_len captured for each snapshot.
    /// 0 = no snapshot captured (mode 0 entries). Non-zero = snapshot was captured.
    /// finalize_session cross-checks snapshot_lens[i] == entry.value_len.
    pub snapshot_lens: [u8; 4],
}

impl SessionAuthority {
    /// discriminator (8) + vault (32) + agent (32) + authorized (1) +
    /// amount (8) + token (32) + protocol (32) +
    /// expires_at_timestamp i64 (8) + delegated (1) + delegation_token_account (32) +
    /// protocol_fee (8) + developer_fee (8) +
    /// output_mint (32) + stablecoin_balance_before (8) + bump (1) +
    /// assertion_snapshots (128) + snapshot_lens (4)
    ///
    /// is_spending byte removed in V2 Option A — always derived from
    /// `authorized_amount > 0`. Account is no longer rent-resized; SIZE shrinks
    /// by 1 byte under the V2 program ID.
    pub const SIZE: usize =
        8 + 32 + 32 + 1 + 8 + 32 + 32 + 8 + 1 + 32 + 8 + 8 + 32 + 8 + 1 + 128 + 4;

    /// Returns true when wall-clock has passed the session's expiry timestamp.
    pub fn is_expired(&self, current_unix_ts: i64) -> bool {
        current_unix_ts > self.expires_at_timestamp
    }

    pub fn is_valid(&self, current_unix_ts: i64) -> bool {
        self.authorized && !self.is_expired(current_unix_ts)
    }

    /// Compute the wall-clock expiry timestamp from `now_ts` and an
    /// owner-configured duration in seconds.
    ///
    /// `owner_max_seconds` is silently capped to
    /// `MAX_OWNER_SESSION_DURATION_SECONDS` as defense-in-depth — the
    /// `queue_policy_update` validator already rejects out-of-range values,
    /// but enforcing the cap here means a future bug elsewhere cannot create
    /// an over-long session.
    pub fn calculate_expiry(now_ts: i64, owner_max_seconds: u64) -> i64 {
        let capped = owner_max_seconds.min(super::MAX_OWNER_SESSION_DURATION_SECONDS) as i64;
        // saturating_add prevents wrap on pathological i64 inputs.
        now_ts.saturating_add(capped)
    }
}

#[cfg(test)]
mod f5h1_tests {
    //! F5-H1 audit fix: session expiry uses wall-clock `unix_timestamp`,
    //! not slot. These tests pin the variance-immunity property: regardless
    //! of how fast or slow slots advance, a session's lifetime is governed
    //! purely by the seconds between `now_ts` (validate) and the equality of
    //! that timestamp to `expires_at_timestamp` (finalize check).

    use super::*;
    use crate::state::{
        MAX_OWNER_SESSION_DURATION_SECONDS, MIN_SESSION_DURATION_SECONDS, SESSION_DURATION_SECONDS,
    };

    /// Helper — build a SessionAuthority with only `expires_at_timestamp` set.
    fn session_with_expiry(expires_at: i64) -> SessionAuthority {
        SessionAuthority {
            vault: Pubkey::default(),
            agent: Pubkey::default(),
            authorized: true,
            authorized_amount: 0,
            authorized_token: Pubkey::default(),
            authorized_protocol: Pubkey::default(),
            expires_at_timestamp: expires_at,
            delegated: false,
            delegation_token_account: Pubkey::default(),
            protocol_fee: 0,
            developer_fee: 0,
            output_mint: Pubkey::default(),
            stablecoin_balance_before: 0,
            bump: 0,
            assertion_snapshots: [[0u8; 32]; 4],
            snapshot_lens: [0u8; 4],
        }
    }

    /// `calculate_expiry(now_ts, default)` produces an expiry exactly
    /// `SESSION_DURATION_SECONDS` past `now_ts`, and `is_expired` uses a
    /// strict `>` boundary at that timestamp.
    ///
    /// **Why this proves congestion-immunity:** the function takes only
    /// `unix_timestamp` as its time input. Slot is not a parameter — there
    /// is no slot-time variance term in the result. Compare with the prior
    /// F5-H1 vulnerable form `now_slot + N` which scaled with slot duration.
    #[test]
    fn f5h1_calculate_expiry_uses_only_wall_clock() {
        let now_ts: i64 = 1_700_000_000; // arbitrary realistic mainnet timestamp
        let expires = SessionAuthority::calculate_expiry(now_ts, SESSION_DURATION_SECONDS as u64);
        assert_eq!(expires, now_ts + SESSION_DURATION_SECONDS);

        let session = session_with_expiry(expires);

        assert!(!session.is_expired(expires - 1)); // 1s before expiry
        assert!(!session.is_expired(expires)); // exactly at expiry: boundary is strict `>`
        assert!(session.is_expired(expires + 1)); // 1s after expiry
    }

    /// Defense-in-depth: even if a caller bypassed `queue_policy_update`
    /// validation, `calculate_expiry` itself caps the duration at
    /// `MAX_OWNER_SESSION_DURATION_SECONDS`. The previous slot-based 450
    /// would, at 1.5s/slot, have permitted 11+ minutes of live delegation.
    #[test]
    fn f5h1_owner_max_silently_capped_at_max_owner_duration() {
        let now_ts: i64 = 1_700_000_000;

        // Try to set 600s (10 minutes) — well above the 90s cap.
        let expires = SessionAuthority::calculate_expiry(now_ts, 600);
        assert_eq!(
            expires,
            now_ts + MAX_OWNER_SESSION_DURATION_SECONDS as i64,
            "calculate_expiry must cap at MAX_OWNER_SESSION_DURATION_SECONDS \
             regardless of caller-supplied owner_max_seconds"
        );

        // u64::MAX gets capped to MAX_OWNER_SESSION_DURATION_SECONDS, not saturating.
        let max_attempt = SessionAuthority::calculate_expiry(now_ts, u64::MAX);
        assert_eq!(
            max_attempt,
            now_ts + MAX_OWNER_SESSION_DURATION_SECONDS as i64
        );
    }

    /// Lower-bound sanity: 5s is the floor enforced by queue_policy_update,
    /// but `calculate_expiry` accepts any value >= 0. The floor is policy,
    /// not arithmetic.
    #[test]
    fn f5h1_min_session_duration_arithmetically_valid() {
        let now_ts: i64 = 1_700_000_000;
        let expires = SessionAuthority::calculate_expiry(now_ts, MIN_SESSION_DURATION_SECONDS);
        assert_eq!(expires, now_ts + MIN_SESSION_DURATION_SECONDS as i64);
        assert_eq!(expires - now_ts, 5);
    }

    /// Boundary: at i64::MAX - small, calculate_expiry must saturate
    /// rather than wrap. Solana unix_timestamp is ~year 2262 at the
    /// saturation boundary, so this is purely defensive.
    #[test]
    fn f5h1_calculate_expiry_saturates_near_i64_max() {
        let near_max = i64::MAX - 10;
        let expires = SessionAuthority::calculate_expiry(near_max, SESSION_DURATION_SECONDS as u64);
        assert_eq!(expires, i64::MAX, "must saturate, not wrap");
    }

    /// is_expired uses strict `>` so a session is valid AT the expiry timestamp.
    /// This matches the slot-based predecessor (`current_slot > expires_at_slot`).
    #[test]
    fn f5h1_is_expired_strict_inequality() {
        let session = session_with_expiry(1_700_000_030);
        assert!(!session.is_expired(1_700_000_030)); // exactly at: not expired
        assert!(session.is_expired(1_700_000_031)); // 1s after: expired
        assert!(!session.is_expired(1_700_000_029)); // 1s before: not expired
    }

    /// is_valid combines `authorized` + `!is_expired` — both must hold.
    #[test]
    fn f5h1_is_valid_requires_authorized_and_not_expired() {
        let mut session = session_with_expiry(1_700_000_030);
        session.authorized = true;
        assert!(session.is_valid(1_700_000_000)); // authorized + not expired
        assert!(!session.is_valid(1_700_000_031)); // authorized but expired

        session.authorized = false;
        assert!(!session.is_valid(1_700_000_000)); // not authorized
    }
}
