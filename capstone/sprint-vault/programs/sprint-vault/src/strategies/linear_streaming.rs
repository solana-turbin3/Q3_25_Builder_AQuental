use anchor_lang::prelude::*;
use crate::errors::SprintVaultError;
use super::streaming_strategy::{StreamingStrategy, StreamingContext};

/// Linear streaming strategy that releases funds proportionally over time
pub struct LinearStreamingStrategy;

impl LinearStreamingStrategy {
    /// Create a new linear streaming strategy
    pub fn new() -> Self {
        Self
    }
}

impl StreamingStrategy for LinearStreamingStrategy {
    /// Calculate earned amount using linear interpolation formula:
    /// earned = (total_amount × elapsed_time) ÷ total_duration
    fn calculate_earned_amount(
        &self,
        total_amount: u64,
        start_time: i64,
        end_time: i64,
        current_time: i64,
        total_paused_duration: i64,
        is_paused: bool,
        pause_time: Option<i64>,
    ) -> Result<u64> {
        // If sprint hasn't started yet
        if current_time < start_time {
            return Ok(0);
        }

        // Adjust for paused time
        let effective_current_time = if is_paused {
            // If currently paused, use pause time
            pause_time.unwrap_or(current_time)
        } else {
            current_time
        };

        // Calculate effective duration considering pauses
        let effective_start = start_time;
        let effective_end = end_time + total_paused_duration;
        
        // If we're past the end time, return the total amount
        if effective_current_time >= effective_end {
            return Ok(total_amount);
        }

        // Calculate elapsed time (excluding paused duration)
        let elapsed = effective_current_time
            .checked_sub(effective_start)
            .ok_or(error!(SprintVaultError::MathOverflow))?
            .checked_sub(total_paused_duration)
            .ok_or(error!(SprintVaultError::MathOverflow))?;

        // Calculate total duration
        let total_duration = end_time
            .checked_sub(start_time)
            .ok_or(error!(SprintVaultError::MathOverflow))?;

        // Prevent division by zero
        if total_duration == 0 {
            return Ok(total_amount);
        }

        // LINEAR INTERPOLATION FORMULA
        // Use u128 to prevent overflow during multiplication
        let earned = (total_amount as u128)
            .checked_mul(elapsed as u128)
            .ok_or(error!(SprintVaultError::MathOverflow))?
            .checked_div(total_duration as u128)
            .ok_or(error!(SprintVaultError::MathOverflow))?;

        // Ensure we don't exceed total amount
        Ok(earned.min(total_amount as u128) as u64)
    }

    /// Calculate the release rate (tokens per second)
    fn calculate_release_rate(
        &self,
        total_amount: u64,
        start_time: i64,
        end_time: i64,
    ) -> Result<u64> {
        let duration = end_time
            .checked_sub(start_time)
            .ok_or(error!(SprintVaultError::MathOverflow))?;
        
        if duration == 0 {
            return Err(error!(SprintVaultError::InvalidTimeRange));
        }
        
        let rate = total_amount
            .checked_div(duration as u64)
            .ok_or(error!(SprintVaultError::MathOverflow))?;
        
        Ok(rate)
    }

    fn description(&self) -> &str {
        "Linear streaming: Funds are released proportionally over time"
    }
}

/// Helper function to calculate withdrawable amount using a streaming context
impl LinearStreamingStrategy {
    pub fn calculate_withdrawable_amount(&self, ctx: &StreamingContext) -> Result<u64> {
        let earned = self.calculate_earned_amount(
            ctx.total_amount,
            ctx.start_time,
            ctx.end_time,
            ctx.current_time,
            ctx.total_paused_duration,
            ctx.is_paused,
            ctx.pause_time,
        )?;
        
        earned
            .checked_sub(ctx.withdrawn_amount)
            .ok_or_else(|| error!(SprintVaultError::MathOverflow))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_interpolation() {
        let strategy = LinearStreamingStrategy::new();
        
        // Test case: 1000 tokens over 100 seconds
        let total_amount = 1000u64;
        let start_time = 0i64;
        let end_time = 100i64;
        
        // At 50% of time, should have 50% of tokens
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            50, // current_time
            0,  // total_paused_duration
            false, // is_paused
            None,  // pause_time
        ).unwrap();
        
        assert_eq!(earned, 500);
        
        // At 25% of time, should have 25% of tokens
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            25, // current_time
            0,  // total_paused_duration
            false, // is_paused
            None,  // pause_time
        ).unwrap();
        
        assert_eq!(earned, 250);
    }

    #[test]
    fn test_with_pause() {
        let strategy = LinearStreamingStrategy::new();
        
        // Test case: 1000 tokens over 100 seconds with 10 second pause
        let total_amount = 1000u64;
        let start_time = 0i64;
        let end_time = 100i64;
        
        // At 60 seconds with 10 seconds paused
        // Effective elapsed time = 60 - 10 = 50 seconds
        // Should have 50% of tokens
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            60, // current_time
            10, // total_paused_duration
            false, // is_paused
            None,  // pause_time
        ).unwrap();
        
        assert_eq!(earned, 500);
    }
}
