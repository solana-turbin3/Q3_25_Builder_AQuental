use anchor_lang::prelude::*;
use crate::errors::SprintVaultError;
use super::streaming_strategy::{StreamingStrategy, StreamingContext, AccelerationType};

/// Exponential streaming strategy that accelerates payment distribution over time
/// The formula uses an exponential curve to determine the earned amount
pub struct ExponentialStreamingStrategy {
    /// The acceleration type determining the curve steepness
    acceleration_type: AccelerationType,
}

impl ExponentialStreamingStrategy {
    /// Create a new exponential streaming strategy with a specific acceleration type
    /// 
    /// # Arguments
    /// * `acceleration_type` - The type of acceleration curve to use
    pub fn new(acceleration_type: AccelerationType) -> Self {
        Self {
            acceleration_type,
        }
    }

    /// Create a strategy with a custom acceleration factor
    /// 
    /// # Arguments
    /// * `factor` - Custom acceleration factor (will be clamped to nearest type)
    pub fn with_factor(factor: f64) -> Self {
        let acceleration_type = if factor <= 1.5 {
            AccelerationType::Linear
        } else if factor <= 2.5 {
            AccelerationType::Quadratic
        } else {
            AccelerationType::Cubic
        };
        Self::new(acceleration_type)
    }

    /// Default exponential strategy with quadratic acceleration
    pub fn default() -> Self {
        Self::new(AccelerationType::Quadratic)
    }
    
    /// Get the acceleration factor as a float
    fn get_factor(&self) -> f64 {
        self.acceleration_type.to_factor()
    }
}

impl StreamingStrategy for ExponentialStreamingStrategy {
    /// Calculate earned amount using exponential interpolation formula:
    /// earned = total_amount × (elapsed_time / total_duration)^acceleration_factor
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

        // EXPONENTIAL INTERPOLATION FORMULA
        // Calculate the time ratio (0.0 to 1.0)
        let time_ratio = elapsed as f64 / total_duration as f64;
        
        // Apply exponential curve
        // For acceleration_factor = 2.0, this creates a quadratic curve
        // For acceleration_factor = 3.0, this creates a cubic curve
        let exponential_ratio = time_ratio.powf(self.get_factor());
        
        // Calculate earned amount
        let earned = (total_amount as f64 * exponential_ratio) as u64;

        // Ensure we don't exceed total amount due to floating point precision
        Ok(earned.min(total_amount))
    }

    /// Calculate the instantaneous release rate at a given point in time
    /// For exponential: rate = (acceleration_factor × total_amount × t^(factor-1)) / duration^factor
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
        
        // For exponential, the average rate changes over time
        // This returns the average rate over the entire period
        let avg_rate = total_amount
            .checked_div(duration as u64)
            .ok_or(error!(SprintVaultError::MathOverflow))?;
        
        // Adjust for acceleration factor (approximation)
        let adjusted_rate = (avg_rate as f64 * self.get_factor()) as u64;
        
        Ok(adjusted_rate)
    }

    fn description(&self) -> &str {
        "Exponential streaming: Funds are released with accelerating rate over time"
    }
}

/// Helper function to calculate withdrawable amount using a streaming context
impl ExponentialStreamingStrategy {
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
    use crate::strategies::LinearStreamingStrategy;

    #[test]
    fn test_exponential_interpolation_quadratic() {
        let strategy = ExponentialStreamingStrategy::new(AccelerationType::Quadratic);
        
        // Test case: 1000 tokens over 100 seconds with quadratic acceleration
        let total_amount = 1000u64;
        let start_time = 0i64;
        let end_time = 100i64;
        
        // At 50% of time with quadratic (^2), should have 25% of tokens
        // (0.5)^2 = 0.25
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            50, // current_time
            0,  // total_paused_duration
            false, // is_paused
            None,  // pause_time
        ).unwrap();
        
        assert_eq!(earned, 250);
        
        // At 70% of time with quadratic, should have 49% of tokens
        // (0.7)^2 = 0.49 (may be 489 due to floating point precision)
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            70, // current_time
            0,  // total_paused_duration
            false, // is_paused
            None,  // pause_time
        ).unwrap();
        
        // Allow for minor rounding differences
        assert!(earned == 489 || earned == 490);
    }

    #[test]
    fn test_exponential_interpolation_cubic() {
        let strategy = ExponentialStreamingStrategy::new(AccelerationType::Cubic);
        
        // Test case: 1000 tokens over 100 seconds with cubic acceleration
        let total_amount = 1000u64;
        let start_time = 0i64;
        let end_time = 100i64;
        
        // At 50% of time with cubic (^3), should have 12.5% of tokens
        // (0.5)^3 = 0.125
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            50, // current_time
            0,  // total_paused_duration
            false, // is_paused
            None,  // pause_time
        ).unwrap();
        
        assert_eq!(earned, 125);
        
        // At 80% of time with cubic, should have 51.2% of tokens
        // (0.8)^3 = 0.512
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            80, // current_time
            0,  // total_paused_duration
            false, // is_paused
            None,  // pause_time
        ).unwrap();
        
        assert_eq!(earned, 512);
    }

    #[test]
    fn test_exponential_with_pause() {
        let strategy = ExponentialStreamingStrategy::new(AccelerationType::Quadratic);
        
        // Test case: 1000 tokens over 100 seconds with 10 second pause
        let total_amount = 1000u64;
        let start_time = 0i64;
        let end_time = 100i64;
        
        // At 60 seconds with 10 seconds paused
        // Effective elapsed time = 60 - 10 = 50 seconds
        // With quadratic: (50/100)^2 = 0.25
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            60, // current_time
            10, // total_paused_duration
            false, // is_paused
            None,  // pause_time
        ).unwrap();
        
        assert_eq!(earned, 250);
    }

    #[test]
    fn test_exponential_vs_linear() {
        let linear = LinearStreamingStrategy::new();
        let exponential = ExponentialStreamingStrategy::new(AccelerationType::Quadratic);
        
        let total_amount = 1000u64;
        let start_time = 0i64;
        let end_time = 100i64;
        
        // Early in the sprint (25% time)
        let linear_earned_early = linear.calculate_earned_amount(
            total_amount, start_time, end_time, 25, 0, false, None
        ).unwrap();
        let exponential_earned_early = exponential.calculate_earned_amount(
            total_amount, start_time, end_time, 25, 0, false, None
        ).unwrap();
        
        // Linear: 25% of tokens = 250
        // Exponential: (0.25)^2 = 6.25% of tokens = 62
        assert_eq!(linear_earned_early, 250);
        assert_eq!(exponential_earned_early, 62);
        
        // Late in the sprint (75% time)
        let linear_earned_late = linear.calculate_earned_amount(
            total_amount, start_time, end_time, 75, 0, false, None
        ).unwrap();
        let exponential_earned_late = exponential.calculate_earned_amount(
            total_amount, start_time, end_time, 75, 0, false, None
        ).unwrap();
        
        // Linear: 75% of tokens = 750
        // Exponential: (0.75)^2 = 56.25% of tokens = 562
        assert_eq!(linear_earned_late, 750);
        assert_eq!(exponential_earned_late, 562);
        
        // Exponential pays less early, but accelerates later
        assert!(exponential_earned_early < linear_earned_early);
        assert!(exponential_earned_late < linear_earned_late);
    }

    #[test]
    fn test_acceleration_type_enum() {
        // Test that each acceleration type produces the expected results
        let linear_strategy = ExponentialStreamingStrategy::new(AccelerationType::Linear);
        let quadratic_strategy = ExponentialStreamingStrategy::new(AccelerationType::Quadratic);
        let cubic_strategy = ExponentialStreamingStrategy::new(AccelerationType::Cubic);
        
        let total_amount = 1000u64;
        let start_time = 0i64;
        let end_time = 100i64;
        let current_time = 50i64; // 50% of time
        
        let linear_earned = linear_strategy.calculate_earned_amount(
            total_amount, start_time, end_time, current_time, 0, false, None
        ).unwrap();
        
        let quadratic_earned = quadratic_strategy.calculate_earned_amount(
            total_amount, start_time, end_time, current_time, 0, false, None
        ).unwrap();
        
        let cubic_earned = cubic_strategy.calculate_earned_amount(
            total_amount, start_time, end_time, current_time, 0, false, None
        ).unwrap();
        
        // Linear: (0.5)^1 = 50% = 500 tokens
        assert_eq!(linear_earned, 500);
        
        // Quadratic: (0.5)^2 = 25% = 250 tokens
        assert_eq!(quadratic_earned, 250);
        
        // Cubic: (0.5)^3 = 12.5% = 125 tokens
        assert_eq!(cubic_earned, 125);
        
        // Verify ordering: cubic < quadratic < linear at 50% time
        assert!(cubic_earned < quadratic_earned);
        assert!(quadratic_earned < linear_earned);
    }

    #[test]
    fn test_with_factor_constructor() {
        // Test the with_factor constructor that maps to acceleration types
        let linear = ExponentialStreamingStrategy::with_factor(1.0);
        let also_linear = ExponentialStreamingStrategy::with_factor(1.5);
        let quadratic = ExponentialStreamingStrategy::with_factor(2.0);
        let also_quadratic = ExponentialStreamingStrategy::with_factor(2.5);
        let cubic = ExponentialStreamingStrategy::with_factor(3.0);
        let also_cubic = ExponentialStreamingStrategy::with_factor(10.0);
        
        assert_eq!(linear.get_factor(), 1.0);
        assert_eq!(also_linear.get_factor(), 1.0);
        assert_eq!(quadratic.get_factor(), 2.0);
        assert_eq!(also_quadratic.get_factor(), 2.0);
        assert_eq!(cubic.get_factor(), 3.0);
        assert_eq!(also_cubic.get_factor(), 3.0);
    }
}
