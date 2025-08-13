// Example usage of AccelerationType enum with ExponentialStreamingStrategy

use super::{AccelerationType, ExponentialStreamingStrategy, StreamingStrategy};

/// Example: Creating strategies with different acceleration types
pub fn create_strategy_examples() {
    // Using the enum directly for clear, type-safe acceleration selection
    let linear = ExponentialStreamingStrategy::new(AccelerationType::Linear);
    let quadratic = ExponentialStreamingStrategy::new(AccelerationType::Quadratic);
    let cubic = ExponentialStreamingStrategy::new(AccelerationType::Cubic);
    
    // The enum ensures only valid acceleration types can be used
    // This prevents invalid values like 1.7 or 4.5 that don't map to specific curves
}

/// Example: Selecting strategy based on project requirements
pub fn select_strategy_for_project(project_type: &str) -> ExponentialStreamingStrategy {
    match project_type {
        "standard" => {
            // Linear: Fair distribution throughout the sprint
            ExponentialStreamingStrategy::new(AccelerationType::Linear)
        },
        "milestone-based" => {
            // Quadratic: Moderate acceleration, rewards progress
            ExponentialStreamingStrategy::new(AccelerationType::Quadratic)
        },
        "completion-critical" => {
            // Cubic: Heavy back-loading, strong completion incentive
            ExponentialStreamingStrategy::new(AccelerationType::Cubic)
        },
        _ => {
            // Default to quadratic for unknown types
            ExponentialStreamingStrategy::default()
        }
    }
}

/// Example: Comparing payment distributions
pub fn compare_payment_at_midpoint() {
    let total_amount = 1000u64;
    let start_time = 0i64;
    let end_time = 100i64;
    let midpoint = 50i64;
    
    // Create strategies with each acceleration type
    let strategies = [
        ("Linear", ExponentialStreamingStrategy::new(AccelerationType::Linear)),
        ("Quadratic", ExponentialStreamingStrategy::new(AccelerationType::Quadratic)),
        ("Cubic", ExponentialStreamingStrategy::new(AccelerationType::Cubic)),
    ];
    
    // Calculate earned amount at midpoint for each
    for (name, strategy) in strategies.iter() {
        let earned = strategy.calculate_earned_amount(
            total_amount,
            start_time,
            end_time,
            midpoint,
            0, // no pause
            false,
            None,
        ).unwrap();
        
        let percentage = (earned as f64 / total_amount as f64) * 100.0;
        println!("{}: {}% earned at midpoint", name, percentage);
    }
    // Output:
    // Linear: 50% earned at midpoint
    // Quadratic: 25% earned at midpoint  
    // Cubic: 12.5% earned at midpoint
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_acceleration_type_values() {
        // Verify enum values match their intended numerical factors
        assert_eq!(AccelerationType::Linear as u8, 1);
        assert_eq!(AccelerationType::Quadratic as u8, 2);
        assert_eq!(AccelerationType::Cubic as u8, 3);
        
        // Verify to_factor() conversion
        assert_eq!(AccelerationType::Linear.to_factor(), 1.0);
        assert_eq!(AccelerationType::Quadratic.to_factor(), 2.0);
        assert_eq!(AccelerationType::Cubic.to_factor(), 3.0);
    }
}
