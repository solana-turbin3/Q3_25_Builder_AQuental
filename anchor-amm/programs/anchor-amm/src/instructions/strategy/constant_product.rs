// programs/anchor-amm/src/instructions/strategy/constant_product.rs
use anchor_lang::prelude::*;
use crate::errors::AmmError;
use super::AmmStrategy;

/// Constant Product AMM Strategy (x * y = k)
/// 
/// This implements the classic Uniswap V2 style constant product formula
/// where the product of reserves remains constant before and after each trade.
pub struct ConstantProductStrategy;

impl AmmStrategy for ConstantProductStrategy {
    /// Calculate swap output using constant product formula
    /// 
    /// Formula: amount_out = (amount_in_with_fee * reserve_out) / (reserve_in + amount_in_with_fee)
    /// Where: amount_in_with_fee = amount_in * (10000 - fee_bps) / 10000
    fn calculate_amount_out(
        amount_in: u64,
        reserve_in: u64,
        reserve_out: u64,
        fee_bps: u64,
    ) -> Result<u64> {
        require!(amount_in > 0, AmmError::InsufficientLiquidity);
        require!(reserve_in > 0, AmmError::InsufficientLiquidity);
        require!(reserve_out > 0, AmmError::InsufficientLiquidity);
        
        // Calculate amount after fee deduction
        let amount_in_with_fee = amount_in
            .checked_mul(10_000 - fee_bps)
            .ok_or(AmmError::Overflow)?
            .checked_div(10_000)
            .ok_or(AmmError::Overflow)?;
        
        // Apply constant product formula: (x + dx) * (y - dy) = x * y
        // Solving for dy: dy = (dx * y) / (x + dx)
        let numerator = (amount_in_with_fee as u128)
            .checked_mul(reserve_out as u128)
            .ok_or(AmmError::Overflow)?;
        
        let denominator = (reserve_in as u128)
            .checked_add(amount_in_with_fee as u128)
            .ok_or(AmmError::Overflow)?;
        
        let amount_out = numerator
            .checked_div(denominator)
            .ok_or(AmmError::Overflow)?;
        
        // Ensure we don't drain the entire reserve
        let amount_out = amount_out as u64;
        require!(amount_out < reserve_out, AmmError::InsufficientLiquidity);
        
        Ok(amount_out)
    }

    /// Calculate initial LP supply using geometric mean
    /// 
    /// Formula: sqrt(amount_a * amount_b)
    fn calculate_initial_lp_supply(amount_a: u64, amount_b: u64) -> Result<u64> {
        require!(amount_a > 0, AmmError::InsufficientLiquidity);
        require!(amount_b > 0, AmmError::InsufficientLiquidity);
        
        let product = (amount_a as u128)
            .checked_mul(amount_b as u128)
            .ok_or(AmmError::Overflow)?;
        
        Ok(product.isqrt() as u64)
    }

    /// Calculate LP tokens to mint proportionally
    /// 
    /// Formula: lp_tokens = (amount_a * lp_supply) / reserve_a
    fn calculate_lp_tokens_to_mint(
        amount_a: u64,
        reserve_a: u64,
        lp_supply: u64,
    ) -> Result<u64> {
        require!(amount_a > 0, AmmError::InsufficientLiquidity);
        require!(reserve_a > 0, AmmError::InsufficientLiquidity);
        require!(lp_supply > 0, AmmError::InsufficientLiquidity);
        
        let lp_tokens = (amount_a as u128)
            .checked_mul(lp_supply as u128)
            .ok_or(AmmError::Overflow)?
            .checked_div(reserve_a as u128)
            .ok_or(AmmError::Overflow)?;
        
        Ok(lp_tokens as u64)
    }

    /// Calculate proportional withdraw amounts
    /// 
    /// Formula: 
    /// - amount_a = (lp_amount * reserve_a) / lp_supply
    /// - amount_b = (lp_amount * reserve_b) / lp_supply
    fn calculate_withdraw_amounts(
        lp_amount: u64,
        reserve_a: u64,
        reserve_b: u64,
        lp_supply: u64,
    ) -> Result<(u64, u64)> {
        require!(lp_amount > 0, AmmError::InsufficientLiquidity);
        require!(lp_supply > 0, AmmError::InsufficientLiquidity);
        require!(lp_amount <= lp_supply, AmmError::InsufficientLiquidity);
        
        let amount_a = (lp_amount as u128)
            .checked_mul(reserve_a as u128)
            .ok_or(AmmError::Overflow)?
            .checked_div(lp_supply as u128)
            .ok_or(AmmError::Overflow)? as u64;
        
        let amount_b = (lp_amount as u128)
            .checked_mul(reserve_b as u128)
            .ok_or(AmmError::Overflow)?
            .checked_div(lp_supply as u128)
            .ok_or(AmmError::Overflow)? as u64;
        
        Ok((amount_a, amount_b))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_amount_out() {
        // Test with 100M reserves, 10M input, 30 bps fee
        let result = ConstantProductStrategy::calculate_amount_out(
            10_000_000,  // 10M in
            100_000_000, // 100M reserve in
            100_000_000, // 100M reserve out
            30,          // 0.3% fee
        );
        
        assert!(result.is_ok());
        let amount_out = result.unwrap();
        
        // Expected: (9.997M * 100M) / (100M + 9.997M) ≈ 9.066M
        assert!(amount_out > 9_000_000 && amount_out < 9_100_000);
    }

    #[test]
    fn test_calculate_initial_lp_supply() {
        let result = ConstantProductStrategy::calculate_initial_lp_supply(
            100_000_000, // 100M A
            100_000_000, // 100M B
        );
        
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 100_000_000); // sqrt(100M * 100M) = 100M
    }

    #[test]
    fn test_calculate_lp_tokens_to_mint() {
        let result = ConstantProductStrategy::calculate_lp_tokens_to_mint(
            50_000_000,  // 50M new deposit
            100_000_000, // 100M current reserve
            100_000_000, // 100M current LP supply
        );
        
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 50_000_000); // (50M * 100M) / 100M = 50M
    }

    #[test]
    fn test_calculate_withdraw_amounts() {
        let result = ConstantProductStrategy::calculate_withdraw_amounts(
            50_000_000,  // 50M LP tokens
            100_000_000, // 100M reserve A
            200_000_000, // 200M reserve B
            100_000_000, // 100M LP supply
        );
        
        assert!(result.is_ok());
        let (amount_a, amount_b) = result.unwrap();
        assert_eq!(amount_a, 50_000_000);  // (50M * 100M) / 100M = 50M
        assert_eq!(amount_b, 100_000_000); // (50M * 200M) / 100M = 100M
    }
}
