use anchor_lang::prelude::*;
use crate::strategies::{ExponentialStreamingStrategy, StreamingStrategy, StreamingContext, AccelerationType};

/// Sprint account structure that holds all sprint metadata
#[account]
pub struct Sprint {
    /// The employer who funds the sprint
    pub employer: Pubkey,
    /// The freelancer who receives payments
    pub freelancer: Pubkey,
    /// Unique identifier for this sprint
    pub sprint_id: u64,
    /// Unix timestamp when streaming starts
    pub start_time: i64,
    /// Unix timestamp when streaming ends
    pub end_time: i64,
    /// Total amount to be streamed
    pub total_amount: u64,
    /// Amount already withdrawn by freelancer
    pub withdrawn_amount: u64,
    /// Whether the sprint is currently paused
    pub is_paused: bool,
    /// Time when sprint was paused (if applicable)
    pub pause_time: Option<i64>,
    /// Total duration the sprint has been paused
    pub total_paused_duration: i64,
    /// The mint of the token being streamed
    pub mint: Pubkey,
    /// The vault token account holding the funds
    pub vault: Pubkey,
    /// The acceleration type for payment streaming (Linear, Quadratic, or Cubic)
    pub acceleration_type: AccelerationType,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl Sprint {
    pub const LEN: usize = 8 + // discriminator
        32 + // employer
        32 + // freelancer
        8 + // sprint_id
        8 + // start_time
        8 + // end_time
        8 + // total_amount
        8 + // withdrawn_amount
        1 + // is_paused
        1 + 8 + // pause_time (Option<i64>)
        8 + // total_paused_duration
        32 + // mint
        32 + // vault
        1 + // acceleration_type (enum as u8)
        1; // bump

    /// Calculate the amount earned up to the current time using the configured streaming strategy
    pub fn calculate_earned_amount(&self, current_time: i64) -> Result<u64> {
        match self.acceleration_type {
            AccelerationType::Linear => {
                // Use exponential strategy with linear factor (1.0)
                let strategy = ExponentialStreamingStrategy::new(AccelerationType::Linear);
                strategy.calculate_earned_amount(
                    self.total_amount,
                    self.start_time,
                    self.end_time,
                    current_time,
                    self.total_paused_duration,
                    self.is_paused,
                    self.pause_time,
                )
            },
            AccelerationType::Quadratic | AccelerationType::Cubic => {
                // Use exponential strategy with the specified acceleration
                let strategy = ExponentialStreamingStrategy::new(self.acceleration_type);
                strategy.calculate_earned_amount(
                    self.total_amount,
                    self.start_time,
                    self.end_time,
                    current_time,
                    self.total_paused_duration,
                    self.is_paused,
                    self.pause_time,
                )
            }
        }
    }

    /// Calculate the amount available for withdrawal using the configured streaming strategy
    pub fn calculate_withdrawable_amount(&self, current_time: i64) -> Result<u64> {
        let ctx = StreamingContext::new(
            self.total_amount,
            self.start_time,
            self.end_time,
            current_time,
            self.total_paused_duration,
            self.is_paused,
            self.pause_time,
            self.withdrawn_amount,
        );
        
        match self.acceleration_type {
            AccelerationType::Linear => {
                let strategy = ExponentialStreamingStrategy::new(AccelerationType::Linear);
                strategy.calculate_withdrawable_amount(&ctx)
            },
            AccelerationType::Quadratic | AccelerationType::Cubic => {
                let strategy = ExponentialStreamingStrategy::new(self.acceleration_type);
                strategy.calculate_withdrawable_amount(&ctx)
            }
        }
    }

    /// Check if the sprint has ended
    pub fn is_ended(&self, current_time: i64) -> bool {
        current_time >= self.end_time + self.total_paused_duration
    }

    /// Pause the sprint
    pub fn pause(&mut self, current_time: i64) -> Result<()> {
        if self.is_paused {
            return Err(error!(crate::errors::SprintVaultError::AlreadyPaused));
        }
        self.is_paused = true;
        self.pause_time = Some(current_time);
        Ok(())
    }

    /// Resume the sprint
    pub fn resume(&mut self, current_time: i64) -> Result<()> {
        if !self.is_paused {
            return Err(error!(crate::errors::SprintVaultError::NotPaused));
        }
        
        if let Some(pause_time) = self.pause_time {
            let pause_duration = current_time
                .checked_sub(pause_time)
                .ok_or(error!(crate::errors::SprintVaultError::MathOverflow))?;
            
            self.total_paused_duration = self.total_paused_duration
                .checked_add(pause_duration)
                .ok_or(error!(crate::errors::SprintVaultError::MathOverflow))?;
        }
        
        self.is_paused = false;
        self.pause_time = None;
        Ok(())
    }
}

/// Status of a sprint
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum SprintStatus {
    Active,
    Paused,
    Completed,
    Cancelled,
}
