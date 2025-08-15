use anchor_lang::prelude::*;
use crate::errors::BountyError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(milestone_id: u32)]
pub struct SubmitMilestone<'info> {
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
            contributor.key().as_ref()
        ],
        bump = bounty_claim.bump,
        constraint = bounty_claim.contributor == contributor.key() @ BountyError::Unauthorized,
        constraint = bounty_claim.milestone_id == milestone_id @ BountyError::MilestoneNotFound
    )]
    pub bounty_claim: Account<'info, BountyClaim>,
    
    pub contributor: Signer<'info>,
}

pub fn handler(
    ctx: Context<SubmitMilestone>, 
    milestone_id: u32,
    evidence_url: String,
    git_reference: String,
) -> Result<()> {
    let bounty_pool = &mut ctx.accounts.bounty_pool;
    let bounty_claim = &mut ctx.accounts.bounty_claim;
    let clock = Clock::get()?;
    
    // Validate claim can be submitted
    require!(
        bounty_claim.can_submit(),
        BountyError::InvalidClaimStatus
    );
    
    // Validate evidence URL (basic check for IPFS/Arweave)
    require!(
        evidence_url.starts_with("ipfs://") || 
        evidence_url.starts_with("ar://") ||
        evidence_url.starts_with("https://"),
        BountyError::InvalidEvidenceUrl
    );
    
    require!(
        evidence_url.len() <= BountyMilestone::MAX_EVIDENCE_URL_LEN,
        BountyError::EvidenceUrlTooLong
    );
    
    // Get the milestone
    let milestone = bounty_pool
        .get_milestone_mut(milestone_id)
        .ok_or(BountyError::MilestoneNotFound)?;
    
    // Update milestone status
    milestone.status = MilestoneStatus::Submitted;
    milestone.submitted_at = Some(clock.unix_timestamp);
    milestone.evidence_url = Some(evidence_url.clone());
    
    // Update Git reference if provided
    if !git_reference.is_empty() {
        milestone.git_criteria.reference_id = git_reference;
    }
    
    // Update claim
    bounty_claim.status = ClaimStatus::Submitted;
    bounty_claim.submission_url = Some(evidence_url);
    bounty_claim.attempts += 1;
    bounty_claim.last_updated = clock.unix_timestamp;
    
    // Update bounty status if needed
    if bounty_pool.status == BountyStatus::InProgress {
        bounty_pool.status = BountyStatus::UnderReview;
    }
    
    msg!(
        "Milestone {} submitted by {} (attempt #{})", 
        milestone_id, 
        ctx.accounts.contributor.key(),
        bounty_claim.attempts
    );
    
    Ok(())
}

