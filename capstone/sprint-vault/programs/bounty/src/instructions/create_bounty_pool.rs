use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::BountyError;

// Import Vault program types
use vault::state::{ReleaseSchedule, ReleaseAuthority, MilestoneCondition as VaultMilestone};
use vault::cpi::accounts::CreateEscrow;
use vault::program::Vault;

#[derive(Accounts)]
#[instruction(bounty_id: u64, vault_id: u64)]
pub struct CreateBountyPool<'info> {
    #[account(
        init,
        payer = employer,
        space = BountyPool::LEN,
        seeds = [b"bounty_pool", employer.key().as_ref(), bounty_id.to_le_bytes().as_ref()],
        bump
    )]
    pub bounty_pool: Account<'info, BountyPool>,
    
    #[account(
        init,
        payer = employer,
        space = BountyVaultConfig::LEN,
        seeds = [b"bounty_vault_config", bounty_pool.key().as_ref()],
        bump
    )]
    pub vault_config: Account<'info, BountyVaultConfig>,
    
    /// CHECK: This will be initialized by the Vault program
    #[account(
        mut,
        seeds = [
            b"escrow_vault",
            crate::id().as_ref(),
            bounty_pool.key().as_ref(),
            vault_id.to_le_bytes().as_ref()
        ],
        bump,
        seeds::program = vault_program.key()
    )]
    pub vault_escrow: UncheckedAccount<'info>,
    
    /// CHECK: Vault token account will be created by Vault program
    pub vault_token_account: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub employer: Signer<'info>,
    
    pub token_mint: Account<'info, Mint>,
    
    /// CHECK: The Bounty program itself
    pub bounty_program: UncheckedAccount<'info>,
    
    /// CHECK: Vault program's config account
    pub vault_config_account: UncheckedAccount<'info>,
    
    pub vault_program: Program<'info, Vault>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreateBountyPool>,
    bounty_id: u64,
    vault_id: u64,
    title: String,
    description_url: String,
    total_amount: u64,
    milestones: Vec<MilestoneInput>,
    associated_sprint: Option<Pubkey>,
    expires_at: Option<i64>,
    arbiter: Option<Pubkey>,
) -> Result<()> {
    let bounty_pool = &mut ctx.accounts.bounty_pool;
    let vault_config = &mut ctx.accounts.vault_config;
    let clock = Clock::get()?;
    
    // Validate inputs
    require!(
        title.len() <= BountyPool::MAX_TITLE_LEN,
        BountyError::TitleTooLong
    );
    
    require!(
        !milestones.is_empty(),
        BountyError::NoMilestones
    );
    
    let milestone_sum: u64 = milestones.iter().map(|m| m.amount).sum();
    require!(
        milestone_sum == total_amount,
        BountyError::MilestoneAmountMismatch
    );
    
    if let Some(exp) = expires_at {
        require!(
            exp > clock.unix_timestamp,
            BountyError::BountyExpired
        );
    }
    
    // Initialize bounty pool
    bounty_pool.bounty_id = bounty_id;
    bounty_pool.employer = ctx.accounts.employer.key();
    bounty_pool.vault_escrow = ctx.accounts.vault_escrow.key();
    bounty_pool.vault_id = vault_id;
    bounty_pool.title = title;
    bounty_pool.description_url = description_url;
    bounty_pool.total_amount = total_amount;
    bounty_pool.token_mint = ctx.accounts.token_mint.key();
    bounty_pool.milestones = milestones.iter().enumerate().map(|(i, m)| {
        BountyMilestone {
            milestone_id: m.milestone_id,
            description: m.description.clone(),
            amount: m.amount,
            git_criteria: m.git_criteria.clone(),
            status: MilestoneStatus::Open,
            assigned_to: None,
            submitted_at: None,
            approved_at: None,
            evidence_url: None,
            vault_milestone_id: i as u32,
        }
    }).collect();
    bounty_pool.current_milestone_index = 0;
    bounty_pool.associated_sprint = associated_sprint;
    bounty_pool.sprint_allocation = None;
    bounty_pool.status = BountyStatus::Initialized;
    bounty_pool.created_at = clock.unix_timestamp;
    bounty_pool.expires_at = expires_at;
    bounty_pool.total_claimed = 0;
    bounty_pool.total_completed = 0;
    bounty_pool.total_paid_out = 0;
    bounty_pool.bump = ctx.bumps.bounty_pool;
    
    // Initialize vault config
    vault_config.bounty_pool = bounty_pool.key();
    vault_config.vault_program = ctx.accounts.vault_program.key();
    vault_config.vault_escrow = ctx.accounts.vault_escrow.key();
    vault_config.total_deposited = 0;
    vault_config.total_withdrawn = 0;
    vault_config.pending_releases = vec![];
    vault_config.last_sync = clock.unix_timestamp;
    vault_config.bump = ctx.bumps.vault_config;
    
    // Create milestone-based release schedule for Vault
    let vault_milestones: Vec<VaultMilestone> = milestones.iter().enumerate().map(|(i, m)| {
        VaultMilestone {
            milestone_id: i as u32,
            amount: m.amount,
            required_approval: bounty_pool.key(),
            is_completed: false,
        }
    }).collect();
    
    let release_schedule = ReleaseSchedule::Milestone {
        conditions: Box::new(vault_milestones),
    };
    
    // CPI to Vault program to create escrow
    let cpi_accounts = CreateEscrow {
        escrow_vault: ctx.accounts.vault_escrow.to_account_info(),
        vault_token_account: ctx.accounts.vault_token_account.to_account_info(),
        config: ctx.accounts.vault_config_account.to_account_info(),
        depositor: ctx.accounts.employer.to_account_info(),
        beneficiary: bounty_pool.to_account_info(),
        owner_program: ctx.accounts.bounty_program.to_account_info(),
        owner_account: bounty_pool.to_account_info(),
        token_mint: ctx.accounts.token_mint.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new(
        ctx.accounts.vault_program.to_account_info(),
        cpi_accounts,
    );
    
    vault::cpi::create_escrow(
        cpi_ctx,
        vault_id,
        total_amount,
        release_schedule,
        ReleaseAuthority::Program(bounty_pool.key()),
        expires_at,
        arbiter,
    )?;
    
    msg!("Bounty pool created with ID: {}", bounty_id);
    msg!("Vault escrow initialized with ID: {}", vault_id);
    
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct MilestoneInput {
    pub milestone_id: u32,
    pub description: String,
    pub amount: u64,
    pub git_criteria: GitCriteria,
}
