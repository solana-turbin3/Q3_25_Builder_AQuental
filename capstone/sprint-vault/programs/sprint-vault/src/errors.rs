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
    
    #[msg("Sprint not fully funded")]
    SprintNotFunded,
    
    #[msg("Sprint already started")]
    SprintAlreadyStarted,
    
    #[msg("Unsupported token mint")]
    UnsupportedMint,
    
    #[msg("Amount below minimum withdrawal threshold")]
    BelowMinimumWithdrawal,
    
    #[msg("Only employer can pause/resume sprint")]
    OnlyEmployerCanPauseResume,
    
    #[msg("Maximum pause/resume count exceeded")]
    MaxPauseResumeExceeded,
    
    #[msg("Sprint auto-closed due to excessive pause duration")]
    SprintAutoClosedDueToExcessivePause,
    
    #[msg("Token account is frozen")]
    FrozenTokenAccount,
    
    #[msg("Invalid token decimals")]
    InvalidTokenDecimals,
    
    #[msg("Invalid mint for current network")]
    InvalidNetworkMint,
    
    #[msg("Operation would leave dust amount")]
    DustAmount,
    
    #[msg("Concurrent operation detected")]
    ConcurrentOperation,
    
    #[msg("Invalid timestamp - possible clock drift")]
    InvalidTimestamp,
    
    #[msg("PDA collision detected")]
    PDACollision,
    
    #[msg("Insufficient token balance")]
    InsufficientTokenBalance,
    
    #[msg("Invalid sprint duration - must be one of the predefined durations")]
    InvalidSprintDuration,
}
