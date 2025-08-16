use anchor_lang::prelude::*;

mod constants;
mod errors;
mod instructions;
mod state;
mod strategies;
mod utils;

use instructions::*;
use state::SprintDuration;
use strategies::AccelerationType;

declare_id!("9hP7zfPfFqF6YH97yVpVV57PUmRkbxJ8eUwZf1rrHP23");

#[program]
pub mod sprint_vault {
    use super::*;

    /// Creates a new sprint with specified parameters
    /// @param sprint_duration - Predefined sprint duration (1-12 weeks)
    /// @param acceleration_type - Optional payment acceleration (defaults to Quadratic)
    pub fn create_sprint(
        ctx: Context<CreateSprint>,
        sprint_id: u64,
        start_time: i64,
        sprint_duration: SprintDuration,
        total_amount: u64,
        acceleration_type: Option<AccelerationType>,
    ) -> Result<()> {
        instructions::create_sprint::handler(ctx, sprint_id, start_time, sprint_duration, total_amount, acceleration_type)
    }

    /// Deposits funds into the sprint vault
    pub fn deposit_to_escrow(ctx: Context<DepositToEscrow>, amount: u64) -> Result<()> {
        instructions::deposit_to_escrow::handler(ctx, amount)
    }

    /// Withdraws earned funds based on elapsed time
    pub fn withdraw_streamed(ctx: Context<WithdrawStreamed>) -> Result<()> {
        instructions::withdraw_streamed::handler(ctx)
    }

    /// Pauses the payment stream (for disputes)
    pub fn pause_stream(ctx: Context<PauseStream>) -> Result<()> {
        instructions::pause_stream::handler(ctx)
    }

    /// Resumes a paused payment stream
    pub fn resume_stream(ctx: Context<ResumeStream>) -> Result<()> {
        instructions::resume_stream::handler(ctx)
    }

    /// Closes a completed or cancelled sprint
    pub fn close_sprint(ctx: Context<CloseSprint>) -> Result<()> {
        instructions::close_sprint::handler(ctx)
    }
}
