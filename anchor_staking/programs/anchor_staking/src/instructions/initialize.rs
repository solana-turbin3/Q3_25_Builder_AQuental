//! Initialize the staking pool
use crate::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
#[instruction(reward_per_second: u64, pool_seed: Vec<u8>, reward_vault_seed: Vec<u8>)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 8 + 8 + 32 + 32 + 1,
        seeds = [&pool_seed[..]],
        bump
    )]
    pub pool: Account<'info, StakePool>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub reward_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = authority,
        token::mint = reward_mint,
        token::authority = pool,
        seeds = [&reward_vault_seed[..]],
        bump
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<Initialize>,
    reward_per_second: u64,
    pool_seed: Vec<u8>,
    reward_vault_seed: Vec<u8>
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    
    pool.reward_per_second = reward_per_second;
    pool.total_staked = 0;
    pool.reward_mint = ctx.accounts.reward_mint.key();
    pool.reward_vault = ctx.accounts.reward_vault.key();
    pool.bump = ctx.bumps.pool;

    Ok(())
}
