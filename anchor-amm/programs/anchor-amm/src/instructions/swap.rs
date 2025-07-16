// programs/amm/src/instructions/swap.rs
use crate::*;
use anchor_spl::token::{self, Token, TokenAccount};

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,

    #[account(mut)]
    pub vault_in: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_out: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_in: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_out: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    let (reserve_in, reserve_out) = if ctx.accounts.vault_in.mint == pool.token_a {
        (pool.reserve_a, pool.reserve_b)
    } else {
        (pool.reserve_b, pool.reserve_a)
    };

    // Use strategy to calculate swap output
    let amount_out = ConstantProductStrategy::calculate_amount_out(
        amount_in,
        reserve_in,
        reserve_out,
        pool.fee,
    )?;

    require!(amount_out >= min_amount_out, AmmError::SlippageExceeded);

    // Transfer tokens in
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.user_in.to_account_info(),
        to: ctx.accounts.vault_in.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        amount_in,
    )?;

    // Transfer tokens out
    let seeds = &[
        b"pool",
        pool.token_a.as_ref(),
        pool.token_b.as_ref(),
        &[pool.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = token::Transfer {
        from: ctx.accounts.vault_out.to_account_info(),
        to: ctx.accounts.user_out.to_account_info(),
        authority: pool.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        ),
        amount_out,
    )?;

    // Update reserves
    if ctx.accounts.vault_in.mint == pool.token_a {
        pool.reserve_a += amount_in;
        pool.reserve_b -= amount_out;
    } else {
        pool.reserve_b += amount_in;
        pool.reserve_a -= amount_out;
    }

    Ok(())
}
