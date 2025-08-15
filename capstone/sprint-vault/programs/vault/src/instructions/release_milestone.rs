use anchor_lang::prelude::*;
use crate::state::*;

#[derive(Accounts)]
pub struct ReleaseMilestone<'info> {
    #[account(
        mut,
        seeds = [
            b"escrow_vault",
            escrow_vault.owner_program.as_ref(),
            escrow_vault.vault_id.to_le_bytes().as_ref()
        ],
        bump = escrow_vault.bump
    )]
    pub escrow_vault: Account<'info, EscrowVault>,
    
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<ReleaseMilestone>, milestone_id: u32) -> Result<()> {
    let escrow = &mut ctx.accounts.escrow_vault;
    let clock = Clock::get()?;
    
    // Validate status
    require!(
        escrow.status == EscrowStatus::Active || escrow.status == EscrowStatus::Funded,
        VaultError::InvalidStatus
    );
    
    // Find and update the milestone
    let mut found = false;
    let mut already_completed = false;
    
    match &mut escrow.release_schedule {
        ReleaseSchedule::Milestone { conditions } => {
            for i in 0..conditions.count as usize {
                if conditions.conditions[i].milestone_id == milestone_id {
                    found = true;
                    
                    // Check if already completed
                    if conditions.conditions[i].is_completed {
                        already_completed = true;
                        break;
                    }
                    
                    // Verify authority
                    require!(
                        ctx.accounts.authority.key() == conditions.conditions[i].required_approval,
                        VaultError::Unauthorized
                    );
                    
                    // Mark as completed
                    conditions.conditions[i].is_completed = true;
                    break;
                }
            }
        },
        ReleaseSchedule::Hybrid { milestone_config, .. } => {
            for i in 0..milestone_config.count as usize {
                if milestone_config.conditions[i].milestone_id == milestone_id {
                    found = true;
                    
                    // Check if already completed
                    if milestone_config.conditions[i].is_completed {
                        already_completed = true;
                        break;
                    }
                    
                    // Verify authority
                    require!(
                        ctx.accounts.authority.key() == milestone_config.conditions[i].required_approval,
                        VaultError::Unauthorized
                    );
                    
                    // Mark as completed
                    milestone_config.conditions[i].is_completed = true;
                    break;
                }
            }
        },
        _ => {
            return Err(VaultError::InvalidMilestoneConfig.into());
        }
    }
    
    require!(found, VaultError::MilestoneNotFound);
    require!(!already_completed, VaultError::MilestoneAlreadyCompleted);
    
    escrow.updated_at = clock.unix_timestamp;
    
    msg!("Milestone {} released for vault {}", milestone_id, escrow.vault_id);
    
    Ok(())
}
