// programs/anchor-amm/src/instructions/strategy/stable_swap.rs
use anchor_lang::prelude::*;
use crate::errors::AmmError;
use super::AmmStrategy;

/// Stable Swap AMM Strategy
/// 
/// This is a simplified example of a stable swap strategy that could be used
/// for assets that should trade close to 1:1 ratio (like stablecoins).
/// 
/// Note: This is a simplified demonstration - a real stable swap would
/// implement the full StableSwap invariant with amplification factor.
pub struct StableSwapStrategy;

impl AmmStrategy for StableSwapStrategy {
    /// Calculate swap output using a simplified stable swap formula
    /// 
    /// This is a simplified version - real stable swap uses more complex math
    /// with amplification coefficients for better price stability.
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
        
        // Simplified stable swap: closer to 1:1 ratio
        // In a real implementation, this would use the StableSwap invariant
        // D^(n+1) = (A * n^n * S + D * P) / (A * n^n + (n+1) * P)
        // where A is amplification, n is number of coins, S is sum, P is product
        
        // For now, use a simple linear approximation with reduced slippage
        let slippage_factor = 10_000; // Much less slippage than constant product
        let price_impact = amount_in_with_fee
            .checked_mul(slippage_factor)
            .ok_or(AmmError::Overflow)?
            .checked_div(reserve_in + reserve_out)
            .ok_or(AmmError::Overflow)?;
        
        let amount_out = amount_in_with_fee
            .checked_sub(price_impact)
            .ok_or(AmmError::Overflow)?;
        
        // Ensure we don't drain reserves
        require!(amount_out < reserve_out, AmmError::InsufficientLiquidity);
        
        Ok(amount_out)
    }

    /// For stable swap, initial LP supply is typically the sum of amounts
    fn calculate_initial_lp_supply(amount_a: u64, amount_b: u64) -> Result<u64> {
        require!(amount_a > 0, AmmError::InsufficientLiquidity);
        require!(amount_b > 0, AmmError::InsufficientLiquidity);
        
        // For stablecoins, LP supply is closer to the sum rather than geometric mean
        Ok(amount_a.checked_add(amount_b).ok_or(AmmError::Overflow)?)
    }

    /// Standard proportional LP calculation
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

    /// Standard proportional withdraw
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
    fn test_stable_swap_has_less_slippage() {
        // Compare with same parameters as constant product
        let result = StableSwapStrategy::calculate_amount_out(
            10_000_000,  // 10M in
            100_000_000, // 100M reserve in
            100_000_000, // 100M reserve out
            30,          // 0.3% fee
        );
        
        assert!(result.is_ok());
        let amount_out = result.unwrap();
        
        // Stable swap should have less slippage (closer to 1:1)
        // Expected: closer to 9.97M (just fee deduction)
        assert!(amount_out > 9_900_000); // Much higher than constant product
    }

    #[test]
    fn test_stable_initial_lp_is_sum() {
        let result = StableSwapStrategy::calculate_initial_lp_supply(
            100_000_000, // 100M A
            100_000_000, // 100M B
        );
        
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 200_000_000); // Sum, not geometric mean
    }
}
