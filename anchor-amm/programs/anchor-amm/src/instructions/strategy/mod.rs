// programs/anchor-amm/src/instructions/strategy/mod.rs
use anchor_lang::prelude::*;

pub mod constant_product;
pub mod stable_swap;
pub mod concentrated_liquidity;
pub mod hybrid_cfmm;
pub mod constant_mean;

pub use constant_product::ConstantProductStrategy;
pub use stable_swap::StableSwapStrategy;
pub use concentrated_liquidity::ConcentratedLiquidityStrategy;
pub use hybrid_cfmm::HybridCfmmStrategy;
pub use constant_mean::ConstantMeanStrategy;

/// Trait defining the interface for AMM strategies
pub trait AmmStrategy {
    /// Calculate the amount out for a given amount in
    /// 
    /// # Arguments
    /// * `amount_in` - The amount of tokens being swapped in
    /// * `reserve_in` - The reserve of the input token
    /// * `reserve_out` - The reserve of the output token
    /// * `fee_bps` - The fee in basis points (e.g., 30 = 0.3%)
    /// 
    /// # Returns
    /// * `Result<u64>` - The amount of tokens to be received
    fn calculate_amount_out(
        amount_in: u64,
        reserve_in: u64,
        reserve_out: u64,
        fee_bps: u64,
    ) -> Result<u64>;

    /// Calculate the initial LP token supply for the first deposit
    /// 
    /// # Arguments
    /// * `amount_a` - The amount of token A being deposited
    /// * `amount_b` - The amount of token B being deposited
    /// 
    /// # Returns
    /// * `Result<u64>` - The initial LP token supply
    fn calculate_initial_lp_supply(amount_a: u64, amount_b: u64) -> Result<u64>;

    /// Calculate LP tokens to mint for a deposit
    /// 
    /// # Arguments
    /// * `amount_a` - The amount of token A being deposited
    /// * `reserve_a` - The current reserve of token A
    /// * `lp_supply` - The current LP token supply
    /// 
    /// # Returns
    /// * `Result<u64>` - The amount of LP tokens to mint
    fn calculate_lp_tokens_to_mint(
        amount_a: u64,
        reserve_a: u64,
        lp_supply: u64,
    ) -> Result<u64>;

    /// Calculate tokens to return when withdrawing LP tokens
    /// 
    /// # Arguments
    /// * `lp_amount` - The amount of LP tokens being burned
    /// * `reserve_a` - The current reserve of token A
    /// * `reserve_b` - The current reserve of token B
    /// * `lp_supply` - The current LP token supply
    /// 
    /// # Returns
    /// * `Result<(u64, u64)>` - The amounts of token A and B to return
    fn calculate_withdraw_amounts(
        lp_amount: u64,
        reserve_a: u64,
        reserve_b: u64,
        lp_supply: u64,
    ) -> Result<(u64, u64)>;
}
