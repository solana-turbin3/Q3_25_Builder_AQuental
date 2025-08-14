use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::Sprint;
use crate::errors::SprintVaultError;
use crate::utils::{get_current_time, validate_token_account_not_frozen};

#[derive(Accounts)]
pub struct DepositToEscrow<'info> {
    #[account(
        mut,
        seeds = [b"sprint", employer.key().as_ref(), sprint.sprint_id.to_le_bytes().as_ref()],
        bump = sprint.bump,
        has_one = employer,
        has_one = vault,
    )]
    pub sprint: Account<'info, Sprint>,
    
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub employer_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub employer: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<DepositToEscrow>, amount: u64) -> Result<()> {
    let sprint = &mut ctx.accounts.sprint;
    let current_time = get_current_time()?;
    
    // Validate token accounts are not frozen
    validate_token_account_not_frozen(&ctx.accounts.employer_token_account)?;
    validate_token_account_not_frozen(&ctx.accounts.vault)?;
    
    // Check that the employer has sufficient balance
    require!(
        ctx.accounts.employer_token_account.amount >= sprint.total_amount,
        SprintVaultError::InsufficientTokenBalance
    );
    
    // Check if sprint is already funded
    if sprint.is_funded {
        return Err(error!(SprintVaultError::SprintAlreadyStarted));
    }
    
    // Check if sprint has already started
    if current_time >= sprint.start_time {
        return Err(error!(SprintVaultError::SprintAlreadyStarted));
    }
    
    // Validate amount - must be exactly the total amount (full funding)
    if amount != sprint.total_amount {
        msg!(
            "Must deposit exact amount. Expected: {}, Received: {}",
            sprint.total_amount,
            amount
        );
        return Err(error!(SprintVaultError::InvalidAmount));
    }
    
    // Transfer tokens from employer to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.employer_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.employer.to_account_info(),
    };
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    
    token::transfer(cpi_ctx, amount)?;
    
    // Mark sprint as fully funded
    let sprint = &mut ctx.accounts.sprint;
    sprint.is_funded = true;
    
    msg!(
        "Sprint {} fully funded with {} tokens",
        sprint.sprint_id,
        amount
    );
    
    Ok(())
}
