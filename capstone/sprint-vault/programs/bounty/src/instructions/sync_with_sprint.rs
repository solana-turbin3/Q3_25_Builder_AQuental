use anchor_lang::prelude::*;
use crate::errors::BountyError;
use crate::state::*;

#[derive(Accounts)]
pub struct SyncWithSprint<'info> {
    #[account(
        mut,
        seeds = [b"bounty_pool", bounty_pool.employer.as_ref(), bounty_pool.bounty_id.to_le_bytes().as_ref()],
        bump = bounty_pool.bump
    )]
    pub bounty_pool: Account<'info, BountyPool>,
    
    #[account(
        constraint = employer.key() == bounty_pool.employer @ BountyError::Unauthorized
    )]
    pub employer: Signer<'info>,
    
    /// CHECK: Sprint account from SprintVault program
    pub sprint: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<SyncWithSprint>) -> Result<()> {
    let bounty_pool = &mut ctx.accounts.bounty_pool;
    
    // Validate bounty has associated sprint
    require!(
        bounty_pool.associated_sprint.is_some(),
        BountyError::InvalidSprintAssociation
    );
    
    // TODO: Implement CPI to SprintVault to query sprint status
    // For now, just log the sync attempt
    
    msg!(
        "Syncing bounty {} with sprint {:?}", 
        bounty_pool.bounty_id,
        bounty_pool.associated_sprint
    );
    
    Ok(())
}
