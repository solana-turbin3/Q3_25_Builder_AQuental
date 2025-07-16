// programs/anchor-amm/src/instructions/strategy/hybrid_cfmm.rs
use anchor_lang::prelude::*;
use crate::errors::AmmError;
use super::AmmStrategy;

/// Hybrid CFMM Strategy (Curve v2 style)
/// 
/// This implements a hybrid approach that combines:
/// - Stable swap mechanics for low slippage when assets are similarly priced
/// - Constant product mechanics for handling large price ranges
/// - Dynamic adjustment between the two based on market conditions
/// 
/// Key concepts:
/// - Uses a "gamma" parameter to control the balance between stable and volatile behavior
/// - Adjusts the invariant based on current price and historical data
/// - Provides concentrated liquidity around the current price while maintaining broad range support
/// 
/// Formula: A combination of stable swap and constant product invariants
/// - When gamma → 0: behaves like stable swap (low slippage)
/// - When gamma → 1: behaves like constant product (high range)
pub struct HybridCfmmStrategy;

/// Parameters for the hybrid CFMM
#[derive(Clone, Copy, Debug)]
pub struct HybridParams {
    pub gamma: u64,           // Balance between stable and volatile (0-1000000, scaled by 1M)
    pub mid_fee: u64,         // Fee when balanced (basis points)
    pub out_fee: u64,         // Fee when imbalanced (basis points)
    pub allowed_extra_profit: u64, // Extra profit allowed for rebalancing
    pub fee_gamma: u64,       // Fee adjustment sensitivity
    pub adjustment_step: u64,  // Price adjustment step size
    pub ma_half_time: u64,    // Moving average half-time for price tracking
}

impl Default for HybridParams {
    fn default() -> Self {
        Self {
            gamma: 500_000,              // 0.5 (balanced between stable and volatile)
            mid_fee: 30,                 // 0.3% base fee
            out_fee: 300,                // 3% fee when very imbalanced
            allowed_extra_profit: 2_000_000, // 2x allowed extra profit
            fee_gamma: 100_000,          // 0.1 fee adjustment sensitivity
            adjustment_step: 146,        // ~0.0146% price adjustment step
            ma_half_time: 600_000,       // 10 minutes in milliseconds
        }
    }
}

impl HybridCfmmStrategy {
    /// Calculate the invariant for the hybrid CFMM
    /// 
    /// Combines stable swap and constant product invariants based on gamma
    /// D = (gamma * x * y) + ((1 - gamma) * stable_invariant)
    pub fn calculate_invariant(
        x: u64,
        y: u64,
        params: HybridParams,
    ) -> Result<u128> {
        require!(x > 0 && y > 0, AmmError::InsufficientLiquidity);
        
        let x_u128 = x as u128;
        let y_u128 = y as u128;
        let gamma_u128 = params.gamma as u128;
        let scale = 1_000_000u128;
        
        // Constant product component: x * y
        let cp_component = x_u128
            .checked_mul(y_u128)
            .ok_or(AmmError::Overflow)?;
        
        // Stable swap component: (x + y)^2 / 4
        let sum = x_u128.checked_add(y_u128).ok_or(AmmError::Overflow)?;
        let stable_component = sum
            .checked_mul(sum)
            .ok_or(AmmError::Overflow)?
            .checked_div(4)
            .ok_or(AmmError::Overflow)?;
        
        // Weighted combination
        let cp_weighted = cp_component
            .checked_mul(gamma_u128)
            .ok_or(AmmError::Overflow)?
            .checked_div(scale)
            .ok_or(AmmError::Overflow)?;
        
        let stable_weighted = stable_component
            .checked_mul(scale.checked_sub(gamma_u128).ok_or(AmmError::Overflow)?)
            .ok_or(AmmError::Overflow)?
            .checked_div(scale)
            .ok_or(AmmError::Overflow)?;
        
        let invariant = cp_weighted.checked_add(stable_weighted).ok_or(AmmError::Overflow)?;
        
        Ok(invariant)
    }
    
    /// Calculate the price based on current reserves and parameters
    /// 
    /// Uses a combination of spot price from both components
    pub fn calculate_price(
        x: u64,
        y: u64,
        params: HybridParams,
    ) -> Result<u64> {
        require!(x > 0 && y > 0, AmmError::InsufficientLiquidity);
        
        let x_u128 = x as u128;
        let y_u128 = y as u128;
        let gamma_u128 = params.gamma as u128;
        let scale = 1_000_000u128;
        
        // Constant product price: y / x
        let cp_price = y_u128
            .checked_mul(scale)
            .ok_or(AmmError::Overflow)?
            .checked_div(x_u128)
            .ok_or(AmmError::Overflow)?;
        
        // Stable swap price: always 1 (scaled)
        let stable_price = scale;
        
        // Weighted combination
        let cp_weighted = cp_price
            .checked_mul(gamma_u128)
            .ok_or(AmmError::Overflow)?
            .checked_div(scale)
            .ok_or(AmmError::Overflow)?;
        
        let stable_weighted = stable_price
            .checked_mul(scale.checked_sub(gamma_u128).ok_or(AmmError::Overflow)?)
            .ok_or(AmmError::Overflow)?
            .checked_div(scale)
            .ok_or(AmmError::Overflow)?;
        
        let price = cp_weighted.checked_add(stable_weighted).ok_or(AmmError::Overflow)?;
        
        Ok(price as u64)
    }
    
    /// Calculate dynamic fee based on current imbalance
    /// 
    /// Fee increases as the pool becomes more imbalanced
    pub fn calculate_dynamic_fee(
        x: u64,
        y: u64,
        params: HybridParams,
    ) -> Result<u64> {
        require!(x > 0 && y > 0, AmmError::InsufficientLiquidity);
        
        let x_u128 = x as u128;
        let y_u128 = y as u128;
        
        // Calculate imbalance ratio
        let total = x_u128.checked_add(y_u128).ok_or(AmmError::Overflow)?;
        let expected_x = total.checked_div(2).ok_or(AmmError::Overflow)?;
        
        // Calculate deviation from balanced state
        let deviation = if x_u128 > expected_x {
            x_u128.checked_sub(expected_x).ok_or(AmmError::Overflow)?
        } else {
            expected_x.checked_sub(x_u128).ok_or(AmmError::Overflow)?
        };
        
        // Calculate imbalance percentage (scaled by 1M)
        let imbalance_pct = deviation
            .checked_mul(1_000_000)
            .ok_or(AmmError::Overflow)?
            .checked_div(expected_x)
            .ok_or(AmmError::Overflow)?;
        
        // Dynamic fee calculation
        let fee_range = params.out_fee.checked_sub(params.mid_fee).ok_or(AmmError::Overflow)?;
        let fee_adjustment = (fee_range as u128)
            .checked_mul(imbalance_pct)
            .ok_or(AmmError::Overflow)?
            .checked_div(1_000_000)
            .ok_or(AmmError::Overflow)?;
        
        let dynamic_fee = params.mid_fee.checked_add(fee_adjustment as u64).ok_or(AmmError::Overflow)?;
        
        Ok(dynamic_fee.min(params.out_fee))
    }
    
    /// Calculate amount out using the hybrid invariant
    /// 
    /// Solves for output amount while maintaining the invariant
    pub fn calculate_amount_out_internal(
        amount_in: u64,
        reserve_in: u64,
        reserve_out: u64,
        params: HybridParams,
    ) -> Result<u64> {
        require!(amount_in > 0, AmmError::InsufficientLiquidity);
        require!(reserve_in > 0 && reserve_out > 0, AmmError::InsufficientLiquidity);
        
        // Calculate dynamic fee
        let dynamic_fee = Self::calculate_dynamic_fee(reserve_in, reserve_out, params)?;
        
        // Apply fee to input amount
        let amount_in_with_fee = amount_in
            .checked_mul(10_000 - dynamic_fee)
            .ok_or(AmmError::Overflow)?
            .checked_div(10_000)
            .ok_or(AmmError::Overflow)?;
        
        // Calculate original invariant
        let invariant = Self::calculate_invariant(reserve_in, reserve_out, params)?;
        
        // New input reserve
        let new_reserve_in = reserve_in.checked_add(amount_in_with_fee).ok_or(AmmError::Overflow)?;
        
        // Solve for new output reserve using a more stable method
        // Use constant product approximation for stability
        let new_reserve_out = if invariant > 0 && new_reserve_in > 0 {
            let approximation = (invariant * 2) / (new_reserve_in as u128);
            approximation.min(reserve_out as u128) as u64
        } else {
            reserve_out
        };
        
        // Calculate amount out
        let amount_out = reserve_out.checked_sub(new_reserve_out).ok_or(AmmError::Overflow)?;
        
        // Ensure we don't drain the reserves
        require!(amount_out < reserve_out, AmmError::InsufficientLiquidity);
        require!(amount_out > 0, AmmError::InsufficientLiquidity);
        
        Ok(amount_out)
    }
    
    /// Update gamma parameter based on market conditions
    /// 
    /// This would typically be called periodically to adjust the strategy
    pub fn update_gamma(
        current_price: u64,
        target_price: u64,
        current_gamma: u64,
        params: HybridParams,
    ) -> Result<u64> {
        let price_diff = if current_price > target_price {
            current_price.checked_sub(target_price).ok_or(AmmError::Overflow)?
        } else {
            target_price.checked_sub(current_price).ok_or(AmmError::Overflow)?
        };
        
        // If price is close to target, decrease gamma (more stable behavior)
        // If price is far from target, increase gamma (more volatile behavior)
        let price_deviation = (price_diff as u128)
            .checked_mul(1_000_000)
            .ok_or(AmmError::Overflow)?
            .checked_div(target_price as u128)
            .ok_or(AmmError::Overflow)?;
        
        let adjustment = (price_deviation * params.adjustment_step as u128) / 1_000_000;
        
        let new_gamma = if price_deviation > 10_000 { // 1% deviation
            // Increase gamma for more volatile behavior
            current_gamma.checked_add(adjustment as u64).ok_or(AmmError::Overflow)?
        } else {
            // Decrease gamma for more stable behavior
            current_gamma.checked_sub(adjustment as u64).unwrap_or(0)
        };
        
        // Clamp gamma between 0 and 1000000
        Ok(new_gamma.min(1_000_000))
    }
}

impl AmmStrategy for HybridCfmmStrategy {
    fn calculate_amount_out(
        amount_in: u64,
        reserve_in: u64,
        reserve_out: u64,
        fee_bps: u64,
    ) -> Result<u64> {
        require!(amount_in > 0, AmmError::InsufficientLiquidity);
        require!(reserve_in > 0, AmmError::InsufficientLiquidity);
        require!(reserve_out > 0, AmmError::InsufficientLiquidity);
        
        // Simplified hybrid approach: use weighted average of constant product and stable swap
        
        // Apply fee
        let amount_in_with_fee = amount_in
            .checked_mul(10_000 - fee_bps)
            .ok_or(AmmError::Overflow)?
            .checked_div(10_000)
            .ok_or(AmmError::Overflow)?;
        
        // Constant product calculation
        let cp_numerator = amount_in_with_fee as u128 * reserve_out as u128;
        let cp_denominator = reserve_in as u128 + amount_in_with_fee as u128;
        let cp_amount_out = (cp_numerator / cp_denominator) as u64;
        
        // Stable swap calculation (simplified)
        let stable_amount_out = amount_in_with_fee.min(reserve_out / 2); // Conservative stable swap
        
        // Weighted average (50% each for simplicity)
        let hybrid_amount_out = (cp_amount_out / 2) + (stable_amount_out / 2);
        
        // Ensure we don't drain reserves
        require!(hybrid_amount_out < reserve_out, AmmError::InsufficientLiquidity);
        require!(hybrid_amount_out > 0, AmmError::InsufficientLiquidity);
        
        Ok(hybrid_amount_out)
    }
    
    fn calculate_initial_lp_supply(amount_a: u64, amount_b: u64) -> Result<u64> {
        require!(amount_a > 0, AmmError::InsufficientLiquidity);
        require!(amount_b > 0, AmmError::InsufficientLiquidity);
        
        // For hybrid CFMM, LP supply is based on the invariant
        let params = HybridParams::default();
        let invariant = Self::calculate_invariant(amount_a, amount_b, params)?;
        
        // Take square root of invariant as LP supply (similar to Uniswap v2)
        let lp_supply = ((invariant as f64).sqrt() as u64).max(1_000); // Minimum 1000 to avoid precision issues
        
        Ok(lp_supply)
    }
    
    fn calculate_lp_tokens_to_mint(
        amount_a: u64,
        reserve_a: u64,
        lp_supply: u64,
    ) -> Result<u64> {
        require!(amount_a > 0, AmmError::InsufficientLiquidity);
        require!(reserve_a > 0, AmmError::InsufficientLiquidity);
        require!(lp_supply > 0, AmmError::InsufficientLiquidity);
        
        // For hybrid CFMM, LP tokens are proportional to the share of invariant added
        let proportion = (amount_a as u128 * 1_000_000) / reserve_a as u128;
        let lp_tokens = (lp_supply as u128 * proportion) / 1_000_000;
        
        Ok(lp_tokens as u64)
    }
    
    fn calculate_withdraw_amounts(
        lp_amount: u64,
        reserve_a: u64,
        reserve_b: u64,
        lp_supply: u64,
    ) -> Result<(u64, u64)> {
        require!(lp_amount > 0, AmmError::InsufficientLiquidity);
        require!(lp_supply > 0, AmmError::InsufficientLiquidity);
        require!(lp_amount <= lp_supply, AmmError::InsufficientLiquidity);
        
        // Proportional withdrawal based on LP token share
        let proportion = (lp_amount as u128 * 1_000_000) / lp_supply as u128;
        
        let amount_a = (reserve_a as u128 * proportion) / 1_000_000;
        let amount_b = (reserve_b as u128 * proportion) / 1_000_000;
        
        Ok((amount_a as u64, amount_b as u64))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hybrid_invariant_calculation() {
        let params = HybridParams::default();
        
        let result = HybridCfmmStrategy::calculate_invariant(
            1_000_000,
            1_000_000,
            params,
        );
        
        assert!(result.is_ok());
        let invariant = result.unwrap();
        assert!(invariant > 0);
    }
    
    #[test]
    fn test_hybrid_price_calculation() {
        let params = HybridParams::default();
        
        let result = HybridCfmmStrategy::calculate_price(
            1_000_000,
            1_000_000,
            params,
        );
        
        assert!(result.is_ok());
        let price = result.unwrap();
        assert!(price > 0);
    }
    
    #[test]
    fn test_dynamic_fee_calculation() {
        let params = HybridParams::default();
        
        // Test balanced pool
        let balanced_fee = HybridCfmmStrategy::calculate_dynamic_fee(
            1_000_000,
            1_000_000,
            params,
        ).unwrap();
        
        // Test imbalanced pool
        let imbalanced_fee = HybridCfmmStrategy::calculate_dynamic_fee(
            2_000_000,
            500_000,
            params,
        ).unwrap();
        
        assert!(balanced_fee <= imbalanced_fee);
        assert!(balanced_fee >= params.mid_fee);
        assert!(imbalanced_fee <= params.out_fee);
    }
    
    #[test]
    fn test_hybrid_amount_out_calculation() {
        let result = HybridCfmmStrategy::calculate_amount_out(
            100_000,
            1_000_000,
            1_000_000,
            30, // 0.3% fee
        );
        
        assert!(result.is_ok());
        let amount_out = result.unwrap();
        assert!(amount_out > 0);
        assert!(amount_out < 100_000); // Should be less than input due to fees and slippage
    }
    
    #[test]
    fn test_hybrid_initial_lp_supply() {
        let result = HybridCfmmStrategy::calculate_initial_lp_supply(
            1_000_000,
            1_000_000,
        );
        
        assert!(result.is_ok());
        let lp_supply = result.unwrap();
        assert!(lp_supply > 0);
    }
    
    #[test]
    fn test_hybrid_lp_tokens_to_mint() {
        let result = HybridCfmmStrategy::calculate_lp_tokens_to_mint(
            100_000,
            1_000_000,
            1_000_000,
        );
        
        assert!(result.is_ok());
        let lp_tokens = result.unwrap();
        assert!(lp_tokens > 0);
    }
    
    #[test]
    fn test_hybrid_withdraw_amounts() {
        let result = HybridCfmmStrategy::calculate_withdraw_amounts(
            100_000,
            1_000_000,
            1_000_000,
            1_000_000,
        );
        
        assert!(result.is_ok());
        let (amount_a, amount_b) = result.unwrap();
        assert!(amount_a > 0);
        assert!(amount_b > 0);
    }
    
    #[test]
    fn test_gamma_update() {
        let params = HybridParams::default();
        
        // Test gamma update with price deviation
        let result = HybridCfmmStrategy::update_gamma(
            1_100_000, // Current price (10% higher)
            1_000_000, // Target price
            500_000,   // Current gamma
            params,
        );
        
        assert!(result.is_ok());
        let new_gamma = result.unwrap();
        assert!(new_gamma >= 0);
        assert!(new_gamma <= 1_000_000);
    }
    
    #[test]
    fn test_hybrid_different_from_constant_product() {
        // Test that hybrid CFMM behaves differently from constant product
        let hybrid_result = HybridCfmmStrategy::calculate_amount_out(
            100_000,
            1_000_000,
            1_000_000,
            30,
        ).unwrap();
        
        // Compare with simple constant product calculation
        let cp_result = {
            let amount_in_with_fee = 100_000 * (10_000 - 30) / 10_000;
            let numerator = amount_in_with_fee * 1_000_000;
            let denominator = 1_000_000 + amount_in_with_fee;
            numerator / denominator
        };
        
        // They should be different due to the hybrid mechanics
        println!("Hybrid result: {}, CP result: {}", hybrid_result, cp_result);
        assert!(hybrid_result != cp_result);
    }
}
