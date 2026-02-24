use anchor_lang::prelude::*;
use anchor_spl::token::{self, Revoke, Token, TokenAccount};

use crate::errors::AgentShieldError;
use crate::events::{DelegationRevoked, SessionFinalized};
use crate::state::*;

#[derive(Accounts)]
pub struct FinalizeSession<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault.owner.as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    /// Session rent is returned to the session's agent (who paid for it).
    /// Seeds include token_mint for per-token concurrent sessions.
    #[account(
        mut,
        has_one = vault @ AgentShieldError::InvalidSession,
        seeds = [
            b"session",
            vault.key().as_ref(),
            session.agent.as_ref(),
            session.authorized_token.as_ref(),
        ],
        bump = session.bump,
        close = session_rent_recipient,
    )]
    pub session: Account<'info, SessionAuthority>,

    /// CHECK: Set to session.agent at runtime; receives rent from closed session.
    #[account(mut)]
    pub session_rent_recipient: UncheckedAccount<'info>,

    /// Vault's PDA token account for the session's token
    #[account(mut)]
    pub vault_token_account: Option<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<FinalizeSession>, success: bool) -> Result<()> {
    let session = &ctx.accounts.session;
    let clock = Clock::get()?;

    let is_expired = session.is_expired(clock.slot);

    // Rent recipient must be the session's agent
    require!(
        ctx.accounts.session_rent_recipient.key() == session.agent,
        AgentShieldError::InvalidSession
    );

    // Non-expired sessions can only be finalized by the session's agent.
    // Expired sessions can be cleaned up by anyone (permissionless crank).
    if !is_expired {
        require!(
            ctx.accounts.payer.key() == session.agent,
            AgentShieldError::UnauthorizedAgent
        );
        require!(session.authorized, AgentShieldError::SessionNotAuthorized);
    }

    // Expired sessions are always treated as failed
    let success = if is_expired { false } else { success };

    // Extract session data before we lose access
    let session_agent = session.agent;
    let session_amount = session.authorized_amount;
    let session_action_type = session.action_type;
    let session_delegated = session.delegated;
    let session_developer_fee = session.developer_fee;

    let vault = &mut ctx.accounts.vault;

    // Extract vault PDA seeds data upfront
    let owner_key = vault.owner;
    let vault_id_bytes = vault.vault_id.to_le_bytes();
    let vault_bump = vault.bump;

    let bump_slice = [vault_bump];
    let signer_seeds = [
        b"vault" as &[u8],
        owner_key.as_ref(),
        vault_id_bytes.as_ref(),
        bump_slice.as_ref(),
    ];
    let binding = [signer_seeds.as_slice()];

    // Revoke delegation
    if session_delegated {
        if let Some(vault_token) = ctx.accounts.vault_token_account.as_ref() {
            let revoke_accounts = Revoke {
                source: vault_token.to_account_info(),
                authority: vault.to_account_info(),
            };
            let revoke_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                revoke_accounts,
                &binding,
            );
            token::revoke(revoke_ctx)?;

            emit!(DelegationRevoked {
                vault: vault.key(),
                token_account: vault_token.key(),
                timestamp: clock.unix_timestamp,
            });
        }
    }

    // Update vault stats on success (fees already collected in validate)
    if success && !is_expired {
        vault.total_transactions = vault
            .total_transactions
            .checked_add(1)
            .ok_or(AgentShieldError::Overflow)?;
        vault.total_volume = vault
            .total_volume
            .checked_add(session_amount)
            .ok_or(AgentShieldError::Overflow)?;

        if session_developer_fee > 0 {
            vault.total_fees_collected = vault
                .total_fees_collected
                .checked_add(session_developer_fee)
                .ok_or(AgentShieldError::Overflow)?;
        }

        // Update position count for perpetual actions
        match session_action_type {
            ActionType::OpenPosition => {
                vault.open_positions = vault
                    .open_positions
                    .checked_add(1)
                    .ok_or(AgentShieldError::Overflow)?;
            }
            ActionType::ClosePosition => {
                vault.open_positions = vault
                    .open_positions
                    .checked_sub(1)
                    .ok_or(AgentShieldError::Overflow)?;
            }
            _ => {}
        }
    }

    emit!(SessionFinalized {
        vault: vault.key(),
        agent: session_agent,
        success,
        is_expired,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
