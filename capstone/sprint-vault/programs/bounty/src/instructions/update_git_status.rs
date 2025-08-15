use anchor_lang::prelude::*;
use crate::errors::BountyError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(milestone_id: u32)]
pub struct UpdateGitStatus<'info> {
    #[account(
        mut,
        seeds = [b"bounty_pool", bounty_pool.employer.as_ref(), bounty_pool.bounty_id.to_le_bytes().as_ref()],
        bump = bounty_pool.bump
    )]
    pub bounty_pool: Account<'info, BountyPool>,
    
    /// CHECK: External service account (needs signature verification in production)
    pub external_service: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateGitStatus>,
    milestone_id: u32,
    git_satisfied: bool,
) -> Result<()> {
    let bounty_pool = &mut ctx.accounts.bounty_pool;
    
    // Get the milestone
    let milestone = bounty_pool
        .get_milestone_mut(milestone_id)
        .ok_or(BountyError::MilestoneNotFound)?;
    
    // Update Git criteria status
    milestone.git_criteria.is_satisfied = git_satisfied;
    
    msg!(
        "Git status for milestone {} updated to: {}", 
        milestone_id,
        git_satisfied
    );
    
    Ok(())
}
