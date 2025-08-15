use anchor_lang::prelude::*;
use crate::errors::BountyError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(milestone_id: u32)]
pub struct RejectMilestone<'info> {
    #[account(
        mut,
        seeds = [b"bounty_pool", bounty_pool.employer.as_ref(), bounty_pool.bounty_id.to_le_bytes().as_ref()],
        bump = bounty_pool.bump
    )]
    pub bounty_pool: Account<'info, BountyPool>,
    
    #[account(
        mut,
        seeds = [
            b"bounty_claim",
            bounty_pool.key().as_ref(),
            milestone_id.to_le_bytes().as_ref(),
            bounty_claim.contributor.as_ref()
        ],
        bump = bounty_claim.bump,
        constraint = bounty_claim.milestone_id == milestone_id @ BountyError::MilestoneNotFound
    )]
    pub bounty_claim: Account<'info, BountyClaim>,
    
    #[account(
        constraint = employer.key() == bounty_pool.employer @ BountyError::Unauthorized
    )]
    pub employer: Signer<'info>,
}

pub fn handler(
    ctx: Context<RejectMilestone>,
    milestone_id: u32,
    reason: String,
) -> Result<()> {
    let bounty_pool = &mut ctx.accounts.bounty_pool;
    let bounty_claim = &mut ctx.accounts.bounty_claim;
    let clock = Clock::get()?;
    
    // Validate claim is submitted
    require!(
        bounty_claim.status == ClaimStatus::Submitted,
        BountyError::InvalidMilestoneStatus
    );
    
    // Validate reason length
    require!(
        reason.len() <= BountyClaim::MAX_REJECTION_REASON_LEN,
        BountyError::ReasonTooLong
    );
    
    // Get the milestone
    let milestone = bounty_pool
        .get_milestone_mut(milestone_id)
        .ok_or(BountyError::MilestoneNotFound)?;
    
    // Update milestone status to open (can be reclaimed)
    milestone.status = MilestoneStatus::Open;
    milestone.assigned_to = None;
    
    // Update claim
    bounty_claim.status = ClaimStatus::Rejected;
    bounty_claim.rejection_reason = Some(reason.clone());
    bounty_claim.last_updated = clock.unix_timestamp;
    
    // Update bounty status
    bounty_pool.status = BountyStatus::InProgress;
    
    msg!(
        "Milestone {} rejected. Reason: {}", 
        milestone_id,
        reason
    );
    
    Ok(())
}

