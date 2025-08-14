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
    
    // Concurrency protection: Check for same-slot operations
    let current_slot = Clock::get()?.slot;
    require!(
        sprint.last_operation_slot != current_slot,
        SprintVaultError::ConcurrentOperation
    );
    
    // Validate token account is not frozen
    validate_token_account_not_frozen(&ctx.accounts.freelancer_token_account)?;
    validate_token_account_not_frozen(&ctx.accounts.vault)?;
    
    // Check if sprint is funded
    if !sprint.is_funded {
        return Err(error!(SprintVaultError::SprintNotFunded));
    }
    
    // Check if sprint is paused
    if sprint.is_paused {
        return Err(error!(SprintVaultError::SprintPaused));
    }
    
    // Get current time and validate it
    let current_time = get_current_time()?;
    
    // Validate timestamp is reasonable (prevent clock drift attacks)
    require!(
        current_time >= sprint.start_time - 3600 && // Allow 1 hour before start
        current_time <= sprint.end_time + sprint.total_paused_duration + 86400, // Allow 1 day after end
        SprintVaultError::InvalidTimestamp
    );
    
    // Check if sprint has started
    if current_time < sprint.start_time {
        return Err(error!(SprintVaultError::SprintNotStarted));
    }
    
    // Calculate withdrawable amount
    let mut withdrawable = sprint.calculate_withdrawable_amount(current_time)?;
    
    // Apply precision rounding to prevent accumulation of rounding errors
    withdrawable = round_amount_for_precision(withdrawable, ctx.accounts.mint.decimals);
    
    // Handle accumulated dust on final withdrawal
    if sprint.is_final_withdrawal(current_time)? && sprint.accumulated_dust > 0 {
        withdrawable = withdrawable
            .checked_add(sprint.accumulated_dust)
            .ok_or(error!(SprintVaultError::MathOverflow))?;
    }
    
    // Check if there are funds to withdraw
    if withdrawable == 0 {
        return Err(error!(SprintVaultError::NoFundsAvailable));
    }
    
    // Check minimum withdrawal amount with special cases
    let min_withdrawal = get_min_withdrawal_amount(&sprint.mint);
    
    // Special case 1: If sprint's total amount is less than minimum, allow withdrawal at the end
    let is_small_sprint = sprint.total_amount < min_withdrawal;
    
    // Special case 2: This is the final withdrawal (all remaining funds)
    let is_final_withdrawal = sprint.is_final_withdrawal(current_time)?;
    
    // Special case 3: Check if sprint should be auto-closed due to excessive pause
    if sprint.should_auto_close(current_time)? {
        msg!(
            "Sprint {} should be auto-closed due to excessive pause duration",
            sprint.sprint_id
        );
        // Allow withdrawal of all available funds when auto-closing
    } else if !is_small_sprint && !is_final_withdrawal && withdrawable < min_withdrawal {
        // Regular minimum withdrawal check applies only if:
        // - Sprint total is >= minimum amount
        // - This is not the final withdrawal
        // - Sprint is not being auto-closed
        msg!(
            "Available amount {} is below minimum withdrawal threshold {}. Will be available at sprint end.",
            withdrawable,
            min_withdrawal
        );
        return Err(error!(SprintVaultError::BelowMinimumWithdrawal));
    }
    
    // For small sprints or final withdrawals, allow any amount
    if is_small_sprint && !sprint.is_ended(current_time) {
        msg!(
            "Sprint total {} is below minimum. Funds will be available at sprint end.",
            sprint.total_amount
        );
        // Still check if sprint has ended for small sprints
        if !sprint.is_ended(current_time) {
            return Err(error!(SprintVaultError::BelowMinimumWithdrawal));
        }
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
    
    // Update last operation slot for concurrency protection
    sprint.last_operation_slot = current_slot;
    
    // Track any dust from rounding (difference between calculated and actual)
    let calculated_earned = sprint.calculate_earned_amount(current_time)?;
    if calculated_earned > sprint.withdrawn_amount {
        let potential_dust = calculated_earned - sprint.withdrawn_amount;
        if is_dust_amount(potential_dust, ctx.accounts.mint.decimals) {
            sprint.accumulated_dust = sprint.accumulated_dust
                .saturating_add(potential_dust);
        }
    }
    
    msg!(
        "Withdrew {} tokens from sprint {}, total withdrawn: {}",
        withdrawable,
        sprint.sprint_id,
        sprint.withdrawn_amount
    );
    
    Ok(())
}
