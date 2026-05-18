//! Phase 2 Option A: small helpers shared across instruction handlers.
//!
//! - `policy_digest`: canonical Borsh encoding + SHA-256 of policy preview fields
//!   (TA-19). Used at `initialize_vault`, `queue_policy_update`, and re-asserted
//!   at `apply_pending_policy`.
//! - `destination_check`: token-account-owner resolution + allowlist check.
//!   Wires `PolicyConfig.allowed_destinations` into spending paths
//!   (`validate_and_authorize`), not just `agent_transfer`.

pub mod destination_check;
pub mod policy_digest;
