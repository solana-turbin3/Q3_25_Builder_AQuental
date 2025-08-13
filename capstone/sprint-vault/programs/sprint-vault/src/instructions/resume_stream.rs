use anchor_lang::prelude::*;
use crate::state::Sprint;
use crate::utils::get_current_time;

#[derive(Accounts)]
pub struct ResumeStream<'info> {
    #[account(
        mut,
        seeds = [b"sprint", employer.key().as_ref(), sprint.sprint_id.to_le_bytes().as_ref()],
        bump = sprint.bump,
        has_one = employer,
    )]
    pub sprint: Account<'info, Sprint>,
    
    #[account(mut)]
    pub employer: Signer<'info>,
}

pub fn handler(ctx: Context<ResumeStream>) -> Result<()> {
    let sprint = &mut ctx.accounts.sprint;
    let current_time = get_current_time()?;
    
    // Resume the sprint
    sprint.resume(current_time)?;
    
    msg!(
        "Sprint {} resumed at timestamp {}, total paused duration: {}",
        sprint.sprint_id,
        current_time,
        sprint.total_paused_duration
    );
    
    Ok(())
}
