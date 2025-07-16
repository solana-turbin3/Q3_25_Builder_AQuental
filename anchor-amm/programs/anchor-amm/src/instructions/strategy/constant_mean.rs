use super::AmmStrategy;
use anchor_lang::prelude::*;

pub struct ConstantMeanStrategy;

impl ConstantMeanStrategy {
    // Default weights for balanced 50/50 pool
    const DEFAULT_WEIGHT_A: u64 = 500000; // 50%
    const DEFAULT_WEIGHT_B: u64 = 500000; // 50%
    
    // Helper function to calculate weighted product approximation
    fn calculate_weighted_product(reserve_a: u64, reserve_b: u64, weight_a: u64, weight_b: u64) -> Result<u64> {
        // Simplified weighted product calculation
        // For safety, we'll use a simplified approach avoiding complex exponentiation
        // This is a rough approximation: (Ra * Wa + Rb * Wb) / (Wa + Wb)
        let total_weight = weight_a + weight_b;
        if total_weight == 0 {
            return Err(anchor_lang::error::Error::from(anchor_lang::error::ErrorCode::ConstraintSeeds));
        }
        let weighted_sum = (reserve_a * weight_a + reserve_b * weight_b) / total_weight;
        Ok(weighted_sum)
    }
    
    // Helper function to calculate spot price: (reserve_b / weight_b) / (reserve_a / weight_a)
    fn calculate_spot_price(reserve_a: u64, reserve_b: u64, weight_a: u64, weight_b: u64) -> Result<u64> {
        if reserve_a == 0 || weight_a == 0 {
            return Err(anchor_lang::error::Error::from(anchor_lang::error::ErrorCode::ConstraintSeeds));
        }
        
        let price_numerator = reserve_b * weight_a;
        let price_denominator = reserve_a * weight_b;
        
        if price_denominator == 0 {
            return Err(anchor_lang::error::Error::from(anchor_lang::error::ErrorCode::ConstraintSeeds));
        }
        
        Ok(price_numerator / price_denominator)
    }
}

impl AmmStrategy for ConstantMeanStrategy {
    fn calculate_amount_out(
        amount_in: u64,
        reserve_in: u64,
        reserve_out: u64,
        fee_bps: u64
    ) -> Result<u64> {
        if reserve_in == 0 || reserve_out == 0 {
            return Err(anchor_lang::error::Error::from(anchor_lang::error::ErrorCode::ConstraintSeeds));
        }
        
        // Apply fee
        let fee_adjustment = 10000 - fee_bps;
        let adjusted_amount_in = amount_in * fee_adjustment / 10000;
        
        // Use default 50/50 weights for this implementation
        let weight_a = Self::DEFAULT_WEIGHT_A;
        let weight_b = Self::DEFAULT_WEIGHT_B;
        
        // For balanced pools (50/50), this simplifies to constant product
        if weight_a == weight_b {
            let new_reserve_in = reserve_in + adjusted_amount_in;
            let invariant = reserve_in * reserve_out;
            let new_reserve_out = invariant / new_reserve_in;
            let amount_out = reserve_out - new_reserve_out;
            return Ok(amount_out);
        }
        
        // For weighted pools, use approximation based on price impact
        // This is a simplified version of the complex Balancer math
        let price_impact = adjusted_amount_in * 1000000 / (reserve_in * 1000000 / weight_a);
        let adjusted_price_impact = price_impact * weight_b / 1000000;
        let amount_out = reserve_out * adjusted_price_impact / 1000000;
        
        Ok(amount_out)
    }

    fn calculate_initial_lp_supply(amount_a: u64, amount_b: u64) -> Result<u64> {
        // For constant mean, LP supply is based on weighted geometric mean
        // Simplified: use weighted average of deposits
        let weight_a = Self::DEFAULT_WEIGHT_A;
        let weight_b = Self::DEFAULT_WEIGHT_B;
        let total_weight = weight_a + weight_b;
        let weighted_value = (amount_a * weight_a + amount_b * weight_b) / total_weight;
        Ok(weighted_value)
    }

    fn calculate_lp_tokens_to_mint(
        amount_a: u64,
        reserve_a: u64,
        lp_supply: u64,
    ) -> Result<u64> {
        if reserve_a == 0 {
            return Err(anchor_lang::error::Error::from(anchor_lang::error::ErrorCode::ConstraintSeeds));
        }
        
        // Proportional to the contribution weighted by token weight
        let weight_a = Self::DEFAULT_WEIGHT_A;
        let contribution_ratio = amount_a * 1000000 / reserve_a;
        let weighted_contribution = contribution_ratio * weight_a / 1000000;
        let lp_tokens = lp_supply * weighted_contribution / 1000000;
        
        Ok(lp_tokens)
    }

    fn calculate_withdraw_amounts(
        lp_amount: u64,
        reserve_a: u64,
        reserve_b: u64,
        lp_supply: u64,
    ) -> Result<(u64, u64)> {
        if lp_supply == 0 {
            return Err(anchor_lang::error::Error::from(anchor_lang::error::ErrorCode::ConstraintSeeds));
        }
        
        // Proportional withdrawal based on LP token ownership
        let withdrawal_ratio = lp_amount * 1000000 / lp_supply;
        let amount_a = reserve_a * withdrawal_ratio / 1000000;
        let amount_b = reserve_b * withdrawal_ratio / 1000000;
        
        Ok((amount_a, amount_b))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constant_mean_balanced_pool() {
        // Test swap calculation
        let amount_out = ConstantMeanStrategy::calculate_amount_out(
            100000,  // 100k input
            1000000, // 1M reserve in
            1000000, // 1M reserve out
            30       // 0.3% fee
        ).unwrap();
        
        // Should behave similar to constant product for balanced pools
        assert!(amount_out > 0);
        assert!(amount_out < 100000); // Should be less than input due to slippage
    }
    
    #[test]
    fn test_lp_calculations() {
        // Test initial LP supply
        let initial_lp = ConstantMeanStrategy::calculate_initial_lp_supply(1000000, 1000000).unwrap();
        assert!(initial_lp > 0);
        
        // Test LP minting
        let lp_tokens = ConstantMeanStrategy::calculate_lp_tokens_to_mint(
            100000,  // Amount to deposit
            1000000, // Current reserve
            initial_lp // Current LP supply
        ).unwrap();
        assert!(lp_tokens > 0);
        
        // Test withdraw amounts
        let (amount_a, amount_b) = ConstantMeanStrategy::calculate_withdraw_amounts(
            lp_tokens,
            1000000, // Reserve A
            1000000, // Reserve B
            initial_lp // Total LP supply
        ).unwrap();
        assert!(amount_a > 0);
        assert!(amount_b > 0);
    }
    
    #[test]
    fn test_spot_price_calculation() {
        let price = ConstantMeanStrategy::calculate_spot_price(1000000, 1000000, 500000, 500000).unwrap();
        assert!(price > 0);
    }
    
    #[test]
    fn test_weighted_product() {
        let product = ConstantMeanStrategy::calculate_weighted_product(1000000, 1000000, 600000, 400000).unwrap();
        assert!(product > 0);
    }
}

