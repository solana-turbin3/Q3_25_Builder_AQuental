// programs/amm/src/instructions/initialize.rs
use crate::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = Pool::LEN,
        seeds = [b"pool", token_a.key().as_ref(), token_b.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, Pool>,

    /// Token mints (order must be consistent for PDA)
    pub token_a: Account<'info, Mint>,
    pub token_b: Account<'info, Mint>,

    /// Vault token accounts for the two reserves
    #[account(
        init,
        payer = payer,
        token::mint = token_a,
        token::authority = pool,
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        token::mint = token_b,
        token::authority = pool,
    )]
    pub vault_b: Account<'info, TokenAccount>,

    /// LP mint
    #[account(
        init,
        payer = payer,
        mint::decimals = 6,
        mint::authority = pool,
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Initialize>, fee: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.token_a = ctx.accounts.token_a.key();
    pool.token_b = ctx.accounts.token_b.key();
    pool.reserve_a = 0;
    pool.reserve_b = 0;
    pool.lp_supply = 0;
    pool.fee = fee;
    pool.bump = ctx.bumps.pool;
    Ok(())
}
