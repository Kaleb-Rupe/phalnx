use anchor_lang::prelude::*;

use crate::errors::AgentShieldError;
use crate::oracle;
use crate::state::*;

/// Convert a token amount to USD value (6 decimals).
///
/// - Stablecoin (oracle_feed == default): 1:1 USD
/// - Oracle-priced: reads Pyth or Switchboard feed from remaining_accounts[0]
///
/// Returns (usd_amount, oracle_price_option, oracle_source_option)
pub(crate) fn convert_to_usd(
    allowed_token: &AllowedToken,
    amount: u64,
    remaining_accounts: &[AccountInfo],
    clock: &Clock,
) -> Result<(u64, Option<i128>, Option<u8>)> {
    if allowed_token.is_stablecoin() {
        // Stablecoin: 1:1 USD. Convert base units to USD (6 decimals).
        let usd = stablecoin_to_usd(amount, allowed_token.decimals)?;
        Ok((usd, None, None))
    } else {
        // Oracle-priced: read feed from remaining_accounts (auto-detect type)
        require!(
            !remaining_accounts.is_empty(),
            AgentShieldError::OracleAccountMissing
        );

        let feed_account_info = &remaining_accounts[0];

        // Dispatcher: checks account owner → Pyth or Switchboard
        let (mantissa, source) =
            oracle::parse_oracle_price(feed_account_info, &allowed_token.oracle_feed, clock.slot)?;

        let usd = oracle_price_to_usd(amount, mantissa, allowed_token.decimals)?;

        Ok((usd, Some(mantissa), Some(source as u8)))
    }
}

/// Convert stablecoin amount to USD (6 decimals).
/// usd = amount * 10^USD_DECIMALS / 10^token_decimals
pub(crate) fn stablecoin_to_usd(amount: u64, token_decimals: u8) -> Result<u64> {
    if token_decimals == USD_DECIMALS {
        // USDC/USDT (6 decimals) → direct 1:1
        Ok(amount)
    } else if token_decimals < USD_DECIMALS {
        // Fewer decimals than USD: multiply up
        let diff = USD_DECIMALS
            .checked_sub(token_decimals)
            .ok_or(AgentShieldError::Overflow)?;
        let multiplier = 10u64
            .checked_pow(diff as u32)
            .ok_or(AgentShieldError::Overflow)?;
        amount
            .checked_mul(multiplier)
            .ok_or(error!(AgentShieldError::Overflow))
    } else {
        // More decimals than USD: divide down
        let diff = token_decimals
            .checked_sub(USD_DECIMALS)
            .ok_or(AgentShieldError::Overflow)?;
        let divisor = 10u64
            .checked_pow(diff as u32)
            .ok_or(AgentShieldError::Overflow)?;
        amount
            .checked_div(divisor)
            .ok_or(error!(AgentShieldError::Overflow))
    }
}

/// Convert oracle-priced token amount to USD (6 decimals).
/// Both Pyth and Switchboard prices are normalized to 18 implicit decimals.
/// usd = amount * mantissa / 10^(token_decimals + 12)
///
/// The 12 comes from: 18 (oracle decimals) - 6 (USD decimals) = 12
pub(crate) fn oracle_price_to_usd(amount: u64, mantissa: i128, token_decimals: u8) -> Result<u64> {
    // Ensure positive price
    require!(mantissa > 0, AgentShieldError::OracleFeedInvalid);

    // Compute: amount * mantissa (in i128 to avoid overflow)
    let numerator = (amount as i128)
        .checked_mul(mantissa)
        .ok_or(AgentShieldError::Overflow)?;

    // Divisor = 10^(token_decimals + 12)
    let exponent = (token_decimals as u32)
        .checked_add(12)
        .ok_or(AgentShieldError::Overflow)?;
    let divisor = 10i128
        .checked_pow(exponent)
        .ok_or(AgentShieldError::Overflow)?;

    let usd_i128 = numerator
        .checked_div(divisor)
        .ok_or(AgentShieldError::Overflow)?;

    // Ensure result fits in u64
    require!(usd_i128 >= 0, AgentShieldError::OracleFeedInvalid);
    require!(usd_i128 <= u64::MAX as i128, AgentShieldError::Overflow);

    Ok(usd_i128 as u64)
}
