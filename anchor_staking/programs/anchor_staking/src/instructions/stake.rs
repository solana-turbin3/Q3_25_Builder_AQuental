//! Deposit tokens into the pool and update rewards.
use crate::*;
use anchor_spl::token::{Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Stake<'info> {
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

pub fn handler(ctx: Context<Stake>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    update_rewards(&mut ctx.accounts.pool, &mut ctx.accounts.user_stake, now)?;

    // Transfer tokens from user to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        amount,
    )?;

    ctx.accounts.user_stake.staked_amount += amount;
    ctx.accounts.pool.total_staked += amount;
    Ok(())
}
