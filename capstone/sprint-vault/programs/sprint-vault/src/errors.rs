use anchor_lang::prelude::*;

#[error_code]
pub enum SprintVaultError {
    #[msg("Insufficient funds in escrow")]
    InsufficientFunds,
    
    #[msg("Sprint has expired")]
    SprintExpired,
    
    #[msg("Sprint has not started yet")]
    SprintNotStarted,
    
    #[msg("Unauthorized access")]
    Unauthorized,
    
    #[msg("Sprint is currently paused")]
    SprintPaused,
    
    #[msg("Sprint is already paused")]
    AlreadyPaused,
    
    #[msg("Sprint is not paused")]
    NotPaused,
    
    #[msg("Invalid time range")]
    InvalidTimeRange,
    
    #[msg("Invalid amount")]
    InvalidAmount,
    
    #[msg("Sprint already exists")]
    SprintAlreadyExists,
    
    #[msg("No funds available for withdrawal")]
    NoFundsAvailable,
    
    #[msg("Invalid mint")]
    InvalidMint,
    
    #[msg("Math overflow")]
    MathOverflow,
    
    #[msg("Sprint not ended")]
    SprintNotEnded,
    
    #[msg("Sprint has remaining funds")]
    RemainingFunds,
    
    #[msg("Invalid sprint status")]
    InvalidSprintStatus,
}
