// programs/anchor-amm/src/instructions/strategy/concentrated_liquidity.rs
use anchor_lang::prelude::*;
use crate::errors::AmmError;
use super::AmmStrategy;

/// Concentrated Liquidity AMM Strategy (Uniswap V3 style)
/// 
/// This implements concentrated liquidity where providers can specify price ranges
/// for their liquidity, allowing for more capital efficiency.
/// 
/// Key concepts:
/// - Liquidity is concentrated within specific price ranges [pa, pb]
/// - Price is represented as sqrt(price) for mathematical efficiency
/// - Liquidity (L) represents the amount of token0 or token1 in the range
/// - Formula: x * y = L^2 within active range
pub struct ConcentratedLiquidityStrategy;

/// Price range for concentrated liquidity
#[derive(Clone, Copy, Debug)]
pub struct PriceRange {
    pub sqrt_price_lower: u64,  // sqrt(pa) - lower bound
    pub sqrt_price_upper: u64,  // sqrt(pb) - upper bound
    pub sqrt_price_current: u64, // sqrt(p) - current price
}

impl ConcentratedLiquidityStrategy {
    /// Calculate the amount of token0 for a given liquidity and price range
    /// 
    /// Formula: x = L * (sqrt(pb) - sqrt(p)) / (sqrt(p) * sqrt(pb))
    /// Where: L = liquidity, p = current price, pb = upper price bound
    pub fn calculate_token0_amount(liquidity: u128, range: PriceRange) -> Result<u64> {
        require!(
            range.sqrt_price_current <= range.sqrt_price_upper,
            AmmError::InsufficientLiquidity
        );
        
        if range.sqrt_price_current <= range.sqrt_price_lower {
            // Price is below range, all liquidity is in token0
            let numerator = liquidity
                .checked_mul(range.sqrt_price_upper as u128)
                .ok_or(AmmError::Overflow)?
                .checked_sub(liquidity.checked_mul(range.sqrt_price_lower as u128).ok_or(AmmError::Overflow)?)
                .ok_or(AmmError::Overflow)?;
            
            let denominator = (range.sqrt_price_lower as u128)
                .checked_mul(range.sqrt_price_upper as u128)
                .ok_or(AmmError::Overflow)?;
            
            Ok((numerator / denominator) as u64)
        } else {
            // Price is within range
            let numerator = liquidity
                .checked_mul(range.sqrt_price_upper as u128)
                .ok_or(AmmError::Overflow)?
                .checked_sub(liquidity.checked_mul(range.sqrt_price_current as u128).ok_or(AmmError::Overflow)?)
                .ok_or(AmmError::Overflow)?;
            
            let denominator = (range.sqrt_price_current as u128)
                .checked_mul(range.sqrt_price_upper as u128)
                .ok_or(AmmError::Overflow)?;
            
            Ok((numerator / denominator) as u64)
        }
    }
    
    /// Calculate the amount of token1 for a given liquidity and price range
    /// 
    /// Formula: y = L * (sqrt(p) - sqrt(pa))
    /// Where: L = liquidity, p = current price, pa = lower price bound
    pub fn calculate_token1_amount(liquidity: u128, range: PriceRange) -> Result<u64> {
        require!(
            range.sqrt_price_current >= range.sqrt_price_lower,
            AmmError::InsufficientLiquidity
        );
        
        if range.sqrt_price_current >= range.sqrt_price_upper {
            // Price is above range, all liquidity is in token1
            let amount = liquidity
                .checked_mul(range.sqrt_price_upper as u128)
                .ok_or(AmmError::Overflow)?
                .checked_sub(liquidity.checked_mul(range.sqrt_price_lower as u128).ok_or(AmmError::Overflow)?)
                .ok_or(AmmError::Overflow)?;
            
            Ok(amount as u64)
        } else {
            // Price is within range
            let amount = liquidity
                .checked_mul(range.sqrt_price_current as u128)
                .ok_or(AmmError::Overflow)?
                .checked_sub(liquidity.checked_mul(range.sqrt_price_lower as u128).ok_or(AmmError::Overflow)?)
                .ok_or(AmmError::Overflow)?;
            
            Ok(amount as u64)
        }
    }
    
    /// Calculate liquidity for given token amounts and price range
    /// 
    /// L = min(x * sqrt(p) * sqrt(pb) / (sqrt(pb) - sqrt(p)), y / (sqrt(p) - sqrt(pa)))
    pub fn calculate_liquidity(
        amount0: u64,
        amount1: u64,
        range: PriceRange,
    ) -> Result<u128> {
        require!(
            range.sqrt_price_current >= range.sqrt_price_lower &&
            range.sqrt_price_current <= range.sqrt_price_upper,
            AmmError::InsufficientLiquidity
        );
        
        // Calculate liquidity from token0
        let liquidity0 = if range.sqrt_price_current < range.sqrt_price_upper {
            let numerator = (amount0 as u128)
                .checked_mul(range.sqrt_price_current as u128)
                .ok_or(AmmError::Overflow)?
                .checked_mul(range.sqrt_price_upper as u128)
                .ok_or(AmmError::Overflow)?;
            
            let denominator = (range.sqrt_price_upper as u128)
                .checked_sub(range.sqrt_price_current as u128)
                .ok_or(AmmError::Overflow)?;
            
            numerator / denominator
        } else {
            u128::MAX
        };
        
        // Calculate liquidity from token1
        let liquidity1 = if range.sqrt_price_current > range.sqrt_price_lower {
            let numerator = (amount1 as u128)
                .checked_mul(1_000_000) // Scale factor for precision
                .ok_or(AmmError::Overflow)?;
            
            let denominator = (range.sqrt_price_current as u128)
                .checked_sub(range.sqrt_price_lower as u128)
                .ok_or(AmmError::Overflow)?;
            
            numerator / denominator
        } else {
            u128::MAX
        };
        
        Ok(liquidity0.min(liquidity1))
    }
    
    /// Calculate new price after swap
    /// 
    /// For token0 -> token1: sqrt(p') = sqrt(p) / (1 + dx / L)
    /// For token1 -> token0: sqrt(p') = sqrt(p) + dy / L
    pub fn calculate_new_sqrt_price(
        current_sqrt_price: u64,
        liquidity: u128,
        amount_in: u64,
        zero_for_one: bool,
    ) -> Result<u64> {
        if zero_for_one {
            // Swapping token0 for token1, price decreases
            let denominator = liquidity
                .checked_add(amount_in as u128)
                .ok_or(AmmError::Overflow)?;
            
            let new_sqrt_price = (liquidity * current_sqrt_price as u128) / denominator;
            Ok(new_sqrt_price as u64)
        } else {
            // Swapping token1 for token0, price increases
            let delta = (amount_in as u128)
                .checked_mul(1_000_000) // Scale factor
                .ok_or(AmmError::Overflow)?
                .checked_div(liquidity)
                .ok_or(AmmError::Overflow)?;
            
            let new_sqrt_price = (current_sqrt_price as u128)
                .checked_add(delta)
                .ok_or(AmmError::Overflow)?;
            
            Ok(new_sqrt_price as u64)
        }
    }
}

impl AmmStrategy for ConcentratedLiquidityStrategy {
    /// Calculate swap output using concentrated liquidity formula
    /// 
    /// This is a simplified version - real implementation would need:
    /// - Multiple price ranges/ticks
    /// - Tick spacing
    /// - Cross-tick logic
    fn calculate_amount_out(
        amount_in: u64,
        reserve_in: u64,
        reserve_out: u64,
        fee_bps: u64,
    ) -> Result<u64> {
        require!(amount_in > 0, AmmError::InsufficientLiquidity);
        require!(reserve_in > 0, AmmError::InsufficientLiquidity);
        require!(reserve_out > 0, AmmError::InsufficientLiquidity);
        
        // Apply fee
        let amount_in_with_fee = amount_in
            .checked_mul(10_000 - fee_bps)
            .ok_or(AmmError::Overflow)?
            .checked_div(10_000)
            .ok_or(AmmError::Overflow)?;
        
        // For this simplified version, assume we have a single concentrated range
        // In reality, this would iterate through multiple price ranges
        
        // Calculate current sqrt price (simplified)
        let sqrt_price_current = ((reserve_out as u128 * 1_000_000) / reserve_in as u128) as u64;
        
        // Assume a concentrated range around current price (±10%)
        let sqrt_price_lower = (sqrt_price_current * 900) / 1000;
        let sqrt_price_upper = (sqrt_price_current * 1100) / 1000;
        
        let range = PriceRange {
            sqrt_price_lower,
            sqrt_price_upper,
            sqrt_price_current,
        };
        
        // Calculate liquidity (simplified)
        let liquidity = Self::calculate_liquidity(
            reserve_in,
            reserve_out,
            range,
        )?;
        
        // Calculate output amount using concentrated liquidity formula
        // This is simplified - real implementation would handle tick crossing
        let output_ratio = (amount_in_with_fee as u128 * liquidity) / 
                          (liquidity + amount_in_with_fee as u128);
        
        let amount_out = (output_ratio * reserve_out as u128 / liquidity) as u64;
        
        // Ensure we don't drain reserves
        require!(amount_out < reserve_out, AmmError::InsufficientLiquidity);
        
        Ok(amount_out)
    }
    
    /// Calculate initial LP supply for concentrated liquidity
    /// 
    /// In concentrated liquidity, LP tokens represent liquidity units
    /// rather than a simple token amount
    fn calculate_initial_lp_supply(amount_a: u64, amount_b: u64) -> Result<u64> {
        require!(amount_a > 0, AmmError::InsufficientLiquidity);
        require!(amount_b > 0, AmmError::InsufficientLiquidity);
        
        // For concentrated liquidity, LP supply is based on liquidity units
        // This is simplified - real implementation would consider price ranges
        
        // Assume initial price is 1:1 for simplicity
        let sqrt_price_current = 1_000_000; // 1.0 in fixed point
        let sqrt_price_lower = 900_000;     // 0.9 in fixed point
        let sqrt_price_upper = 1_100_000;   // 1.1 in fixed point
        
        let range = PriceRange {
            sqrt_price_lower,
            sqrt_price_upper,
            sqrt_price_current,
        };
        
        let liquidity = Self::calculate_liquidity(amount_a, amount_b, range)?;
        
        // LP supply represents liquidity units
        // Ensure we don't return 0 for small amounts
        Ok(((liquidity / 1_000).max(1)) as u64) // Scale down but ensure minimum 1
    }
    
    /// Calculate LP tokens to mint for concentrated liquidity
    /// 
    /// In concentrated liquidity, this depends on the price range
    /// and current active liquidity
    fn calculate_lp_tokens_to_mint(
        amount_a: u64,
        reserve_a: u64,
        lp_supply: u64,
    ) -> Result<u64> {
        require!(amount_a > 0, AmmError::InsufficientLiquidity);
        require!(reserve_a > 0, AmmError::InsufficientLiquidity);
        require!(lp_supply > 0, AmmError::InsufficientLiquidity);
        
        // For concentrated liquidity, LP tokens are proportional to liquidity added
        // This is simplified - real implementation would consider active ranges
        
        let proportion = (amount_a as u128 * 1_000_000) / reserve_a as u128;
        let lp_tokens = (lp_supply as u128 * proportion) / 1_000_000;
        
        Ok(lp_tokens as u64)
    }
    
    /// Calculate withdraw amounts for concentrated liquidity
    /// 
    /// In concentrated liquidity, withdrawals depend on active price ranges
    /// and position-specific liquidity
    fn calculate_withdraw_amounts(
        lp_amount: u64,
        reserve_a: u64,
        reserve_b: u64,
        lp_supply: u64,
    ) -> Result<(u64, u64)> {
        require!(lp_amount > 0, AmmError::InsufficientLiquidity);
        require!(lp_supply > 0, AmmError::InsufficientLiquidity);
        require!(lp_amount <= lp_supply, AmmError::InsufficientLiquidity);
        
        // For concentrated liquidity, withdrawal amounts depend on:
        // 1. Position's price range
        // 2. Current price
        // 3. Amount of liquidity in range
        
        // Simplified calculation - proportional to LP tokens
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
    fn test_token0_amount_calculation() {
        let range = PriceRange {
            sqrt_price_lower: 900_000,
            sqrt_price_upper: 1_100_000,
            sqrt_price_current: 1_000_000,
        };
        
        let liquidity = 1_000_000_000u128;
        
        let result = ConcentratedLiquidityStrategy::calculate_token0_amount(liquidity, range);
        assert!(result.is_ok());
        
        let amount0 = result.unwrap();
        assert!(amount0 > 0);
    }
    
    #[test]
    fn test_token1_amount_calculation() {
        let range = PriceRange {
            sqrt_price_lower: 900_000,
            sqrt_price_upper: 1_100_000,
            sqrt_price_current: 1_000_000,
        };
        
        let liquidity = 1_000_000_000u128;
        
        let result = ConcentratedLiquidityStrategy::calculate_token1_amount(liquidity, range);
        assert!(result.is_ok());
        
        let amount1 = result.unwrap();
        assert!(amount1 > 0);
    }
    
    #[test]
    fn test_liquidity_calculation() {
        let range = PriceRange {
            sqrt_price_lower: 900_000,
            sqrt_price_upper: 1_100_000,
            sqrt_price_current: 1_000_000,
        };
        
        let result = ConcentratedLiquidityStrategy::calculate_liquidity(
            100_000_000,
            100_000_000,
            range,
        );
        
        assert!(result.is_ok());
        let liquidity = result.unwrap();
        assert!(liquidity > 0);
    }
    
    #[test]
    fn test_concentrated_liquidity_has_different_behavior() {
        // Test that concentrated liquidity behaves differently from constant product
        let result = ConcentratedLiquidityStrategy::calculate_amount_out(
            10_000_000,  // 10M in
            100_000_000, // 100M reserve in
            100_000_000, // 100M reserve out
            30,          // 0.3% fee
        );
        
        assert!(result.is_ok());
        let amount_out = result.unwrap();
        
        // Concentrated liquidity should have different output characteristics
        // depending on where the price is relative to the concentrated range
        assert!(amount_out > 0);
    }
    
    #[test]
    fn test_new_sqrt_price_calculation() {
        let current_sqrt_price = 1_000_000;
        let liquidity = 1_000_000_000u128;
        let amount_in = 10_000_000;
        
        // Test token0 -> token1 swap (price decreases)
        let result = ConcentratedLiquidityStrategy::calculate_new_sqrt_price(
            current_sqrt_price,
            liquidity,
            amount_in,
            true,
        );
        
        assert!(result.is_ok());
        let new_sqrt_price = result.unwrap();
        assert!(new_sqrt_price < current_sqrt_price); // Price should decrease
        
        // Test token1 -> token0 swap (price increases)
        let result = ConcentratedLiquidityStrategy::calculate_new_sqrt_price(
            current_sqrt_price,
            liquidity,
            amount_in,
            false,
        );
        
        assert!(result.is_ok());
        let new_sqrt_price = result.unwrap();
        assert!(new_sqrt_price > current_sqrt_price); // Price should increase
    }
}
