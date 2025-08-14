use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::{Sprint, SprintDuration};
use crate::strategies::AccelerationType;
use crate::utils::{validate_time_range, validate_amount, get_current_time, validate_mint_for_network, validate_mint_decimals};
use crate::constants::is_supported_mint;
use crate::errors::SprintVaultError;

#[derive(Accounts)]
#[instruction(sprint_id: u64)]
pub struct CreateSprint<'info> {
    #[account(
        init,
        payer = employer,
        space = Sprint::LEN,
        seeds = [b"sprint", employer.key().as_ref(), sprint_id.to_le_bytes().as_ref()],
        bump
    )]
    pub sprint: Account<'info, Sprint>,
    
    #[account(
        init,
        payer = employer,
        associated_token::mint = mint,
        associated_token::authority = sprint,
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub employer: Signer<'info>,
    
    /// CHECK: We're just storing the freelancer's pubkey
    pub freelancer: UncheckedAccount<'info>,
    
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(
    ctx: Context<CreateSprint>,
    sprint_id: u64,
    start_time: i64,
    sprint_duration: SprintDuration,
    total_amount: u64,
    acceleration_type: Option<AccelerationType>,
) -> Result<()> {
    let current_time = get_current_time()?;
    
    // Calculate end time from sprint duration
    let duration_seconds = sprint_duration.to_seconds();
    let end_time = start_time.checked_add(duration_seconds)
        .ok_or(error!(SprintVaultError::MathOverflow))?;
    
    // Validate inputs
    validate_time_range(start_time, end_time, current_time)?;
    validate_amount(total_amount)?;
    
    msg!(
        "Sprint duration: {} ({} days)",
        sprint_duration.description(),
        sprint_duration.to_days()
    );
    
    // Validate that the mint is supported
    let mint_key = ctx.accounts.mint.key();
    // On localnet, allow any mint for testing purposes
    let cluster = crate::utils::get_network_cluster();
    if cluster != crate::utils::NetworkCluster::Localnet {
        if !is_supported_mint(&mint_key) {
            return Err(error!(SprintVaultError::UnsupportedMint));
        }
    } else {
        msg!("Localnet: Allowing any mint for testing");
    }
    
    // Validate mint for current network
    validate_mint_for_network(&mint_key)?;
    
    // Validate mint decimals (6 for USDC/USDT, 9 for SOL)
    // Skip validation on localnet for testing
    if cluster != crate::utils::NetworkCluster::Localnet {
        let expected_decimals = if mint_key == crate::constants::WSOL_MINT { 9 } else { 6 };
        validate_mint_decimals(&ctx.accounts.mint, expected_decimals)?;
    } else {
        msg!("Localnet: Allowing any mint decimals ({})", ctx.accounts.mint.decimals);
    }
    
    // Prevent negative timestamps
    require!(
        start_time > 0 && end_time > 0,
        SprintVaultError::InvalidTimestamp
    );
    
    // Prevent year 2038 problem (use reasonable bounds)
    require!(
        end_time < i64::MAX / 2, // Well below i64::MAX
        SprintVaultError::InvalidTimestamp
    );
    
    // Initialize the sprint account
    let sprint = &mut ctx.accounts.sprint;
    sprint.employer = ctx.accounts.employer.key();
    sprint.freelancer = ctx.accounts.freelancer.key();
    sprint.sprint_id = sprint_id;
    sprint.start_time = start_time;
    sprint.end_time = end_time;
    sprint.total_amount = total_amount;
    sprint.withdrawn_amount = 0;
    sprint.is_paused = false;
    sprint.pause_time = None;
    sprint.total_paused_duration = 0;
    sprint.pause_resume_count = 0;
    sprint.last_operation_slot = 0; // Initialize to 0
    sprint.accumulated_dust = 0; // Initialize to 0
    sprint.mint = ctx.accounts.mint.key();
    sprint.vault = ctx.accounts.vault.key();
    sprint.acceleration_type = acceleration_type.unwrap_or(AccelerationType::Quadratic); // Default to Quadratic
    sprint.bump = ctx.bumps.sprint;
    sprint.is_funded = false; // Sprint starts unfunded
    
    msg!(
        "Sprint created: ID={}, employer={}, freelancer={}, amount={}, acceleration={:?}",
        sprint_id,
        ctx.accounts.employer.key(),
        ctx.accounts.freelancer.key(),
        total_amount,
        sprint.acceleration_type
    );
    
    Ok(())
}
