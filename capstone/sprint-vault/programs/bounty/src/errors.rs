use anchor_lang::prelude::*;

#[error_code]
pub enum BountyError {
    #[msg("Title exceeds maximum length")]
    TitleTooLong,
    
    #[msg("No milestones defined")]
    NoMilestones,
    
    #[msg("Milestone amounts don't sum to total")]
    MilestoneAmountMismatch,
    
    #[msg("Bounty has expired")]
    BountyExpired,
    
    #[msg("Milestone already claimed")]
    MilestoneAlreadyClaimed,
    
    #[msg("Not authorized to perform this action")]
    Unauthorized,
    
    #[msg("Vault CPI failed")]
    VaultCPIFailed,
    
    #[msg("Sprint CPI failed")]
    SprintCPIFailed,
    
    #[msg("Invalid Git reference format")]
    InvalidGitReference,
    
    #[msg("Milestone not yet submitted")]
    MilestoneNotSubmitted,
    
    #[msg("Invalid external signature")]
    InvalidSignature,
    
    #[msg("Vault not initialized")]
    VaultNotInitialized,
    
    #[msg("Sprint association invalid")]
    InvalidSprintAssociation,
    
    #[msg("Milestone already approved")]
    MilestoneAlreadyApproved,
    
    #[msg("Cannot cancel with pending reviews")]
    PendingReviews,
    
    #[msg("Git criteria not satisfied")]
    GitCriteriaNotMet,
    
    #[msg("Insufficient vault balance")]
    InsufficientVaultBalance,
    
    #[msg("Milestone not found")]
    MilestoneNotFound,
    
    #[msg("Invalid milestone status")]
    InvalidMilestoneStatus,
    
    #[msg("Contributor already assigned")]
    ContributorAlreadyAssigned,
    
    #[msg("Too many pending releases")]
    TooManyPendingReleases,
    
    #[msg("Reason text too long")]
    ReasonTooLong,
    
    #[msg("Invalid claim status for submission")]
    InvalidClaimStatus,
    
    #[msg("Invalid evidence URL format")]
    InvalidEvidenceUrl,
    
    #[msg("Evidence URL too long")]
    EvidenceUrlTooLong,
    
    #[msg("Bounty is not active")]
    BountyNotActive,
    
    #[msg("Milestone is not open for claims")]
    MilestoneNotOpen,
    
    #[msg("Invalid bounty status for cancellation")]
    InvalidBountyStatus,
    
    #[msg("Invalid amount")]
    InvalidAmount,
    
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    
    #[msg("Excessive funding amount")]
    ExcessiveFunding,
}
