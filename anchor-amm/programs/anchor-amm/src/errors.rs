// programs/amm/src/errors.rs
use anchor_lang::prelude::*;

#[error_code]
pub enum AmmError {
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Overflow")]
    Overflow,
}
