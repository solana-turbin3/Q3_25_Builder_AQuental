use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::state::*;
use crate::errors::BountyError;

// Import Vault program types
use vault::cpi::accounts::ReleaseMilestone;
use vault::program::Vault;
use vault::state::EscrowVault;

#[derive(Accounts)]
#[instruction(milestone_id: u32)]
pub struct ApproveMilestone<'info> {
    #[account(
        mut,
        seeds = [b"bounty_pool", bounty_pool.employer.as_ref(), bounty_pool.bounty_id.to_le_bytes().as_ref()],
        bump = bounty_pool.bump
    )]
    pub bounty_pool: Account<'info, BountyPool>,
    
    #[account(
        mut,
        seeds = [b"bounty_vault_config", bounty_pool.key().as_ref()],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, BountyVaultConfig>,
    
    #[account(
        mut,
        constraint = vault_escrow.key() == vault_config.vault_escrow @ BountyError::VaultNotInitialized
    )]
    pub vault_escrow: Account<'info, EscrowVault>,
    
    #[account(
        mut,
        seeds = [
            b"bounty_claim",
            bounty_pool.key().as_ref(),
            milestone_id.to_le_bytes().as_ref(),
            contributor.key().as_ref()
        ],
        bump = bounty_claim.bump
    )]
    pub bounty_claim: Account<'info, BountyClaim>,
    
    #[account(
        constraint = employer.key() == bounty_pool.employer @ BountyError::Unauthorized
    )]
    pub employer: Signer<'info>,
    
    /// CHECK: Contributor account to receive payment
    pub contributor: UncheckedAccount<'info>,
    
    #[account(
        mut,
        constraint = contributor_token_account.owner == contributor.key(),
        constraint = contributor_token_account.mint == bounty_pool.token_mint
    )]
    pub contributor_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: Vault token account validated by Vault program
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,
    
    pub vault_program: Program<'info, Vault>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ApproveMilestone>, milestone_id: u32) -> Result<()> {
    let bounty_pool = &mut ctx.accounts.bounty_pool;
    let vault_config = &mut ctx.accounts.vault_config;
    let bounty_claim = &mut ctx.accounts.bounty_claim;
    let clock = Clock::get()?;
    
    // Validate claim is submitted
    require!(
        bounty_claim.can_approve(),
        BountyError::MilestoneNotSubmitted
    );
    
    // Get milestone data and validate
    let milestone_amount = {
        let milestone = bounty_pool
            .get_milestone_mut(milestone_id)
            .ok_or(BountyError::MilestoneNotFound)?;
        
        // Prevent double approval
        require!(
            milestone.status != MilestoneStatus::Approved && 
            milestone.status != MilestoneStatus::Paid,
            BountyError::MilestoneAlreadyApproved
        );
        
        // Verify Git criteria if required
        if milestone.git_criteria.is_required {
            require!(
                milestone.git_criteria.is_satisfied,
                BountyError::GitCriteriaNotMet
            );
        }
        
        // Update milestone status BEFORE CPI to prevent reentrancy
        milestone.status = MilestoneStatus::Approved;
        milestone.approved_at = Some(clock.unix_timestamp);
        
        // Save amount for later use
        milestone.amount
    };
    
    // Update claim status
    bounty_claim.status = ClaimStatus::Approved;
    bounty_claim.last_updated = clock.unix_timestamp;
    
    // Prepare signer seeds for CPI
    let bounty_id_bytes = bounty_pool.bounty_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"bounty_pool",
        bounty_pool.employer.as_ref(),
        &bounty_id_bytes,
        &[bounty_pool.bump],
    ]];
    
    // CPI to Vault program to release milestone funds
    let cpi_accounts = ReleaseMilestone {
        escrow_vault: ctx.accounts.vault_escrow.to_account_info(),
        authority: bounty_pool.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.vault_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    
    // Get the vault milestone ID for this milestone
    let vault_milestone_id = {
        let milestone = bounty_pool
            .get_milestone(milestone_id)
            .ok_or(BountyError::MilestoneNotFound)?;
        milestone.vault_milestone_id
    };
    
    vault::cpi::release_milestone(cpi_ctx, vault_milestone_id)?;
    
    // Update milestone to paid
    {
        let milestone = bounty_pool
            .get_milestone_mut(milestone_id)
            .ok_or(BountyError::MilestoneNotFound)?;
        milestone.status = MilestoneStatus::Paid;
    }
    
    // Update claim to paid
    bounty_claim.status = ClaimStatus::Paid;
    
    // Update pool statistics
    bounty_pool.total_completed += 1;
    bounty_pool.total_paid_out = bounty_pool.total_paid_out
        .checked_add(milestone_amount)
        .ok_or(BountyError::ArithmeticOverflow)?;
    
    // Update vault config
    vault_config.total_withdrawn = vault_config.total_withdrawn
        .checked_add(milestone_amount)
        .ok_or(BountyError::ArithmeticOverflow)?;
    
    // Check if all milestones are completed
    let all_completed = bounty_pool.milestones
        .iter()
        .all(|m| m.status == MilestoneStatus::Paid);
    
    if all_completed {
        bounty_pool.status = BountyStatus::Completed;
        msg!("All milestones completed! Bounty is now complete.");
    } else {
        bounty_pool.status = BountyStatus::InProgress;
    }
    
    msg!(
        "Milestone {} approved and paid {} tokens to {}", 
        milestone_id,
        milestone_amount,
        ctx.accounts.contributor.key()
    );
    
    Ok(())
}
