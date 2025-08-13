use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::Sprint;
use crate::errors::SprintVaultError;

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
    // Validate amount
    if amount == 0 {
        return Err(error!(SprintVaultError::InvalidAmount));
    }
    
    // Check if the amount matches the expected total
    let sprint = &ctx.accounts.sprint;
    if amount != sprint.total_amount {
        msg!(
            "Warning: Depositing {} but sprint expects {}",
            amount,
            sprint.total_amount
        );
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
    
    msg!(
        "Deposited {} tokens to sprint {} vault",
        amount,
        sprint.sprint_id
    );
    
    Ok(())
}
