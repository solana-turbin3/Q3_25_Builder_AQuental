// programs/amm/src/instructions/withdraw.rs
use crate::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,

    #[account(mut)]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_b: Account<'info, TokenAccount>,

    #[account(mut)]
    pub lp_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_lp: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_a: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_b: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Withdraw>, lp_amount: u64) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    
    // Use strategy to calculate withdraw amounts
    let (out_a, out_b) = ConstantProductStrategy::calculate_withdraw_amounts(
        lp_amount,
        pool.reserve_a,
        pool.reserve_b,
        pool.lp_supply,
    )?;

    // Burn LP tokens
    let seeds = &[
        b"pool",
        pool.token_a.as_ref(),
        pool.token_b.as_ref(),
        &[pool.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = token::Burn {
        mint: ctx.accounts.lp_mint.to_account_info(),
        from: ctx.accounts.user_lp.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token::burn(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        lp_amount,
    )?;

    // Transfer tokens out
    let cpi_accounts = token::Transfer {
        from: ctx.accounts.vault_a.to_account_info(),
        to: ctx.accounts.user_a.to_account_info(),
        authority: pool.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        ),
        out_a,
    )?;

    let cpi_accounts = token::Transfer {
        from: ctx.accounts.vault_b.to_account_info(),
        to: ctx.accounts.user_b.to_account_info(),
        authority: pool.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        ),
        out_b,
    )?;

    pool.reserve_a = pool
        .reserve_a
        .checked_sub(out_a)
        .ok_or(AmmError::Overflow)?;
    pool.reserve_b = pool
        .reserve_b
        .checked_sub(out_b)
        .ok_or(AmmError::Overflow)?;
    pool.lp_supply = pool
        .lp_supply
        .checked_sub(lp_amount)
        .ok_or(AmmError::Overflow)?;

    Ok(())
}
