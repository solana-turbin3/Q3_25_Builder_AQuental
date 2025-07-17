use anchor_lang::prelude::*;

#[error_code]
pub enum StakingError {
    #[msg("Calculation overflow")]
    CalculationOverflow,
    #[msg("Insufficient staked amount")]
    InsufficientStakedAmount,
    #[msg("Invalid reward mint")]
    InvalidRewardMint,
    #[msg("Invalid timestamp")]
    InvalidTimestamp,
}
