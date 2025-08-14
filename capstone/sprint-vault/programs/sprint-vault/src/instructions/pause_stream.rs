use anchor_lang::prelude::*;
use crate::state::Sprint;
use crate::utils::get_current_time;
use crate::errors::SprintVaultError;
use crate::constants::MAX_PAUSE_RESUME_COUNT;

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
    let current_slot = Clock::get()?.slot;
    
    // Concurrency protection
    require!(
        sprint.last_operation_slot != current_slot,
        SprintVaultError::ConcurrentOperation
    );
    
    // Check if sprint is funded (only funded sprints can be paused)
    if !sprint.is_funded {
        return Err(error!(SprintVaultError::SprintNotFunded));
    }
    
    // Check if sprint should be auto-closed due to excessive pause duration
    if sprint.should_auto_close(current_time)? {
        return Err(error!(SprintVaultError::SprintAutoClosedDueToExcessivePause));
    }
    
    // Check pause/resume count limit
    if sprint.pause_resume_count >= MAX_PAUSE_RESUME_COUNT * 2 {
        msg!(
            "Sprint {} has reached maximum pause/resume limit of {} cycles",
            sprint.sprint_id,
            MAX_PAUSE_RESUME_COUNT
        );
        return Err(error!(SprintVaultError::MaxPauseResumeExceeded));
    }
    
    // Pause the sprint
    sprint.pause(current_time)?;
    
    // Increment pause/resume count
    sprint.pause_resume_count = sprint.pause_resume_count
        .checked_add(1)
        .ok_or(error!(SprintVaultError::MathOverflow))?;
    
    // Update last operation slot
    sprint.last_operation_slot = current_slot;
    
    msg!(
        "Sprint {} paused at timestamp {} (pause count: {})",
        sprint.sprint_id,
        current_time,
        sprint.pause_resume_count
    );
    
    Ok(())
}
