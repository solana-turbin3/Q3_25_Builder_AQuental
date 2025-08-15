use anchor_lang::prelude::*;

// Primary Escrow Vault Account
#[account]
pub struct EscrowVault {
    // Identity
    pub vault_id: u64,                      // Unique identifier
    pub owner_program: Pubkey,              // SprintVault or Bounty program
    pub owner_account: Pubkey,              // Sprint PDA or Bounty PDA
    
    // Participants
    pub depositor: Pubkey,                  // Employer who deposits funds
    pub beneficiary: Pubkey,                // Freelancer/Contributor who receives
    pub arbiter: Option<Pubkey>,            // Optional dispute resolver
    
    // Token Information
    pub token_mint: Pubkey,                 // SPL token mint
    pub vault_token_account: Pubkey,        // Associated token account
    
    // Amounts
    pub total_amount: u64,                  // Total deposited amount
    pub released_amount: u64,               // Amount already released
    pub refunded_amount: u64,               // Amount refunded to depositor
    pub locked_amount: u64,                 // Amount locked for disputes
    
    // Release Configuration
    pub release_schedule: ReleaseSchedule,  // How funds are released
    pub release_authority: ReleaseAuthority,// Who can trigger releases
    
    // Status
    pub status: EscrowStatus,               // Current vault status
    pub created_at: i64,                    // Creation timestamp
    pub updated_at: i64,                    // Last update timestamp
    pub expires_at: Option<i64>,            // Optional expiration
    
    // PDA
    pub bump: u8,                           // PDA bump seed
}

impl EscrowVault {
    pub const LEN: usize = 8 + // discriminator
        8 +                     // vault_id
        32 +                    // owner_program
        32 +                    // owner_account
        32 +                    // depositor
        32 +                    // beneficiary
        33 +                    // arbiter (Option)
        32 +                    // token_mint
        32 +                    // vault_token_account
        8 +                     // total_amount
        8 +                     // released_amount
        8 +                     // refunded_amount
        8 +                     // locked_amount
        1200 +                  // release_schedule (fixed size with MilestoneSet)
        33 +                    // release_authority
        2 +                     // status
        8 +                     // created_at
        8 +                     // updated_at
        9 +                     // expires_at (Option)
        1;                      // bump

    pub fn validate_owner_program(&self, program_id: &Pubkey) -> Result<()> {
        require!(
            self.owner_program == *program_id,
            VaultError::UnauthorizedProgram
        );
        Ok(())
    }

    pub fn validate_status(&self, expected: EscrowStatus) -> Result<()> {
        require!(
            self.status == expected,
            VaultError::InvalidStatus
        );
        Ok(())
    }

    pub fn can_withdraw(&self, signer: &Pubkey) -> Result<bool> {
        match self.release_authority {
            ReleaseAuthority::Beneficiary => Ok(signer == &self.beneficiary),
            ReleaseAuthority::Depositor => Ok(signer == &self.depositor),
            ReleaseAuthority::Either => Ok(signer == &self.beneficiary || signer == &self.depositor),
            ReleaseAuthority::Both => Ok(false), // Requires special handling
            ReleaseAuthority::Program(ref authorized) => Ok(signer == authorized),
            ReleaseAuthority::Arbiter => {
                if let Some(ref arbiter) = self.arbiter {
                    Ok(signer == arbiter)
                } else {
                    Ok(false)
                }
            }
        }
    }

    pub fn calculate_available(&self, current_time: i64) -> Result<u64> {
        // Validate status
        require!(
            self.status == EscrowStatus::Active || self.status == EscrowStatus::Funded,
            VaultError::InvalidStatus
        );

        // Check expiration
        if let Some(expires_at) = self.expires_at {
            require!(
                current_time <= expires_at,
                VaultError::VaultExpired
            );
        }

        // Calculate based on release schedule
        let available = match &self.release_schedule {
            ReleaseSchedule::Immediate => self.total_amount,
            
            ReleaseSchedule::Linear { start, end } => {
                if current_time < *start {
                    0
                } else if current_time >= *end {
                    self.total_amount
                } else {
                    let elapsed = (current_time - start) as u128;
                    let duration = (end - start) as u128;
                    let amount = (self.total_amount as u128)
                        .checked_mul(elapsed)
                        .ok_or(VaultError::ArithmeticOverflow)?
                        .checked_div(duration)
                        .ok_or(VaultError::ArithmeticOverflow)?;
                    amount as u64
                }
            },
            
            ReleaseSchedule::Milestone { conditions } => {
                let mut total = 0u64;
                for condition in conditions.iter() {
                    if condition.is_completed {
                        total = total.checked_add(condition.amount)
                            .ok_or(VaultError::ArithmeticOverflow)?;
                    }
                }
                total
            },
            
            ReleaseSchedule::Hybrid { 
                linear_portion, 
                milestone_portion, 
                linear_config, 
                milestone_config 
            } => {
                // Calculate linear portion
                let linear_available = if current_time < linear_config.start_time {
                    0
                } else if current_time >= linear_config.end_time {
                    *linear_portion
                } else {
                    let elapsed = (current_time - linear_config.start_time) as u128;
                    let duration = (linear_config.end_time - linear_config.start_time) as u128;
                    
                    let base_amount = match linear_config.acceleration_type {
                        AccelerationType::Linear => {
                            (*linear_portion as u128)
                                .checked_mul(elapsed)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(duration)
                                .ok_or(VaultError::ArithmeticOverflow)?
                        },
                        AccelerationType::Quadratic => {
                            let progress = elapsed
                                .checked_mul(10000)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(duration)
                                .ok_or(VaultError::ArithmeticOverflow)?;
                            let progress_squared = progress
                                .checked_mul(progress)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(10000)
                                .ok_or(VaultError::ArithmeticOverflow)?;
                            (*linear_portion as u128)
                                .checked_mul(progress_squared)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(10000)
                                .ok_or(VaultError::ArithmeticOverflow)?
                        },
                        AccelerationType::Cubic => {
                            let progress = elapsed
                                .checked_mul(1000)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(duration)
                                .ok_or(VaultError::ArithmeticOverflow)?;
                            let progress_cubed = progress
                                .checked_mul(progress)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(1000)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_mul(progress)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(1000)
                                .ok_or(VaultError::ArithmeticOverflow)?;
                            (*linear_portion as u128)
                                .checked_mul(progress_cubed)
                                .ok_or(VaultError::ArithmeticOverflow)?
                                .checked_div(1000)
                                .ok_or(VaultError::ArithmeticOverflow)?
                        }
                    };
                    
                    base_amount as u64
                };
                
                // Calculate milestone portion
                let mut milestone_available = 0u64;
                for condition in milestone_config.iter() {
                    if condition.is_completed {
                        milestone_available = milestone_available
                            .checked_add(condition.amount)
                            .ok_or(VaultError::ArithmeticOverflow)?;
                    }
                }
                
                linear_available.checked_add(milestone_available)
                    .ok_or(VaultError::ArithmeticOverflow)?
            },
            
            ReleaseSchedule::Custom { .. } => {
                // Not implemented in Phase 1/2
                return Err(VaultError::UnsupportedSchedule.into());
            }
        };

        // Subtract already released amount
        let withdrawable = available.saturating_sub(self.released_amount);
        
        // Account for locked amounts
        let effective_total = self.total_amount.saturating_sub(self.locked_amount);
        
        Ok(withdrawable.min(effective_total.saturating_sub(self.released_amount)))
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum ReleaseSchedule {
    Immediate,                              // Release on request
    Linear { 
        start: i64, 
        end: i64 
    },                                      // Time-based linear release
    Milestone { 
        conditions: MilestoneSet
    },                                      // Condition-based release
    Hybrid {
        linear_portion: u64,                // Amount for linear release
        milestone_portion: u64,              // Amount for milestone release
        linear_config: LinearConfig,
        milestone_config: MilestoneSet,
    },                                      // Combined linear + milestone
    Custom { 
        data: CustomData
    },                                      // For future extensions
}

// Wrapper type for milestone conditions to avoid stack issues
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct MilestoneSet {
    // Using fixed-size array with counter for efficiency
    pub conditions: [MilestoneCondition; 5],  // Max 5 milestones (reduced for stack)
    pub count: u8,                            // Actual number of milestones
}

impl MilestoneSet {
    pub fn new() -> Self {
        Self {
            conditions: [MilestoneCondition::default(); 5],
            count: 0,
        }
    }
    
    pub fn add(&mut self, condition: MilestoneCondition) -> Result<()> {
        require!(
            (self.count as usize) < 5,
            VaultError::InvalidMilestoneConfig
        );
        self.conditions[self.count as usize] = condition;
        self.count += 1;
        Ok(())
    }
    
    pub fn iter(&self) -> impl Iterator<Item = &MilestoneCondition> {
        self.conditions[..self.count as usize].iter()
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct MilestoneCondition {
    pub milestone_id: u32,
    pub amount: u64,
    pub required_approval: Pubkey,
    pub is_completed: bool,
}

impl Default for MilestoneCondition {
    fn default() -> Self {
        Self {
            milestone_id: 0,
            amount: 0,
            required_approval: Pubkey::default(),
            is_completed: false,
        }
    }
}

// Wrapper for custom data to avoid stack issues
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CustomData {
    pub data: [u8; 256],  // Fixed size for custom data
    pub len: u16,         // Actual length of data
}

impl Default for CustomData {
    fn default() -> Self {
        Self {
            data: [0u8; 256],
            len: 0,
        }
    }
}

impl CustomData {
    pub fn new(data: &[u8]) -> Result<Self> {
        require!(
            data.len() <= 256,
            VaultError::InvalidAmount
        );
        let mut custom_data = Self::default();
        custom_data.data[..data.len()].copy_from_slice(data);
        custom_data.len = data.len() as u16;
        Ok(custom_data)
    }
    
    pub fn as_slice(&self) -> &[u8] {
        &self.data[..self.len as usize]
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LinearConfig {
    pub start_time: i64,
    pub end_time: i64,
    pub acceleration_type: AccelerationType,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccelerationType {
    Linear,
    Quadratic,
    Cubic,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum ReleaseAuthority {
    Beneficiary,                            // Only beneficiary can withdraw
    Depositor,                              // Only depositor can release
    Either,                                 // Either party
    Both,                                   // Requires both signatures
    Program(Pubkey),                        // Specific program authority
    Arbiter,                                // Arbiter controls release
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum EscrowStatus {
    Initialized,                            // Created but not funded
    Funded,                                 // Funds deposited
    Active,                                 // Release schedule active
    Paused,                                 // Temporarily paused
    Completed,                              // All funds distributed
    Cancelled,                              // Cancelled and refunded
    Disputed,                               // Under dispute
}

// Escrow Configuration Account (Program-wide settings)
#[account]
pub struct EscrowConfig {
    pub authority: Pubkey,                  // Program authority
    pub fee_basis_points: u16,              // Platform fee (e.g., 100 = 1%)
    pub fee_recipient: Pubkey,              // Where fees go
    pub min_escrow_amount: u64,             // Minimum escrow size
    pub max_escrow_duration: i64,           // Maximum duration
    pub paused: bool,                       // Emergency pause
    pub version: u32,                       // Program version
    pub bump: u8,
}

impl EscrowConfig {
    pub const LEN: usize = 8 + // discriminator
        32 +                    // authority
        2 +                     // fee_basis_points
        32 +                    // fee_recipient
        8 +                     // min_escrow_amount
        8 +                     // max_escrow_duration
        1 +                     // paused
        4 +                     // version
        1;                      // bump

    pub fn is_compatible(&self, required_version: u32) -> Result<()> {
        require!(
            self.version >= required_version,
            VaultError::IncompatibleVersion
        );
        Ok(())
    }
}

// Custom errors for the Vault program
#[error_code]
pub enum VaultError {
    #[msg("Unauthorized program attempting to access vault")]
    UnauthorizedProgram,
    
    #[msg("Invalid vault status for this operation")]
    InvalidStatus,
    
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    
    #[msg("Vault has expired")]
    VaultExpired,
    
    #[msg("Unsupported release schedule")]
    UnsupportedSchedule,
    
    #[msg("Incompatible version")]
    IncompatibleVersion,
    
    #[msg("Insufficient funds in vault")]
    InsufficientFunds,
    
    #[msg("Unauthorized access")]
    Unauthorized,
    
    #[msg("Invalid amount")]
    InvalidAmount,
    
    #[msg("Invalid time range")]
    InvalidTimeRange,
    
    #[msg("Vault already funded")]
    AlreadyFunded,
    
    #[msg("Vault not funded")]
    NotFunded,
    
    #[msg("Program is paused")]
    ProgramPaused,
    
    #[msg("Milestone not found")]
    MilestoneNotFound,
    
    #[msg("Milestone already completed")]
    MilestoneAlreadyCompleted,
    
    #[msg("Invalid milestone configuration")]
    InvalidMilestoneConfig,
}
