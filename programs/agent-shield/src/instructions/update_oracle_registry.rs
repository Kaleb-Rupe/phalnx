use anchor_lang::prelude::*;

use crate::errors::AgentShieldError;
use crate::events::OracleRegistryUpdated;
use crate::state::*;

#[derive(Accounts)]
pub struct UpdateOracleRegistry<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"oracle_registry"],
        bump,
    )]
    pub oracle_registry: AccountLoader<'info, OracleRegistry>,
}

pub fn handler(
    ctx: Context<UpdateOracleRegistry>,
    entries_to_add: Vec<OracleEntry>,
    mints_to_remove: Vec<Pubkey>,
) -> Result<()> {
    let mut registry = ctx.accounts.oracle_registry.load_mut()?;

    // Authority check
    require!(
        registry.authority == ctx.accounts.authority.key(),
        AgentShieldError::UnauthorizedRegistryAdmin
    );

    let mut count = registry.count as usize;

    // Remove entries by mint (swap-remove for O(1) per removal)
    let mut removed_count: u16 = 0;
    for mint in &mints_to_remove {
        let mut i = 0;
        while i < count {
            if registry.entries[i].mint == *mint {
                // Swap with last active entry and shrink
                count -= 1;
                if i < count {
                    registry.entries[i] = registry.entries[count];
                }
                // Zero out the removed slot
                registry.entries[count] = OracleEntryZC::default();
                removed_count = removed_count.saturating_add(1);
                // Don't increment i — check the swapped entry
            } else {
                i += 1;
            }
        }
    }

    // Add new entries (update existing duplicates)
    let mut added_count: u16 = 0;
    for entry in &entries_to_add {
        // Check if mint already exists (update in-place)
        let mut found = false;
        for i in 0..count {
            if registry.entries[i].mint == entry.mint {
                registry.entries[i] = OracleEntryZC::from(entry);
                found = true;
                break;
            }
        }
        if !found {
            require!(
                count < MAX_ORACLE_ENTRIES,
                AgentShieldError::OracleRegistryFull
            );
            registry.entries[count] = OracleEntryZC::from(entry);
            count += 1;
            added_count = added_count.saturating_add(1);
        }
    }

    registry.count = count as u16;

    emit!(OracleRegistryUpdated {
        added_count,
        removed_count,
        total_entries: registry.count,
    });

    Ok(())
}
