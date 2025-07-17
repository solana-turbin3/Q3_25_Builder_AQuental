//! Anchor-based SPL-token staking program.
//! Users stake an SPL token and accrue rewards per second.
//! No lock-up; deposit & withdraw at any time.
use anchor_lang::prelude::*;
use anchor_spl::token;

pub mod errors;
pub mod instructions;
pub mod state;

use errors::*;
use instructions::*;
use state::*;

declare_id!("Hro93BHZWNMimrnpLKxCBAJXnHx1CPdEMrTL8NSRq8Ue");

#[program]
pub mod staking {
    use super::*;

    /// Initialise global staking configuration.
    pub fn initialize(
        ctx: Context<Initialize>,
        reward_per_second: u64,
        pool_seed: Vec<u8>,
        reward_vault_seed: Vec<u8>
    ) -> Result<()> {
        instructions::initialize::handler(ctx, reward_per_second, pool_seed, reward_vault_seed)
    }

    /// Create personal staking account (PDA).
    pub fn init_user(ctx: Context<InitUser>) -> Result<()> {
        instructions::init_user::handler(ctx)
    }

    /// Deposit staking tokens into the pool.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        instructions::stake::handler(ctx, amount)
    }

    /// Withdraw staking tokens + accrued rewards.
    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        instructions::unstake::handler(ctx)
    }

    /// Claim rewards without withdrawing principal.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::handler(ctx)
    }
}

/// Update rewards based on elapsed time since last update
pub fn update_rewards(pool: &mut StakePool, user_stake: &mut UserStake, now: i64) -> Result<()> {
    if user_stake.staked_amount > 0 {
        let elapsed_time = now.saturating_sub(user_stake.last_update) as u64;
        let reward_increment = (user_stake.staked_amount as u128)
            .checked_mul(pool.reward_per_second as u128)
            .and_then(|x| x.checked_mul(elapsed_time as u128))
            .ok_or(StakingError::CalculationOverflow)? as u64;
        
        user_stake.reward_debt = user_stake.reward_debt.saturating_add(reward_increment);
    }
    
    user_stake.last_update = now;
    Ok(())
}
