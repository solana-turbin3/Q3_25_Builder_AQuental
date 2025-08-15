use anchor_lang::prelude::*;
use crate::errors::BountyError;

#[account]
pub struct BountyPool {
    // Identity
    pub bounty_id: u64,                    // Unique identifier
    pub employer: Pubkey,                   // Employer who created the bounty
    
    // Vault Integration
    pub vault_escrow: Pubkey,               // Vault program's EscrowVault PDA
    pub vault_id: u64,                      // Vault ID in the Vault program
    
    // Configuration
    pub title: String,                      // Bounty title (max 64 chars)
    pub description_url: String,            // IPFS/Arweave URL for full description
    pub total_amount: u64,                  // Total bounty amount
    pub token_mint: Pubkey,                 // SPL token mint
    
    // Milestones
    pub milestones: Vec<BountyMilestone>,   // List of milestones
    pub current_milestone_index: u8,        // Currently active milestone
    
    // Sprint Integration (Optional)
    pub associated_sprint: Option<Pubkey>,  // Link to SprintVault sprint
    pub sprint_allocation: Option<u64>,     // Amount allocated from sprint
    
    // Status
    pub status: BountyStatus,               // Current bounty status
    pub created_at: i64,                    // Creation timestamp
    pub expires_at: Option<i64>,            // Optional expiration
    
    // Statistics
    pub total_claimed: u32,                 // Number of claims made
    pub total_completed: u32,               // Number of completed milestones
    pub total_paid_out: u64,                // Total amount paid to contributors
    
    // PDA
    pub bump: u8,                           // PDA bump seed
}

impl BountyPool {
    pub const MAX_TITLE_LEN: usize = 64;
    pub const MAX_DESCRIPTION_URL_LEN: usize = 256;
    pub const MAX_MILESTONES: usize = 20;
    
    pub const LEN: usize = 8 +  // discriminator
        8 +                      // bounty_id
        32 +                     // employer
        32 +                     // vault_escrow
        8 +                      // vault_id
        4 + Self::MAX_TITLE_LEN + // title
        4 + Self::MAX_DESCRIPTION_URL_LEN + // description_url
        8 +                      // total_amount
        32 +                     // token_mint
        4 + (Self::MAX_MILESTONES * BountyMilestone::LEN) + // milestones
        1 +                      // current_milestone_index
        1 + 32 +                 // associated_sprint (Option)
        1 + 8 +                  // sprint_allocation (Option)
        1 +                      // status
        8 +                      // created_at
        1 + 8 +                  // expires_at (Option)
        4 +                      // total_claimed
        4 +                      // total_completed
        8 +                      // total_paid_out
        1;                       // bump
        
    pub fn validate(&self) -> Result<()> {
        require!(
            self.title.len() <= Self::MAX_TITLE_LEN,
            BountyError::TitleTooLong
        );
        
        require!(
            !self.milestones.is_empty(),
            BountyError::NoMilestones
        );
        
        let milestone_sum: u64 = self.milestones
            .iter()
            .map(|m| m.amount)
            .sum();
            
        require!(
            milestone_sum == self.total_amount,
            BountyError::MilestoneAmountMismatch
        );
        
        Ok(())
    }
    
    pub fn get_milestone(&self, milestone_id: u32) -> Option<&BountyMilestone> {
        self.milestones.iter().find(|m| m.milestone_id == milestone_id)
    }
    
    pub fn get_milestone_mut(&mut self, milestone_id: u32) -> Option<&mut BountyMilestone> {
        self.milestones.iter_mut().find(|m| m.milestone_id == milestone_id)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BountyMilestone {
    pub milestone_id: u32,                  // Unique milestone ID
    pub description: String,                 // Brief description (max 128 chars)
    pub amount: u64,                        // Payment for this milestone
    pub git_criteria: GitCriteria,          // Git-based completion criteria
    pub status: MilestoneStatus,            // Current status
    pub assigned_to: Option<Pubkey>,        // Assigned contributor
    pub submitted_at: Option<i64>,          // Submission timestamp
    pub approved_at: Option<i64>,           // Approval timestamp
    pub evidence_url: Option<String>,       // Link to completion evidence
    pub vault_milestone_id: u32,            // Corresponding ID in Vault program
}

impl BountyMilestone {
    pub const MAX_DESCRIPTION_LEN: usize = 128;
    pub const MAX_EVIDENCE_URL_LEN: usize = 256;
    
    pub const LEN: usize = 
        4 +                      // milestone_id
        4 + Self::MAX_DESCRIPTION_LEN + // description
        8 +                      // amount
        GitCriteria::LEN +       // git_criteria
        1 +                      // status
        1 + 32 +                 // assigned_to (Option)
        1 + 8 +                  // submitted_at (Option)
        1 + 8 +                  // approved_at (Option)
        1 + 4 + Self::MAX_EVIDENCE_URL_LEN + // evidence_url (Option)
        4;                       // vault_milestone_id
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GitCriteria {
    pub criteria_type: GitCriteriaType,     // PR, Issue, Commit, etc.
    pub repository_url: String,             // Repository URL
    pub reference_id: String,                // PR#, Issue#, Commit SHA
    pub required_status: String,            // "merged", "closed", etc.
    pub is_required: bool,                  // Whether Git criteria is required
    pub is_satisfied: bool,                 // Whether criteria is satisfied
}

impl GitCriteria {
    pub const MAX_REPO_URL_LEN: usize = 128;
    pub const MAX_REFERENCE_LEN: usize = 64;
    pub const MAX_STATUS_LEN: usize = 32;
    
    pub const LEN: usize = 
        1 +                      // criteria_type
        4 + Self::MAX_REPO_URL_LEN + // repository_url
        4 + Self::MAX_REFERENCE_LEN + // reference_id
        4 + Self::MAX_STATUS_LEN + // required_status
        1 +                      // is_required
        1;                       // is_satisfied
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum GitCriteriaType {
    PullRequest,
    Issue,
    Commit,
    Branch,
    Tag,
    Custom,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum BountyStatus {
    Initialized,
    Active,
    InProgress,
    UnderReview,
    Completed,
    Cancelled,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum MilestoneStatus {
    Open,
    Assigned,
    Submitted,
    Approved,
    Rejected,
    Paid,
}

