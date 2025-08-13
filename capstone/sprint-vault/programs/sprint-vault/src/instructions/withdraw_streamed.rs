use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::Sprint;
use crate::errors::SprintVaultError;
use crate::utils::get_current_time;

#[derive(Accounts)]
pub struct WithdrawStreamed<'info> {
    #[account(
        mut,
        seeds = [b"sprint", sprint.employer.as_ref(), sprint.sprint_id.to_le_bytes().as_ref()],
        bump = sprint.bump,
        has_one = freelancer,
        has_one = vault,
    )]
    pub sprint: Account<'info, Sprint>,
    
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub freelancer_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub freelancer: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawStreamed>) -> Result<()> {
    let sprint = &mut ctx.accounts.sprint;
    
    // Check if sprint is paused
    if sprint.is_paused {
        return Err(error!(SprintVaultError::SprintPaused));
    }
    
    // Get current time
    let current_time = get_current_time()?;
    
    // Check if sprint has started
    if current_time < sprint.start_time {
        return Err(error!(SprintVaultError::SprintNotStarted));
    }
    
    // Calculate withdrawable amount
    let withdrawable = sprint.calculate_withdrawable_amount(current_time)?;
    
    // Check if there are funds to withdraw
    if withdrawable == 0 {
        return Err(error!(SprintVaultError::NoFundsAvailable));
    }
    
    // Check vault has sufficient balance
    if ctx.accounts.vault.amount < withdrawable {
        return Err(error!(SprintVaultError::InsufficientFunds));
    }
    
    // Create signer seeds for PDA
    let sprint_id_bytes = sprint.sprint_id.to_le_bytes();
    let seeds = &[
        b"sprint",
        sprint.employer.as_ref(),
        sprint_id_bytes.as_ref(),
        &[sprint.bump],
    ];
    let signer = &[&seeds[..]];
    
    // Transfer tokens from vault to freelancer
    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.freelancer_token_account.to_account_info(),
        authority: sprint.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    
    token::transfer(cpi_ctx, withdrawable)?;
    
    // Update withdrawn amount
    sprint.withdrawn_amount = sprint.withdrawn_amount
        .checked_add(withdrawable)
        .ok_or(error!(SprintVaultError::MathOverflow))?;
    
    msg!(
        "Withdrew {} tokens from sprint {}, total withdrawn: {}",
        withdrawable,
        sprint.sprint_id,
        sprint.withdrawn_amount
    );
    
    Ok(())
}
