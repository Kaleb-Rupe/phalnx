use anchor_lang::prelude::*;

use crate::errors::AgentShieldError;
use crate::events::VaultCreated;
use crate::state::*;

#[derive(Accounts)]
#[instruction(vault_id: u64, _daily_spending_cap_usd: u64, _max_transaction_size_usd: u64, _allowed_tokens: Vec<AllowedToken>, _allowed_protocols: Vec<Pubkey>, _max_leverage_bps: u16, _max_concurrent_positions: u8, _developer_fee_rate: u16, _timelock_duration: u64, _allowed_destinations: Vec<Pubkey>, tracker_tier: u8)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = AgentVault::SIZE,
        seeds = [b"vault", owner.key().as_ref(), vault_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub vault: Account<'info, AgentVault>,

    #[account(
        init,
        payer = owner,
        space = PolicyConfig::SIZE,
        seeds = [b"policy", vault.key().as_ref()],
        bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

    #[account(
        init,
        payer = owner,
        space = SpendTracker::size_for_tier(tracker_tier),
        seeds = [b"tracker", vault.key().as_ref()],
        bump,
    )]
    pub tracker: Account<'info, SpendTracker>,

    /// The protocol treasury that receives fees
    /// CHECK: This is the fee destination wallet; validated by the caller/SDK.
    pub fee_destination: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<InitializeVault>,
    vault_id: u64,
    daily_spending_cap_usd: u64,
    max_transaction_size_usd: u64,
    allowed_tokens: Vec<AllowedToken>,
    allowed_protocols: Vec<Pubkey>,
    max_leverage_bps: u16,
    max_concurrent_positions: u8,
    developer_fee_rate: u16,
    timelock_duration: u64,
    allowed_destinations: Vec<Pubkey>,
    tracker_tier: u8,
) -> Result<()> {
    let tier = TrackerTier::from_u8(tracker_tier).ok_or(AgentShieldError::InvalidTrackerTier)?;
    require!(
        allowed_tokens.len() <= MAX_ALLOWED_TOKENS,
        AgentShieldError::TooManyAllowedTokens
    );
    require!(
        allowed_protocols.len() <= MAX_ALLOWED_PROTOCOLS,
        AgentShieldError::TooManyAllowedProtocols
    );
    require!(
        developer_fee_rate <= MAX_DEVELOPER_FEE_RATE,
        AgentShieldError::DeveloperFeeTooHigh
    );
    require!(
        ctx.accounts.fee_destination.key() != Pubkey::default(),
        AgentShieldError::InvalidFeeDestination
    );
    require!(
        allowed_destinations.len() <= MAX_ALLOWED_DESTINATIONS,
        AgentShieldError::TooManyDestinations
    );

    let clock = Clock::get()?;

    // Initialize vault
    let vault = &mut ctx.accounts.vault;
    vault.owner = ctx.accounts.owner.key();
    vault.agent = Pubkey::default();
    vault.fee_destination = ctx.accounts.fee_destination.key();
    vault.vault_id = vault_id;
    vault.status = VaultStatus::Active;
    vault.bump = ctx.bumps.vault;
    vault.created_at = clock.unix_timestamp;
    vault.total_transactions = 0;
    vault.total_volume = 0;
    vault.open_positions = 0;
    vault.total_fees_collected = 0;
    vault.tracker_tier = tier;

    // Initialize policy
    let policy = &mut ctx.accounts.policy;
    policy.vault = vault.key();
    policy.daily_spending_cap_usd = daily_spending_cap_usd;
    policy.max_transaction_size_usd = max_transaction_size_usd;
    policy.allowed_tokens = allowed_tokens;
    policy.allowed_protocols = allowed_protocols;
    policy.max_leverage_bps = max_leverage_bps;
    policy.can_open_positions = true;
    policy.max_concurrent_positions = max_concurrent_positions;
    policy.developer_fee_rate = developer_fee_rate;
    policy.timelock_duration = timelock_duration;
    policy.allowed_destinations = allowed_destinations;
    policy.bump = ctx.bumps.policy;

    // Initialize tracker
    let tracker = &mut ctx.accounts.tracker;
    tracker.vault = vault.key();
    tracker.tracker_tier = tier;
    tracker.max_spend_entries = tier.max_spend_entries() as u32;
    tracker.rolling_spends = Vec::new();
    tracker.recent_transactions = Vec::new();
    tracker.bump = ctx.bumps.tracker;

    emit!(VaultCreated {
        vault: vault.key(),
        owner: ctx.accounts.owner.key(),
        vault_id,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
