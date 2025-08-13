use anchor_lang::prelude::*;

/// Enum defining the acceleration type for exponential streaming strategies
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccelerationType {
    /// Linear distribution (no acceleration)
    Linear = 1,
    /// Quadratic acceleration (squared)
    Quadratic = 2,
    /// Cubic acceleration (cubed)
    Cubic = 3,
}

impl AccelerationType {
    /// Convert the acceleration type to its numerical factor
    pub fn to_factor(&self) -> f64 {
        match self {
            AccelerationType::Linear => 1.0,
            AccelerationType::Quadratic => 2.0,
            AccelerationType::Cubic => 3.0,
        }
    }
    
    /// Get a description of the acceleration type
    pub fn description(&self) -> &str {
        match self {
            AccelerationType::Linear => "Linear: Constant rate over time",
            AccelerationType::Quadratic => "Quadratic: Slow start, accelerating finish",
            AccelerationType::Cubic => "Cubic: Very slow start, rapid acceleration at the end",
        }
    }
}

/// Trait defining the interface for streaming payment strategies
pub trait StreamingStrategy {
    /// Calculate the amount earned up to a specific point in time
    ///
    /// # Arguments
    /// * `total_amount` - The total amount to be streamed
    /// * `start_time` - The unix timestamp when streaming starts
    /// * `end_time` - The unix timestamp when streaming ends
    /// * `current_time` - The current unix timestamp
    /// * `total_paused_duration` - Total time the stream has been paused
    /// * `is_paused` - Whether the stream is currently paused
    /// * `pause_time` - The time when the stream was paused (if applicable)
    ///
    /// # Returns
    /// The amount earned up to the current time
    fn calculate_earned_amount(
        &self,
        total_amount: u64,
        start_time: i64,
        end_time: i64,
        current_time: i64,
        total_paused_duration: i64,
        is_paused: bool,
        pause_time: Option<i64>,
    ) -> Result<u64>;

    /// Calculate the release rate (tokens per unit of time)
    ///
    /// # Arguments
    /// * `total_amount` - The total amount to be streamed
    /// * `start_time` - The unix timestamp when streaming starts
    /// * `end_time` - The unix timestamp when streaming ends
    ///
    /// # Returns
    /// The release rate in tokens per second
    fn calculate_release_rate(
        &self,
        total_amount: u64,
        start_time: i64,
        end_time: i64,
    ) -> Result<u64>;

    /// Get a description of the strategy
    fn description(&self) -> &str;
}

/// Context for streaming calculations
#[derive(Debug, Clone)]
pub struct StreamingContext {
    pub total_amount: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub current_time: i64,
    pub total_paused_duration: i64,
    pub is_paused: bool,
    pub pause_time: Option<i64>,
    pub withdrawn_amount: u64,
}

impl StreamingContext {
    /// Create a new streaming context
    pub fn new(
        total_amount: u64,
        start_time: i64,
        end_time: i64,
        current_time: i64,
        total_paused_duration: i64,
        is_paused: bool,
        pause_time: Option<i64>,
        withdrawn_amount: u64,
    ) -> Self {
        Self {
            total_amount,
            start_time,
            end_time,
            current_time,
            total_paused_duration,
            is_paused,
            pause_time,
            withdrawn_amount,
        }
    }

    /// Get the effective current time (accounting for pauses)
    pub fn effective_current_time(&self) -> i64 {
        if self.is_paused {
            self.pause_time.unwrap_or(self.current_time)
        } else {
            self.current_time
        }
    }

    /// Get the effective end time (accounting for pauses)
    pub fn effective_end_time(&self) -> i64 {
        self.end_time + self.total_paused_duration
    }
}
