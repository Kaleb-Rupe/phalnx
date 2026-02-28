use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::get_stack_height;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};
use anchor_spl::token::{self, Approve, Mint, Token, TokenAccount, Transfer};

use crate::errors::AgentShieldError;
use crate::events::{ActionAuthorized, FeesCollected};
use crate::state::*;

use super::integrations::{flash_trade, jupiter, jupiter_lend};
use super::utils::stablecoin_to_usd;

use crate::state::PositionEffect;

#[derive(Accounts)]
#[instruction(action_type: ActionType, token_mint: Pubkey)]
pub struct ValidateAndAuthorize<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,

    #[account(
        mut,
        constraint = vault.is_agent(&agent.key()) @ AgentShieldError::UnauthorizedAgent,
        seeds = [b"vault", vault.owner.as_ref(), vault.vault_id.to_le_bytes().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, AgentVault>,

    #[account(
        has_one = vault,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,

    /// Zero-copy SpendTracker
    #[account(
        mut,
        seeds = [b"tracker", vault.key().as_ref()],
        bump,
    )]
    pub tracker: AccountLoader<'info, SpendTracker>,

    /// Ephemeral session PDA — `init` ensures no double-authorization.
    /// Seeds include token_mint for per-token concurrent sessions.
    #[account(
        init,
        payer = agent,
        space = SessionAuthority::SIZE,
        seeds = [
            b"session",
            vault.key().as_ref(),
            agent.key().as_ref(),
            token_mint.as_ref(),
        ],
        bump,
    )]
    pub session: Account<'info, SessionAuthority>,

    /// Vault's PDA-owned token account for the spend token
    #[account(
        mut,
        constraint = vault_token_account.owner == vault.key()
            @ AgentShieldError::InvalidTokenAccount,
        constraint = vault_token_account.mint == token_mint_account.key()
            @ AgentShieldError::InvalidTokenAccount,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// The token mint being spent — constrained to match token_mint arg
    #[account(
        constraint = token_mint_account.key() == token_mint
            @ AgentShieldError::InvalidTokenAccount,
    )]
    pub token_mint_account: Account<'info, Mint>,

    /// Protocol treasury token account (needed when protocol_fee > 0)
    #[account(mut)]
    pub protocol_treasury_token_account: Option<Account<'info, TokenAccount>>,

    /// Developer fee destination token account (needed when developer_fee > 0)
    #[account(mut)]
    pub fee_destination_token_account: Option<Account<'info, TokenAccount>>,

    /// Vault's stablecoin ATA to snapshot (for non-stablecoin input swaps).
    /// Required when input token is NOT a stablecoin.
    #[account(mut)]
    pub output_stablecoin_account: Option<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,

    /// Instructions sysvar for verifying DeFi instruction program_id
    /// and protocol slippage enforcement.
    /// CHECK: address constrained to sysvar::instructions::ID
    #[account(
        address = anchor_lang::solana_program::sysvar::instructions::ID
    )]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<ValidateAndAuthorize>,
    action_type: ActionType,
    token_mint: Pubkey,
    amount: u64,
    target_protocol: Pubkey,
    leverage_bps: Option<u16>,
) -> Result<()> {
    // 0. Reject CPI calls — only top-level transaction instructions allowed.
    require!(
        get_stack_height()
            == anchor_lang::solana_program::instruction::TRANSACTION_LEVEL_STACK_HEIGHT,
        AgentShieldError::CpiCallNotAllowed
    );

    let vault = &ctx.accounts.vault;
    let policy = &ctx.accounts.policy;
    let clock = Clock::get()?;
    let is_spending = action_type.is_spending();
    let is_stablecoin_input = is_stablecoin_mint(&token_mint);

    // 1. Vault must be active
    require!(vault.is_active(), AgentShieldError::VaultNotActive);

    // 1b. Amount validation: spending requires amount > 0,
    //     non-spending requires amount == 0
    if is_spending {
        require!(amount > 0, AgentShieldError::TransactionTooLarge);
    } else {
        require!(amount == 0, AgentShieldError::InvalidNonSpendingAmount);
    }

    // 2. Protocol must be allowed (mode-based check) — ALL actions
    require!(
        policy.is_protocol_allowed(&target_protocol),
        AgentShieldError::ProtocolNotAllowed
    );

    // --- Stablecoin-only spending path ---
    let mut output_mint = Pubkey::default();
    let mut stablecoin_balance_before: u64 = 0;
    let (usd_amount, protocol_fee, developer_fee) = if is_spending {
        let token_decimals = ctx.accounts.token_mint_account.decimals;

        if is_stablecoin_input {
            // Stablecoin input: exact USD tracking (1:1 conversion)
            let usd_amt = stablecoin_to_usd(amount, token_decimals)?;

            // Single tx USD check
            require!(
                usd_amt <= policy.max_transaction_size_usd,
                AgentShieldError::TransactionTooLarge
            );

            // Rolling 24h USD check
            let mut tracker = ctx.accounts.tracker.load_mut()?;
            let rolling_usd = tracker.get_rolling_24h_usd(&clock);
            let new_total_usd = rolling_usd
                .checked_add(usd_amt)
                .ok_or(AgentShieldError::Overflow)?;

            require!(
                new_total_usd <= policy.daily_spending_cap_usd,
                AgentShieldError::DailyCapExceeded
            );

            // Record spend
            tracker.record_spend(&clock, usd_amt)?;
            drop(tracker);

            // Calculate fees
            let dev_fee_rate = policy.developer_fee_rate;
            let p_fee = amount
                .checked_mul(PROTOCOL_FEE_RATE as u64)
                .ok_or(AgentShieldError::Overflow)?
                .checked_div(FEE_RATE_DENOMINATOR)
                .ok_or(AgentShieldError::Overflow)?;
            let d_fee = amount
                .checked_mul(dev_fee_rate as u64)
                .ok_or(AgentShieldError::Overflow)?
                .checked_div(FEE_RATE_DENOMINATOR)
                .ok_or(AgentShieldError::Overflow)?;

            (usd_amt, p_fee, d_fee)
        } else {
            // Non-stablecoin input: snapshot stablecoin balance, verify at finalize.
            // No cap check or fees here — USD tracked when stablecoin flows in finalize.
            let stablecoin_acct = ctx
                .accounts
                .output_stablecoin_account
                .as_ref()
                .ok_or(error!(AgentShieldError::InvalidTokenAccount))?;

            // Verify the stablecoin account belongs to the vault
            require!(
                stablecoin_acct.owner == vault.key(),
                AgentShieldError::InvalidTokenAccount
            );
            // Verify it's actually a stablecoin mint
            require!(
                is_stablecoin_mint(&stablecoin_acct.mint),
                AgentShieldError::TokenNotRegistered
            );

            output_mint = stablecoin_acct.mint;
            stablecoin_balance_before = stablecoin_acct.amount;

            // No fees or cap check for non-stablecoin input
            // (tracked at finalize when stablecoin balance increases)
            (0u64, 0u64, 0u64)
        }
    } else {
        // Non-spending: no fees, no spend tracking
        (0u64, 0u64, 0u64)
    };

    // --- Protocol slippage + dust deposit scanning ---
    // Scan ALL instructions between validate and finalize to verify:
    // 1. Slippage on every DeFi instruction (not just the next one)
    // 2. No top-level SPL Token transfers to vault stablecoin ATA (dust deposit guard)
    if is_spending {
        let ix_sysvar = &ctx.accounts.instructions_sysvar.to_account_info();
        let current_idx = load_current_index_checked(ix_sysvar)
            .map_err(|_| error!(AgentShieldError::MissingFinalizeInstruction))?;
        let finalize_hash: [u8; 8] = [34, 148, 144, 47, 37, 130, 206, 161];

        // Pre-compute dust deposit guard values (non-stablecoin input only)
        let spl_token_id = ctx.accounts.token_program.key();
        let stablecoin_key = if !is_stablecoin_input {
            ctx.accounts
                .output_stablecoin_account
                .as_ref()
                .map(|a| a.key())
        } else {
            None
        };

        let mut scan_idx = (current_idx as usize).saturating_add(1);
        for _ in 0..20 {
            match load_instruction_at_checked(scan_idx, ix_sysvar) {
                Ok(ix) => {
                    // Stop at finalize_session
                    if ix.program_id == crate::ID
                        && ix.data.len() >= 8
                        && ix.data[..8] == finalize_hash
                    {
                        break;
                    }

                    // Protocol mismatch check: any recognized DeFi program
                    // must match the declared target_protocol.
                    let is_recognized_defi = ix.program_id == JUPITER_PROGRAM
                        || ix.program_id == FLASH_TRADE_PROGRAM
                        || ix.program_id == JUPITER_LEND_PROGRAM
                        || ix.program_id == JUPITER_EARN_PROGRAM
                        || ix.program_id == JUPITER_BORROW_PROGRAM;

                    if is_recognized_defi {
                        require!(
                            ix.program_id == target_protocol,
                            AgentShieldError::ProtocolMismatch
                        );
                    }

                    // Slippage verification on ALL DeFi instructions
                    if ix.program_id == JUPITER_PROGRAM {
                        jupiter::verify_jupiter_slippage(&ix.data, policy.max_slippage_bps)?;
                    } else if ix.program_id == FLASH_TRADE_PROGRAM {
                        flash_trade::verify_flash_trade_instruction(&ix.data)?;
                    } else if ix.program_id == JUPITER_LEND_PROGRAM
                        || ix.program_id == JUPITER_EARN_PROGRAM
                        || ix.program_id == JUPITER_BORROW_PROGRAM
                    {
                        jupiter_lend::verify_jupiter_lend_instruction(&ix.data)?;
                    }

                    // Dust deposit guard: reject top-level SPL Token Transfers
                    // targeting the vault's stablecoin ATA (non-stablecoin only).
                    // Legitimate swaps CPI-transfer through Jupiter's program,
                    // not as top-level SPL Transfer instructions.
                    if let Some(sc_key) = stablecoin_key {
                        if ix.program_id == spl_token_id
                            && !ix.data.is_empty()
                            && (ix.data[0] == 3 || ix.data[0] == 12)
                        {
                            // SPL Transfer (disc=3) or TransferChecked (disc=12)
                            // Transfer: accounts[1] = dest
                            // TransferChecked: accounts[2] = dest
                            let dest_idx = if ix.data[0] == 3 { 1 } else { 2 };
                            if ix.accounts.len() > dest_idx
                                && ix.accounts[dest_idx].pubkey == sc_key
                            {
                                return Err(error!(AgentShieldError::DustDepositDetected));
                            }
                        }
                    }

                    scan_idx = scan_idx.saturating_add(1);
                }
                Err(_) => break,
            }
        }
    }

    // 7. Leverage check (for perp actions) — ALL actions
    if let Some(lev) = leverage_bps {
        require!(
            policy.is_leverage_within_limit(lev),
            AgentShieldError::LeverageTooHigh
        );
    }

    // 8. Position effect checks
    match action_type.position_effect() {
        PositionEffect::Increment => {
            require!(
                policy.can_open_positions,
                AgentShieldError::PositionOpeningDisallowed
            );
            require!(
                vault.open_positions < policy.max_concurrent_positions,
                AgentShieldError::TooManyPositions
            );
        }
        PositionEffect::Decrement => {
            require!(
                vault.open_positions > 0,
                AgentShieldError::NoPositionsToClose
            );
        }
        PositionEffect::None => {}
    }

    // 9. Verify finalize_session is present in this transaction.
    {
        let ix_sysvar = &ctx.accounts.instructions_sysvar.to_account_info();
        let current_idx = load_current_index_checked(ix_sysvar)
            .map_err(|_| error!(AgentShieldError::MissingFinalizeInstruction))?;
        // sha256("global:finalize_session")[:8]
        let finalize_disc: [u8; 8] = [34, 148, 144, 47, 37, 130, 206, 161];

        let mut found_finalize = false;
        let mut check_idx = (current_idx as usize).saturating_add(1);
        for _ in 0..20 {
            match load_instruction_at_checked(check_idx, ix_sysvar) {
                Ok(ix) => {
                    if ix.program_id == crate::ID
                        && ix.data.len() >= 8
                        && ix.data[..8] == finalize_disc
                    {
                        found_finalize = true;
                        break;
                    }
                    check_idx = check_idx.saturating_add(1);
                }
                Err(_) => break,
            }
        }

        require!(found_finalize, AgentShieldError::MissingFinalizeInstruction);
    }

    // Extract vault PDA seeds data upfront
    let owner_key = vault.owner;
    let vault_id_bytes = vault.vault_id.to_le_bytes();
    let vault_bump = vault.bump;
    let vault_fee_destination = vault.fee_destination;
    let dev_fee_rate = policy.developer_fee_rate;

    let bump_slice = [vault_bump];
    let signer_seeds = [
        b"vault" as &[u8],
        owner_key.as_ref(),
        vault_id_bytes.as_ref(),
        bump_slice.as_ref(),
    ];
    let binding = [signer_seeds.as_slice()];

    // 10. Collect fees and delegate (spending + stablecoin input only)
    if is_spending {
        let delegation_amount = amount
            .checked_sub(protocol_fee)
            .ok_or(AgentShieldError::Overflow)?
            .checked_sub(developer_fee)
            .ok_or(AgentShieldError::Overflow)?;

        // Transfer protocol fee
        if protocol_fee > 0 {
            let treasury_token = ctx
                .accounts
                .protocol_treasury_token_account
                .as_ref()
                .ok_or(error!(AgentShieldError::InvalidProtocolTreasury))?;
            require!(
                treasury_token.owner == PROTOCOL_TREASURY,
                AgentShieldError::InvalidProtocolTreasury
            );
            require!(
                treasury_token.mint == token_mint,
                AgentShieldError::InvalidProtocolTreasury
            );

            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: treasury_token.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                &binding,
            );
            token::transfer(cpi_ctx, protocol_fee)?;
        }

        // Transfer developer fee
        if developer_fee > 0 {
            let fee_dest = ctx
                .accounts
                .fee_destination_token_account
                .as_ref()
                .ok_or(error!(AgentShieldError::InvalidFeeDestination))?;
            require!(
                fee_dest.owner == vault_fee_destination,
                AgentShieldError::InvalidFeeDestination
            );
            require!(
                fee_dest.mint == token_mint,
                AgentShieldError::InvalidFeeDestination
            );

            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: fee_dest.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                &binding,
            );
            token::transfer(cpi_ctx, developer_fee)?;
        }

        if protocol_fee > 0 || developer_fee > 0 {
            emit!(FeesCollected {
                vault: vault.key(),
                token_mint,
                protocol_fee_amount: protocol_fee,
                developer_fee_amount: developer_fee,
                protocol_fee_rate: PROTOCOL_FEE_RATE,
                developer_fee_rate: dev_fee_rate,
                transaction_amount: amount,
                protocol_treasury: PROTOCOL_TREASURY,
                developer_fee_destination: vault_fee_destination,
                cumulative_developer_fees: vault.total_fees_collected.saturating_add(developer_fee),
                timestamp: clock.unix_timestamp,
            });
        }

        // CPI: approve agent as delegate on vault's token account
        let cpi_accounts = Approve {
            to: ctx.accounts.vault_token_account.to_account_info(),
            delegate: ctx.accounts.agent.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            &binding,
        );
        token::approve(cpi_ctx, delegation_amount)?;
    }

    // Create session PDA
    let session = &mut ctx.accounts.session;
    session.vault = vault.key();
    session.agent = ctx.accounts.agent.key();
    session.authorized = true;
    session.authorized_amount = amount;
    session.authorized_token = token_mint;
    session.authorized_protocol = target_protocol;
    session.action_type = action_type;
    session.expires_at_slot = SessionAuthority::calculate_expiry(clock.slot);
    session.delegation_token_account = ctx.accounts.vault_token_account.key();
    session.protocol_fee = protocol_fee;
    session.developer_fee = developer_fee;
    session.delegated = is_spending;
    session.output_mint = output_mint;
    session.stablecoin_balance_before = stablecoin_balance_before;
    session.bump = ctx.bumps.session;

    // Compute rolling spend for event
    let rolling_spend_after = if is_spending && is_stablecoin_input {
        let tracker = ctx.accounts.tracker.load()?;
        tracker.get_rolling_24h_usd(&clock)
    } else {
        0
    };

    emit!(ActionAuthorized {
        vault: vault.key(),
        agent: ctx.accounts.agent.key(),
        action_type,
        token_mint,
        amount,
        usd_amount,
        protocol: target_protocol,
        rolling_spend_usd_after: rolling_spend_after,
        daily_cap_usd: policy.daily_spending_cap_usd,
        delegated: is_spending,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
