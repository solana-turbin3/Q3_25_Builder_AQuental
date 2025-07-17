use anchor_lang::prelude::*;

#[account]
pub struct StakePool {
    pub reward_per_second: u64, // lamports per second per staked token
    pub total_staked: u64,      // total tokens currently staked
    pub reward_mint: Pubkey,    // mint of reward token
    pub reward_vault: Pubkey,   // vault holding reward tokens
    pub bump: u8,
}

#[account]
pub struct UserStake {
    pub staked_amount: u64,
    pub reward_debt: u64, // snapshot of global reward index
    pub last_update: i64, // UNIX timestamp
    pub bump: u8,
}
