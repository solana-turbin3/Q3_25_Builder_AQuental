use anchor_lang::prelude::*;
use crate::errors::BountyError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(milestone_id: u32)]
pub struct ClaimMilestone<'info> {
    #[account(
        mut,
        seeds = [b"bounty_pool", bounty_pool.employer.as_ref(), bounty_pool.bounty_id.to_le_bytes().as_ref()],
        bump = bounty_pool.bump
    )]
    pub bounty_pool: Account<'info, BountyPool>,
    
    #[account(
        init,
        payer = contributor,
        space = BountyClaim::LEN,
        seeds = [
            b"bounty_claim",
            bounty_pool.key().as_ref(),
            milestone_id.to_le_bytes().as_ref(),
            contributor.key().as_ref()
        ],
        bump
    )]
    pub bounty_claim: Account<'info, BountyClaim>,
    
    #[account(mut)]
    pub contributor: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimMilestone>, milestone_id: u32) -> Result<()> {
    let bounty_pool = &mut ctx.accounts.bounty_pool;
    let bounty_claim = &mut ctx.accounts.bounty_claim;
    let clock = Clock::get()?;
    
    // Validate bounty is active
    require!(
        bounty_pool.status == BountyStatus::Active || 
        bounty_pool.status == BountyStatus::InProgress,
        BountyError::BountyNotActive
    );
    
    // Check if bounty has expired
    if let Some(expires_at) = bounty_pool.expires_at {
        require!(
            clock.unix_timestamp < expires_at,
            BountyError::BountyExpired
        );
    }
    
    // Get the milestone
    let milestone = bounty_pool
        .get_milestone_mut(milestone_id)
        .ok_or(BountyError::MilestoneNotFound)?;
    
    // Validate milestone is open
    require!(
        milestone.status == MilestoneStatus::Open,
        BountyError::MilestoneNotOpen
    );
    
    // Check if milestone is already assigned
    require!(
        milestone.assigned_to.is_none(),
        BountyError::MilestoneAlreadyClaimed
    );
    
    // Assign milestone to contributor
    milestone.status = MilestoneStatus::Assigned;
    milestone.assigned_to = Some(ctx.accounts.contributor.key());
    
    // Initialize claim
    bounty_claim.bounty_pool = bounty_pool.key();
    bounty_claim.milestone_id = milestone_id;
    bounty_claim.contributor = ctx.accounts.contributor.key();
    bounty_claim.claimed_at = clock.unix_timestamp;
    bounty_claim.status = ClaimStatus::Active;
    bounty_claim.submission_url = None;
    bounty_claim.rejection_reason = None;
    bounty_claim.attempts = 0;
    bounty_claim.last_updated = clock.unix_timestamp;
    bounty_claim.bump = ctx.bumps.bounty_claim;
    
    // Update bounty pool statistics
    bounty_pool.total_claimed += 1;
    if bounty_pool.status == BountyStatus::Active {
        bounty_pool.status = BountyStatus::InProgress;
    }
    
    msg!("Milestone {} claimed by {}", milestone_id, ctx.accounts.contributor.key());
    
    Ok(())
}

