use anchor_lang::prelude::*;
use crate::errors::BountyError;
#[account]
pub struct BountyVaultConfig {
    pub bounty_pool: Pubkey,                // Associated bounty pool
    pub vault_program: Pubkey,              // Vault program ID
    pub vault_escrow: Pubkey,               // Vault's EscrowVault account
    pub total_deposited: u64,               // Total funds sent to vault
    pub total_withdrawn: u64,               // Total withdrawn from vault
    pub pending_releases: Vec<PendingRelease>, // Pending milestone releases
    pub last_sync: i64,                     // Last sync with vault
    pub bump: u8,                           // PDA bump seed
}

impl BountyVaultConfig {
    pub const MAX_PENDING_RELEASES: usize = 10;
    
    pub const LEN: usize = 8 +  // discriminator
        32 +                     // bounty_pool
        32 +                     // vault_program
        32 +                     // vault_escrow
        8 +                      // total_deposited
        8 +                      // total_withdrawn
        4 + (Self::MAX_PENDING_RELEASES * PendingRelease::LEN) + // pending_releases
        8 +                      // last_sync
        1;                       // bump
        
    pub fn add_pending_release(&mut self, release: PendingRelease) -> Result<()> {
        require!(
            self.pending_releases.len() < Self::MAX_PENDING_RELEASES,
            BountyError::TooManyPendingReleases
        );
        self.pending_releases.push(release);
        Ok(())
    }
    
    pub fn remove_pending_release(&mut self, milestone_id: u32) {
        self.pending_releases.retain(|r| r.milestone_id != milestone_id);
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PendingRelease {
    pub milestone_id: u32,
    pub amount: u64,
    pub beneficiary: Pubkey,
    pub requested_at: i64,
}

impl PendingRelease {
    pub const LEN: usize = 
        4 +                      // milestone_id
        8 +                      // amount
        32 +                     // beneficiary
        8;                       // requested_at
}

