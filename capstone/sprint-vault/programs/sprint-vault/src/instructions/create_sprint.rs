use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::Sprint;
use crate::strategies::AccelerationType;
use crate::utils::{validate_time_range, validate_amount, get_current_time};

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
    end_time: i64,
    total_amount: u64,
    acceleration_type: Option<AccelerationType>,
) -> Result<()> {
    let current_time = get_current_time()?;
    
    // Validate inputs
    validate_time_range(start_time, end_time, current_time)?;
    validate_amount(total_amount)?;
    
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
    sprint.mint = ctx.accounts.mint.key();
    sprint.vault = ctx.accounts.vault.key();
    sprint.acceleration_type = acceleration_type.unwrap_or(AccelerationType::Quadratic); // Default to Quadratic
    sprint.bump = ctx.bumps.sprint;
    
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
