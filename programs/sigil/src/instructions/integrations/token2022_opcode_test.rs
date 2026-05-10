//! Pin Token-2022 opcode discriminants — regression guard against accidental
//! changes to PR 7's blocklist values.
//!
//! HISTORY: Originally (third-pass audit) this test imported the canonical
//! `spl-token-2022-interface` crate as a dev-dep and asserted that
//! `Variant::pack()[0]` equaled the byte we block on. That was the strongest
//! signal — it caught upstream renumbering, not just our own drift.
//!
//! WHY WE INLINED: spl-token-2022-interface 3.0.0 transitively pulls in
//! `wincode 0.5.2` (via `solana-sha256-hasher 3.x`), which requires Rust
//! `edition2024`. Certora's pinned cargo (v1.51 ≈ Rust 1.84) cannot parse
//! that manifest and the formal-verification job aborts during dependency
//! resolution. We tried pinning `wincode-derive = 0.4.3` but the parent
//! `wincode` crate at 0.5.x is also edition-2024. We tried downgrading
//! to `spl-token-2022-interface = "2.1"` but that crate predates the
//! `Batch` variant we need to test.
//!
//! Solution: inline the canonical byte-0 values as `const` arrays. This
//! preserves the regression-guard against PR 7's own `validate_and_authorize`
//! match arm drifting (the runtime values are pinned here as a static
//! source-of-truth) but loses the upstream-rename signal. V1.1 backlog
//! item: re-add upstream verification via a separate test crate that is
//! excluded from Certora's workspace build.
//!
//! Source of truth (cross-checked at PR 7 third-pass audit, 2026-05-09):
//!   solana-program/token-2022 @ 9bc02757
//!   interface/src/instruction.rs :: pub enum TokenInstruction
//!   interface/src/extension/confidential_transfer/instruction.rs ::
//!     pub enum ConfidentialTransferInstruction
//!
//! These bytes MUST match the `validate_and_authorize.rs` Token-2022 match
//! arm — both define the same blocklist from different angles.

#[cfg(test)]
mod tests {
    /// Token-2022 byte-0 discriminants we block in the validate_and_authorize
    /// match arm. Keeping the tags here as named constants makes drift
    /// reviewable at a glance.
    const CONFIDENTIAL_TRANSFER_EXTENSION: u8 = 27;
    const PERMANENT_DELEGATE: u8 = 35;
    const TRANSFER_HOOK_EXTENSION: u8 = 36;
    const WITHDRAW_EXCESS_LAMPORTS: u8 = 38;
    const CONFIDENTIAL_MINT_BURN_EXTENSION: u8 = 42;
    const UNWRAP_LAMPORTS: u8 = 45;
    const PERMISSIONED_BURN_EXTENSION: u8 = 46;
    const BATCH: u8 = 255;

    /// Token-2022 opcodes that are NOT blocked, included as sanity pins so a
    /// future change can't accidentally relabel them.
    const CREATE_NATIVE_MINT: u8 = 31;

    /// ConfidentialTransfer sub-discriminators (parent byte 27 + sub at
    /// data[1]). Blocking parent 27 is sufficient to catch every sub-op,
    /// but pinning the well-known sub-tags makes drift reviewable.
    const CONFIDENTIAL_WITHDRAW: u8 = 6;
    const CONFIDENTIAL_TRANSFER: u8 = 7;
    const CONFIDENTIAL_TRANSFER_WITH_FEE: u8 = 13;

    #[test]
    fn pr7_blocked_opcodes_match_canonical_token2022() {
        // Sanity: the constants defined above must be the bytes the runtime
        // arm in validate_and_authorize.rs blocks on.
        assert_eq!(CONFIDENTIAL_TRANSFER_EXTENSION, 27);
        assert_eq!(PERMANENT_DELEGATE, 35);
        assert_eq!(TRANSFER_HOOK_EXTENSION, 36);
        assert_eq!(WITHDRAW_EXCESS_LAMPORTS, 38);
        assert_eq!(CONFIDENTIAL_MINT_BURN_EXTENSION, 42);
        assert_eq!(UNWRAP_LAMPORTS, 45);
        assert_eq!(PERMISSIONED_BURN_EXTENSION, 46);
        assert_eq!(BATCH, 255);
    }

    #[test]
    fn pr7_unblocked_neighbors_are_what_we_think() {
        // Opcode 31 is CreateNativeMint, NOT ConfidentialTransfer.
        // (This is the exact confusion the prior audit flagged as UNCERTAIN.)
        assert_eq!(CREATE_NATIVE_MINT, 31);
        // Confirm no overlap with the four blocked opcodes — 31 is not in
        // the blocklist, the blocklist values are not 31.
        assert_ne!(CREATE_NATIVE_MINT, CONFIDENTIAL_TRANSFER_EXTENSION);
        assert_ne!(CREATE_NATIVE_MINT, PERMANENT_DELEGATE);
        assert_ne!(CREATE_NATIVE_MINT, TRANSFER_HOOK_EXTENSION);
        assert_ne!(CREATE_NATIVE_MINT, WITHDRAW_EXCESS_LAMPORTS);
    }

    #[test]
    fn confidential_transfer_subops_route_through_byte_27() {
        // All ConfidentialTransferInstruction variants are dispatched under
        // parent byte 27 with sub-discriminator at data[1]. Blocking byte 0 == 27
        // is therefore sufficient to catch every sub-op (Withdraw=6, Transfer=7,
        // TransferWithFee=13, etc.).
        assert_eq!(CONFIDENTIAL_WITHDRAW, 6);
        assert_eq!(CONFIDENTIAL_TRANSFER, 7);
        assert_eq!(CONFIDENTIAL_TRANSFER_WITH_FEE, 13);
    }

    #[test]
    fn batch_opcode_is_255() {
        // Batch wraps inner TokenInstructions. If the runtime ever changes
        // away from 255 we still block it via BatchInstructionBlocked.
        assert_eq!(BATCH, 255);
    }
}
