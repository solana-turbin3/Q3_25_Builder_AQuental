use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, CloseAccount};
use crate::state::Sprint;
use crate::errors::SprintVaultError;
use crate::utils::get_current_time;

#[derive(Accounts)]
pub struct CloseSprint<'info> {
    #[account(
        mut,
        seeds = [b"sprint", employer.key().as_ref(), sprint.sprint_id.to_le_bytes().as_ref()],
        bump = sprint.bump,
        has_one = employer,
        has_one = vault,
        close = employer
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

pub fn handler(ctx: Context<CloseSprint>) -> Result<()> {
    let sprint = &ctx.accounts.sprint;
    let current_time = get_current_time()?;
    
    // Check if sprint has ended
    if !sprint.is_ended(current_time) && sprint.withdrawn_amount < sprint.total_amount {
        return Err(error!(SprintVaultError::SprintNotEnded));
    }
    
    // Calculate remaining funds
    let remaining_funds = ctx.accounts.vault.amount;
    
    // If there are remaining funds, refund them to the employer
    if remaining_funds > 0 {
        // Create signer seeds for PDA
        let sprint_id_bytes = sprint.sprint_id.to_le_bytes();
        let seeds = &[
            b"sprint",
            sprint.employer.as_ref(),
            sprint_id_bytes.as_ref(),
            &[sprint.bump],
        ];
        let signer = &[&seeds[..]];
        
        // Transfer remaining tokens back to employer
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.employer_token_account.to_account_info(),
            authority: sprint.to_account_info(),
        };
        
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        
        token::transfer(cpi_ctx, remaining_funds)?;
        
        msg!(
            "Refunded {} tokens to employer from sprint {}",
            remaining_funds,
            sprint.sprint_id
        );
    }
    
    // Close the vault token account
    let close_accounts = CloseAccount {
        account: ctx.accounts.vault.to_account_info(),
        destination: ctx.accounts.employer.to_account_info(),
        authority: sprint.to_account_info(),
    };
    
    let sprint_id_bytes = sprint.sprint_id.to_le_bytes();
    let seeds = &[
        b"sprint",
        sprint.employer.as_ref(),
        sprint_id_bytes.as_ref(),
        &[sprint.bump],
    ];
    let signer = &[&seeds[..]];
    
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, close_accounts, signer);
    
    token::close_account(cpi_ctx)?;
    
    msg!(
        "Sprint {} closed successfully. Total withdrawn: {}, Total amount: {}",
        sprint.sprint_id,
        sprint.withdrawn_amount,
        sprint.total_amount
    );
    
    Ok(())
}
