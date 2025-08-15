use anchor_lang::prelude::*;
use crate::errors::BountyError;
#[account]
pub struct BountyClaim {
    pub bounty_pool: Pubkey,                // Associated bounty pool
    pub milestone_id: u32,                  // Milestone being claimed
    pub contributor: Pubkey,                // Contributor claiming
    pub claimed_at: i64,                    // Claim timestamp
    pub status: ClaimStatus,                // Current claim status
    pub submission_url: Option<String>,     // Link to work submission
    pub rejection_reason: Option<String>,   // If rejected, why
    pub attempts: u8,                       // Number of submission attempts
    pub last_updated: i64,                  // Last status update
    pub bump: u8,                           // PDA bump seed
}

impl BountyClaim {
    pub const MAX_SUBMISSION_URL_LEN: usize = 256;
    pub const MAX_REJECTION_REASON_LEN: usize = 256;
    
    pub const LEN: usize = 8 +  // discriminator
        32 +                     // bounty_pool
        4 +                      // milestone_id
        32 +                     // contributor
        8 +                      // claimed_at
        1 +                      // status
        1 + 4 + Self::MAX_SUBMISSION_URL_LEN + // submission_url (Option)
        1 + 4 + Self::MAX_REJECTION_REASON_LEN + // rejection_reason (Option)
        1 +                      // attempts
        8 +                      // last_updated
        1;                       // bump
        
    pub fn can_submit(&self) -> bool {
        matches!(self.status, ClaimStatus::Active | ClaimStatus::Rejected)
    }
    
    pub fn can_approve(&self) -> bool {
        matches!(self.status, ClaimStatus::Submitted)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum ClaimStatus {
    Active,
    Submitted,
    Approved,
    Rejected,
    Expired,
    Paid,
}
