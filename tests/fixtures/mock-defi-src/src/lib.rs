//! Test-only mock DeFi program.
//!
//! Exists solely to give Sigil's LiteSVM integration tests a real Anchor
//! program (with stable 8-byte discriminators) to route instruction-sysvar
//! matching against. Two no-op instructions (`open_position`,
//! `close_position`) provide stable discriminators for
//! `InstructionConstraints` matching tests.
//!
//! Not deployed to devnet or mainnet. The fixed `declare_id!` is
//! deterministic across builds so test constraint entries can hard-code the
//! program ID.

use anchor_lang::prelude::*;

declare_id!("2pB26qKW73sToF7ETcdhXQTj8biYwAk9TCArVwgHBe24");

#[program]
pub mod mock_defi {
    use super::*;

    pub fn open_position(_ctx: Context<MockNoop>) -> Result<()> {
        Ok(())
    }

    pub fn close_position(_ctx: Context<MockNoop>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct MockNoop<'info> {
    pub signer: Signer<'info>,
}
