//! Initialize user staking account
use crate::*;

#[derive(Accounts)]
pub struct InitUser<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + 8 + 8 + 8 + 1,
        seeds = [b"user", user.key().as_ref()],
        bump
    )]
    pub user_stake: Account<'info, UserStake>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitUser>) -> Result<()> {
    let user_stake = &mut ctx.accounts.user_stake;
    let now = Clock::get()?.unix_timestamp;
    
    user_stake.staked_amount = 0;
    user_stake.reward_debt = 0;
    user_stake.last_update = now;
    user_stake.bump = ctx.bumps.user_stake;

    Ok(())
}
