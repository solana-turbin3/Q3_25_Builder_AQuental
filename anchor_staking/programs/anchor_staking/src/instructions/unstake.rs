//! Withdraw staked tokens and claim rewards
use crate::*;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub pool: Account<'info, StakePool>,

    #[account(mut,
        seeds = [b"user", user.key().as_ref()],
        bump = user_stake.bump
    )]
    pub user_stake: Account<'info, UserStake>,

    #[account(mut, constraint = user_token.mint == reward_mint.key())]
    pub user_token: Account<'info, TokenAccount>,

    #[account(mut, constraint = vault.mint == reward_mint.key())]
    pub vault: Account<'info, TokenAccount>,

    pub reward_mint: Account<'info, Mint>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Unstake>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    update_rewards(&mut ctx.accounts.pool, &mut ctx.accounts.user_stake, now)?;

    let staked_amount = ctx.accounts.user_stake.staked_amount;
    let reward_amount = ctx.accounts.user_stake.reward_debt;

    // Transfer staked tokens back to user
    let pool_seeds = &[b"pool".as_ref(), &[ctx.accounts.pool.bump]];
    let signer_seeds = &[pool_seeds.as_slice()];
    
    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user_token.to_account_info(),
        authority: ctx.accounts.pool.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        ),
        staked_amount + reward_amount,
    )?;

    // Update state
    ctx.accounts.user_stake.staked_amount = 0;
    ctx.accounts.user_stake.reward_debt = 0;
    ctx.accounts.pool.total_staked = ctx.accounts.pool.total_staked.saturating_sub(staked_amount);

    Ok(())
}
