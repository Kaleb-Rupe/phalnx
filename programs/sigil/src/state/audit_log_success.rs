use anchor_lang::prelude::*;

/// Number of success-path audit entries retained per vault.
/// Circular buffer: oldest entries are overwritten by newest at head modulo
/// `AUDIT_LOG_SUCCESS_CAPACITY`. Capacity sized to retain ~24h of activity
/// at typical agent cadences while keeping account rent below the L-12
/// budget envelope (~8KB success buffer + ~4KB rejected buffer = ~12KB
/// combined). See `docs/revamp/HARDENED_V2_PROMPT_MAP.md` §6 Phase 7.
pub const AUDIT_LOG_SUCCESS_CAPACITY: usize = 128;

/// Discriminator allocation for `AuditEntry.discriminator`.
/// 0      = reserved (never written; defense-in-depth zero-default sentinel)
/// 1      = validate_and_authorize (RESERVED slot — Phase 7 writes NO entries
///          from `validate_and_authorize`; reserved for future expansion when
///          a per-validate audit row is needed)
/// 2      = finalize_session SUCCESS path
/// 3      = deposit_funds
/// 4      = withdraw_funds
/// 5      = freeze_vault
/// 6      = reactivate_vault
/// 7..=9  = RESERVED for Phase 8 ownership-transfer instructions
///          (initiate / accept / cancel). Phase 7 MUST NOT write these.
/// 10     = pause_agent
/// 11     = unpause_agent
/// 12     = revoke_agent
/// 13     = register_agent
/// 14     = apply_pending_policy
/// 15     = apply_constraints_update
/// 16     = finalize_session REJECT path (expired-session crank). Written
///          only to the rejected buffer; closes the disc-1/disc-2 ambiguity
///          that would otherwise let a permissionless-crank attacker create
///          forensic confusion across the two buffers.
/// 17..=255 = reserved (extensible)
pub const AUDIT_DISC_RESERVED_ZERO: u8 = 0;
pub const AUDIT_DISC_VALIDATE: u8 = 1;
pub const AUDIT_DISC_FINALIZE_SUCCESS: u8 = 2;
pub const AUDIT_DISC_DEPOSIT: u8 = 3;
pub const AUDIT_DISC_WITHDRAW: u8 = 4;
pub const AUDIT_DISC_FREEZE: u8 = 5;
pub const AUDIT_DISC_REACTIVATE: u8 = 6;
// 7..=9 reserved for Phase 8 ownership_transfer_*  — DO NOT WRITE in Phase 7.
pub const AUDIT_DISC_OWNERSHIP_INITIATE: u8 = 7;
pub const AUDIT_DISC_OWNERSHIP_ACCEPT: u8 = 8;
pub const AUDIT_DISC_OWNERSHIP_CANCEL: u8 = 9;
pub const AUDIT_DISC_PAUSE_AGENT: u8 = 10;
pub const AUDIT_DISC_UNPAUSE_AGENT: u8 = 11;
pub const AUDIT_DISC_REVOKE_AGENT: u8 = 12;
pub const AUDIT_DISC_REGISTER_AGENT: u8 = 13;
pub const AUDIT_DISC_POLICY_APPLY: u8 = 14;
pub const AUDIT_DISC_CONSTRAINTS_APPLY: u8 = 15;
pub const AUDIT_DISC_FINALIZE_REJECT: u8 = 16;

/// Single audit-log entry. Zero-copy, fixed-size 64 bytes per entry.
///
/// **Layout strategy:** `#[repr(C)]` ordered so natural alignment never
/// introduces implicit padding (Pod derive forbids implicit padding).
/// All fields with alignment > 1 are placed at offsets that are multiples
/// of their alignment.
///
/// Byte offsets (verified at compile time):
///   0..32   subject          [u8;32]  align 1
///   32..40  balance_delta_in i64      align 8 (32 % 8 = 0 ✓)
///   40..48  balance_delta_out i64     align 8 (40 % 8 = 0 ✓)
///   48..56  timestamp        i64      align 8 (48 % 8 = 0 ✓)
///   56..60  slot_hash        [u8;4]   align 1
///   60..63  blockhash        [u8;3]   align 1
///   63..64  discriminator    u8       align 1
///   ──── total: 64 bytes, struct alignment = 8 ────
///
/// **discriminator placement note:** semantically the discriminator is
/// "type of entry," but for Pod-compatible packing we place it at the
/// trailing byte. SDK decoders read it by offset 63, not by struct field
/// order.
///
/// Audit #1 AUD3-F5: uses `slot_hashes_sysvar`, NOT deprecated
/// `recent_blockhashes_sysvar` (deprecated in Solana 1.18+).
#[zero_copy]
#[repr(C)]
#[derive(Default)]
pub struct AuditEntry {
    /// 32-byte pubkey of the entry's subject. Stored as raw bytes because
    /// `zero_copy` cannot hold `Pubkey` directly without `Pod` impl on
    /// Pubkey itself.
    ///
    /// Per-discriminator semantic (§RP-1 HIGH-2 disambiguation, 2026-05-19):
    ///   disc=2  (finalize_success) → protocol pubkey (session.authorized_protocol)
    ///   disc=16 (finalize_reject)  → protocol pubkey (session.authorized_protocol)
    ///   disc=3  (deposit)          → SPL Token mint pubkey
    ///   disc=4  (withdraw)         → SPL Token mint pubkey
    ///   disc=5  (freeze)           → vault pubkey
    ///   disc=6  (reactivate)       → vault pubkey
    ///   disc=10 (pause_agent)      → agent pubkey
    ///   disc=11 (unpause_agent)    → agent pubkey
    ///   disc=12 (revoke_agent)     → agent pubkey
    ///   disc=13 (register_agent)   → agent pubkey
    ///   disc=14 (policy_apply)     → vault pubkey
    ///   disc=15 (constraints_apply)→ vault pubkey
    ///   disc=7..=9 (ownership_*)   → Phase 8 — RESERVED, do not write
    pub subject: [u8; 32],
    /// Stablecoin delta IN (e.g. swap output, deposit). 0 when not applicable.
    pub balance_delta_in: i64,
    /// Stablecoin delta OUT (e.g. swap input, withdraw, transfer). 0 when N/A.
    pub balance_delta_out: i64,
    /// Wall-clock unix timestamp (Clock::unix_timestamp).
    pub timestamp: i64,
    /// First 4 bytes of slot_hashes_sysvar[0].slot in LE byte order.
    pub slot_hash: [u8; 4],
    /// First 3 bytes of slot_hashes_sysvar[0].hash.
    pub blockhash: [u8; 3],
    /// See discriminator constants above (AUDIT_DISC_*). At byte offset 63.
    pub discriminator: u8,
}

impl AuditEntry {
    /// Compile-time sanity: per-entry layout MUST be exactly 64 bytes so the
    /// circular-buffer maths in `AuditLogSuccess::SIZE` and
    /// `AuditLogRejected::SIZE` line up.
    pub const SIZE: usize = 64;
}

// Compile-time assertion that AuditEntry packs to exactly 64 bytes.
const _: () = assert!(core::mem::size_of::<AuditEntry>() == AuditEntry::SIZE);

/// On-chain circular log of SUCCESSFUL mutating instructions for a vault.
///
/// Audit #2 F-19 (audit log spam): kept separate from `AuditLogRejected`
/// so a permissionless-crank attacker who triggers expired-finalize
/// rejects cannot displace legitimate success entries.
///
/// Seeds: `[b"audit_success", vault.key().as_ref()]`
///
/// **Layout (within 8-byte Anchor discriminator):**
///   0..32      vault       Pubkey
///   32..8224   entries     [AuditEntry; 128]   (128 * 64 = 8,192)
///   8224..8225 head        u8
///   8225..8226 count       u8
///   8226..8239 _padding    [u8;13]             (alignment to make struct multiple of 8)
///   8239..8240 bump        u8
///   ──── total data: 8,240 bytes ────
///
/// Including 8-byte Anchor discriminator at front: **8,248 bytes total.**
///
/// **DEVIATION FROM SPEC:** The Phase 7 spec called for `_padding: [u8;6]`
/// with claimed SIZE = 8,241. That arithmetic is incompatible with the Pod
/// derive (which `#[zero_copy]` applies): `[AuditEntry; 128]` has 8-byte
/// alignment (from inner `i64` fields), so the containing struct also has
/// 8-byte alignment and `size_of::<AuditLogSuccess>()` MUST be a multiple
/// of 8. 8,233 is not — the compiler would either insert 7 bytes of
/// implicit trailing padding (which Pod forbids) or fail.
///
/// We resolve this by widening `_padding` from 6 → 13 bytes so the data
/// portion totals exactly 8,240 (multiple of 8), and SIZE becomes 8,248.
/// Net cost: 7 additional bytes of rent per vault (≈ 50,000 lamports at
/// current rent rates — negligible).
#[account(zero_copy)]
#[repr(C)]
pub struct AuditLogSuccess {
    /// Associated vault pubkey. Verified by PDA seeds + has_one constraints
    /// at the instruction layer.
    pub vault: Pubkey, // 32 bytes
    /// Circular-buffer entries. Indexed by `(head - 1) mod CAPACITY` for the
    /// most recent entry; oldest is at `head` when `count == CAPACITY`.
    pub entries: [AuditEntry; AUDIT_LOG_SUCCESS_CAPACITY], // 128 * 64 = 8,192 bytes
    /// Next write position (0..=CAPACITY-1). Wraps modulo CAPACITY.
    pub head: u8, // 1 byte
    /// Total entries written, saturated at CAPACITY. Used by readers to
    /// distinguish a half-filled buffer from a wrapped one.
    pub count: u8, // 1 byte
    /// 13-byte explicit padding to satisfy Pod's no-implicit-padding rule.
    /// Forward-compat slot for future field appends (see Phase 9+).
    pub _padding: [u8; 13], // 13 bytes
    /// PDA bump seed.
    pub bump: u8, // 1 byte
}

impl AuditLogSuccess {
    /// Total account size INCLUDING the 8-byte Anchor discriminator.
    ///
    ///   8 (discriminator) + 32 (vault) + (128 * 64 = 8,192 entries) +
    ///   1 (head) + 1 (count) + 13 (_padding) + 1 (bump) = 8,248 bytes
    pub const SIZE: usize =
        8 + 32 + (AUDIT_LOG_SUCCESS_CAPACITY * AuditEntry::SIZE) + 1 + 1 + 13 + 1;

    /// Append a new entry at `head`, advance head modulo CAPACITY, saturate
    /// count at CAPACITY. Used by every Phase 7 wire-up site.
    pub fn append(&mut self, entry: AuditEntry) {
        let idx = (self.head as usize) % AUDIT_LOG_SUCCESS_CAPACITY;
        self.entries[idx] = entry;
        self.head = (((self.head as usize) + 1) % AUDIT_LOG_SUCCESS_CAPACITY) as u8;
        if (self.count as usize) < AUDIT_LOG_SUCCESS_CAPACITY {
            self.count = self.count.saturating_add(1);
        }
    }
}

// Compile-time SIZE assertion.
// 8 + 32 + 8192 + 1 + 1 + 13 + 1 = 8,248.
const _: () = assert!(AuditLogSuccess::SIZE == 8_248);
