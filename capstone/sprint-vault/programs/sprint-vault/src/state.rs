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
    /// Number of times the sprint has been paused/resumed
    pub pause_resume_count: u8,
    /// Last operation timestamp for concurrency protection
    pub last_operation_slot: u64,
    /// Accumulated dust amount from rounding
    pub accumulated_dust: u64,
    /// The mint of the token being streamed
    pub mint: Pubkey,
    /// The vault token account holding the funds
    pub vault: Pubkey,
    /// The acceleration type for payment streaming (Linear, Quadratic, or Cubic)
    pub acceleration_type: AccelerationType,
    /// Bump seed for PDA derivation
    pub bump: u8,
    /// Whether the sprint has been fully funded
    pub is_funded: bool,
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
        1 + // pause_resume_count
        8 + // last_operation_slot
        8 + // accumulated_dust
        32 + // mint
        32 + // vault
        1 + // acceleration_type (enum as u8)
        1 + // bump
        1; // is_funded

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
    
    /// Get the sprint duration
    pub fn get_sprint_duration(&self) -> Result<i64> {
        self.end_time
            .checked_sub(self.start_time)
            .ok_or(error!(crate::errors::SprintVaultError::MathOverflow))
    }
    
    /// Check if the sprint should be auto-closed due to excessive pause duration
    pub fn should_auto_close(&self, current_time: i64) -> Result<bool> {
        if !self.is_paused {
            return Ok(false);
        }
        
        if let Some(pause_time) = self.pause_time {
            let current_pause_duration = current_time
                .checked_sub(pause_time)
                .ok_or(error!(crate::errors::SprintVaultError::MathOverflow))?;
            
            let sprint_duration = self.get_sprint_duration()?;
            
            // Auto-close if current pause is longer than sprint duration
            if current_pause_duration > sprint_duration {
                return Ok(true);
            }
        }
        
        Ok(false)
    }
    
    /// Check if there are any remaining funds to withdraw
    pub fn has_remaining_funds(&self) -> bool {
        self.withdrawn_amount < self.total_amount
    }
    
    /// Check if this is the final withdrawal (all remaining funds)
    pub fn is_final_withdrawal(&self, current_time: i64) -> Result<bool> {
        let earned = self.calculate_earned_amount(current_time)?;
        Ok(earned >= self.total_amount)
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

/// Predefined sprint duration options
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq)]
pub enum SprintDuration {
    OneWeek,        // 1 week (7 days)
    TwoWeeks,       // 2 weeks (14 days) - typical agile sprint
    ThreeWeeks,     // 3 weeks (21 days)
    FourWeeks,      // 4 weeks (28 days) - approximately 1 month
    SixWeeks,       // 6 weeks (42 days)
    EightWeeks,     // 8 weeks (56 days) - approximately 2 months
    TenWeeks,       // 10 weeks (70 days)
    TwelveWeeks,    // 12 weeks (84 days) - approximately 3 months
}

impl SprintDuration {
    /// Convert duration enum to seconds
    pub fn to_seconds(&self) -> i64 {
        const WEEK_IN_SECONDS: i64 = 7 * 24 * 60 * 60; // 604,800 seconds
        
        match self {
            SprintDuration::OneWeek => WEEK_IN_SECONDS,
            SprintDuration::TwoWeeks => 2 * WEEK_IN_SECONDS,
            SprintDuration::ThreeWeeks => 3 * WEEK_IN_SECONDS,
            SprintDuration::FourWeeks => 4 * WEEK_IN_SECONDS,
            SprintDuration::SixWeeks => 6 * WEEK_IN_SECONDS,
            SprintDuration::EightWeeks => 8 * WEEK_IN_SECONDS,
            SprintDuration::TenWeeks => 10 * WEEK_IN_SECONDS,
            SprintDuration::TwelveWeeks => 12 * WEEK_IN_SECONDS,
        }
    }
    
    /// Get human-readable description
    pub fn description(&self) -> &'static str {
        match self {
            SprintDuration::OneWeek => "1 week",
            SprintDuration::TwoWeeks => "2 weeks",
            SprintDuration::ThreeWeeks => "3 weeks",
            SprintDuration::FourWeeks => "4 weeks (1 month)",
            SprintDuration::SixWeeks => "6 weeks",
            SprintDuration::EightWeeks => "8 weeks (2 months)",
            SprintDuration::TenWeeks => "10 weeks",
            SprintDuration::TwelveWeeks => "12 weeks (3 months)",
        }
    }
    
    /// Get duration in days
    pub fn to_days(&self) -> u32 {
        match self {
            SprintDuration::OneWeek => 7,
            SprintDuration::TwoWeeks => 14,
            SprintDuration::ThreeWeeks => 21,
            SprintDuration::FourWeeks => 28,
            SprintDuration::SixWeeks => 42,
            SprintDuration::EightWeeks => 56,
            SprintDuration::TenWeeks => 70,
            SprintDuration::TwelveWeeks => 84,
        }
    }
    
    /// Validate if a given duration in seconds matches any valid sprint duration
    pub fn from_seconds(seconds: i64) -> Option<Self> {
        const WEEK: i64 = 7 * 24 * 60 * 60;
        match seconds {
            s if s == WEEK => Some(SprintDuration::OneWeek),
            s if s == 2 * WEEK => Some(SprintDuration::TwoWeeks),
            s if s == 3 * WEEK => Some(SprintDuration::ThreeWeeks),
            s if s == 4 * WEEK => Some(SprintDuration::FourWeeks),
            s if s == 6 * WEEK => Some(SprintDuration::SixWeeks),
            s if s == 8 * WEEK => Some(SprintDuration::EightWeeks),
            s if s == 10 * WEEK => Some(SprintDuration::TenWeeks),
            s if s == 12 * WEEK => Some(SprintDuration::TwelveWeeks),
            _ => None,
        }
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
