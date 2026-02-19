use super::{ActionType, MAX_RECENT_TRANSACTIONS, MAX_SPEND_ENTRIES, ROLLING_WINDOW_SECONDS};
use crate::errors::AgentShieldError;
use anchor_lang::prelude::*;

#[account]
pub struct SpendTracker {
    /// Associated vault pubkey
    pub vault: Pubkey,

    /// Rolling spend entries: (token_mint, usd_amount, base_amount, timestamp)
    /// Entries older than ROLLING_WINDOW_SECONDS are pruned on each access
    pub rolling_spends: Vec<SpendEntry>,

    /// Recent transaction log for on-chain audit trail
    /// Bounded to MAX_RECENT_TRANSACTIONS, oldest entries evicted (ring buffer)
    pub recent_transactions: Vec<TransactionRecord>,

    /// Bump seed for PDA
    pub bump: u8,
}

impl SpendTracker {
    /// Conservative size estimate:
    /// discriminator (8) + vault (32) +
    /// rolling_spends vec (4 + SpendEntry::SIZE * MAX_SPEND_ENTRIES) +
    /// recent_transactions vec (4 + TransactionRecord::SIZE * MAX_RECENT_TRANSACTIONS) +
    /// bump (1)
    pub const SIZE: usize = 8
        + 32
        + (4 + SpendEntry::SIZE * MAX_SPEND_ENTRIES)
        + (4 + TransactionRecord::SIZE * MAX_RECENT_TRANSACTIONS)
        + 1;

    /// Prune expired entries and return the aggregate USD spend
    /// across ALL tokens within the rolling window.
    pub fn get_rolling_spend_usd(&mut self, current_timestamp: i64) -> Result<u64> {
        let window_start = current_timestamp
            .checked_sub(ROLLING_WINDOW_SECONDS)
            .ok_or(AgentShieldError::Overflow)?;

        // Remove expired entries
        self.rolling_spends
            .retain(|entry| entry.timestamp >= window_start);

        // Sum USD amounts across ALL tokens
        let total = self.rolling_spends.iter().try_fold(0u64, |acc, entry| {
            acc.checked_add(entry.usd_amount)
                .ok_or(error!(AgentShieldError::Overflow))
        })?;

        Ok(total)
    }

    /// Prune expired entries and return the total base-unit spend
    /// for a specific token within the rolling window.
    pub fn get_rolling_spend_by_token(
        &mut self,
        token_mint: &Pubkey,
        current_timestamp: i64,
    ) -> Result<u64> {
        let window_start = current_timestamp
            .checked_sub(ROLLING_WINDOW_SECONDS)
            .ok_or(AgentShieldError::Overflow)?;

        // Remove expired entries
        self.rolling_spends
            .retain(|entry| entry.timestamp >= window_start);

        // Sum base_amount entries for this token
        let total = self
            .rolling_spends
            .iter()
            .filter(|entry| entry.token_mint == *token_mint)
            .try_fold(0u64, |acc, entry| {
                acc.checked_add(entry.base_amount)
                    .ok_or(error!(AgentShieldError::Overflow))
            })?;

        Ok(total)
    }

    /// Record a new spend entry with both USD and base amounts.
    /// Prune expired entries first to make room.
    /// If the vector is full after pruning (all entries are still within
    /// the rolling window), reject the transaction to prevent spend cap bypass.
    pub fn record_spend(
        &mut self,
        token_mint: Pubkey,
        usd_amount: u64,
        base_amount: u64,
        timestamp: i64,
    ) -> Result<()> {
        // Prune expired entries before checking capacity
        let window_start = timestamp
            .checked_sub(ROLLING_WINDOW_SECONDS)
            .ok_or(AgentShieldError::Overflow)?;
        self.rolling_spends
            .retain(|entry| entry.timestamp >= window_start);

        // Reject if still at capacity (all entries are active)
        require!(
            self.rolling_spends.len() < MAX_SPEND_ENTRIES,
            AgentShieldError::TooManySpendEntries
        );

        self.rolling_spends.push(SpendEntry {
            token_mint,
            usd_amount,
            base_amount,
            timestamp,
        });

        Ok(())
    }

    /// Record a transaction in the audit log (ring buffer)
    pub fn record_transaction(&mut self, record: TransactionRecord) {
        if self.recent_transactions.len() >= MAX_RECENT_TRANSACTIONS {
            self.recent_transactions.remove(0);
        }
        self.recent_transactions.push(record);
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SpendEntry {
    /// Token mint for audit trail
    pub token_mint: Pubkey,
    /// USD value of this spend (6 decimals, e.g., $500 = 500_000_000)
    pub usd_amount: u64,
    /// Original amount in token base units (for per-token cap checks)
    pub base_amount: u64,
    pub timestamp: i64,
}

impl SpendEntry {
    /// 32 (token_mint) + 8 (usd_amount) + 8 (base_amount) + 8 (timestamp) = 56 bytes
    pub const SIZE: usize = 32 + 8 + 8 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TransactionRecord {
    pub timestamp: i64,
    pub action_type: ActionType,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub protocol: Pubkey,
    pub success: bool,
    pub slot: u64,
}

impl TransactionRecord {
    /// 8 + 1 + 32 + 8 + 32 + 1 + 8 = 90 bytes
    pub const SIZE: usize = 8 + 1 + 32 + 8 + 32 + 1 + 8;
}
