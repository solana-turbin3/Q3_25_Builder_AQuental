use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use crate::state::Sprint;
use crate::errors::SprintVaultError;
use crate::utils::{get_current_time, validate_token_account_not_frozen, is_dust_amount, round_amount_for_precision};
use crate::constants::get_min_withdrawal_amount;

#[derive(Accounts)]
pub struct WithdrawStreamed<'info> {
    #[account(
        mut,
        seeds = [b"sprint", sprint.employer.as_ref(), sprint.sprint_id.to_le_bytes().as_ref()],
        bump = sprint.bump,
        has_one = freelancer,
        has_one = vault,
        has_one = mint,
    )]
    pub sprint: Account<'info, Sprint>,
    
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        constraint = freelancer_token_account.owner == freelancer.key() @ SprintVaultError::Unauthorized,
        constraint = freelancer_token_account.mint == sprint.mint @ SprintVaultError::InvalidMint,
    )]
    pub freelancer_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub freelancer: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawStreamed>) -> Result<()> {
    let sprint = &mut ctx.accounts.sprint;
    
    // Basic validation
    require!(sprint.is_funded, SprintVaultError::SprintNotFunded);
    require!(!sprint.is_paused, SprintVaultError::SprintPaused);

    let current_time = get_current_time()?;
    require!(current_time >= sprint.start_time, SprintVaultError::SprintNotStarted);

    // Calculate and withdraw
    let withdrawable = sprint.calculate_withdrawable_amount(current_time)?;
    require!(withdrawable > 0, SprintVaultError::NoFundsAvailable);

    // Transfer logic
    let sprint_id_bytes = sprint.sprint_id.to_le_bytes();
    let seeds = &[
        b"sprint",
        sprint.employer.as_ref(),
        sprint_id_bytes.as_ref(),
        &[sprint.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.freelancer_token_account.to_account_info(),
        authority: sprint.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, withdrawable)?;

    // Update state
    sprint.withdrawn_amount = sprint.withdrawn_amount.checked_add(withdrawable).ok_or(SprintVaultError::MathOverflow)?;
    sprint.last_operation_slot = Clock::get()?.slot;

    Ok(())
}
