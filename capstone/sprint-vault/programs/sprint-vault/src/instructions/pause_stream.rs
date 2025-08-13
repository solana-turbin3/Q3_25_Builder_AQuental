use anchor_lang::prelude::*;
use crate::state::Sprint;
use crate::utils::get_current_time;

#[derive(Accounts)]
pub struct PauseStream<'info> {
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

pub fn handler(ctx: Context<PauseStream>) -> Result<()> {
    let sprint = &mut ctx.accounts.sprint;
    let current_time = get_current_time()?;
    
    // Pause the sprint
    sprint.pause(current_time)?;
    
    msg!(
        "Sprint {} paused at timestamp {}",
        sprint.sprint_id,
        current_time
    );
    
    Ok(())
}
