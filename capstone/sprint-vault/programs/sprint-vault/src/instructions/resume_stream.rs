use anchor_lang::prelude::*;
use crate::state::Sprint;
use crate::utils::get_current_time;
use crate::errors::SprintVaultError;
use crate::constants::MAX_PAUSE_RESUME_COUNT;

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
    let current_slot = Clock::get()?.slot;
    
    // Concurrency protection
    require!(
        sprint.last_operation_slot != current_slot,
        SprintVaultError::ConcurrentOperation
    );
    
    // Check if sprint is funded (only funded sprints can be resumed)
    if !sprint.is_funded {
        return Err(error!(SprintVaultError::SprintNotFunded));
    }
    
    // Check if sprint should be auto-closed due to excessive pause duration
    if sprint.should_auto_close(current_time)? {
        msg!(
            "Sprint {} auto-closed: pause duration exceeded sprint duration",
            sprint.sprint_id
        );
        return Err(error!(SprintVaultError::SprintAutoClosedDueToExcessivePause));
    }
    
    // Check pause/resume count limit (resume increments count too)
    if sprint.pause_resume_count >= MAX_PAUSE_RESUME_COUNT * 2 {
        msg!(
            "Sprint {} has reached maximum pause/resume limit of {} cycles",
            sprint.sprint_id,
            MAX_PAUSE_RESUME_COUNT
        );
        return Err(error!(SprintVaultError::MaxPauseResumeExceeded));
    }
    
    // Resume the sprint
    sprint.resume(current_time)?;
    
    // Increment pause/resume count
    sprint.pause_resume_count = sprint.pause_resume_count
        .checked_add(1)
        .ok_or(error!(SprintVaultError::MathOverflow))?;
    
    // Update last operation slot
    sprint.last_operation_slot = current_slot;
    
    msg!(
        "Sprint {} resumed at timestamp {}, total paused duration: {} (resume count: {})",
        sprint.sprint_id,
        current_time,
        sprint.total_paused_duration,
        sprint.pause_resume_count
    );
    
    Ok(())
}
