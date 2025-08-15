use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::BountyError;

// Import Vault program types
use vault::cpi::accounts::CloseEscrow;
use vault::program::Vault;
use vault::state::EscrowVault;

#[derive(Accounts)]
pub struct CancelBounty<'info> {
    #[account(
        mut,
        seeds = [b"bounty_pool", bounty_pool.employer.as_ref(), bounty_pool.bounty_id.to_le_bytes().as_ref()],
        bump = bounty_pool.bump,
        close = employer
    )]
    pub bounty_pool: Account<'info, BountyPool>,
    
    #[account(
        mut,
        seeds = [b"bounty_vault_config", bounty_pool.key().as_ref()],
        bump = vault_config.bump,
        close = employer
    )]
    pub vault_config: Account<'info, BountyVaultConfig>,
    
    #[account(
        mut,
        constraint = vault_escrow.key() == vault_config.vault_escrow @ BountyError::VaultNotInitialized
    )]
    pub vault_escrow: Account<'info, EscrowVault>,
    
    #[account(
        mut,
        constraint = employer.key() == bounty_pool.employer @ BountyError::Unauthorized
    )]
    pub employer: Signer<'info>,
    
    #[account(
        mut,
        constraint = employer_token_account.owner == employer.key(),
        constraint = employer_token_account.mint == bounty_pool.token_mint
    )]
    pub employer_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: Vault token account validated by Vault program
    #[account(mut)]
    pub vault_token_account: UncheckedAccount<'info>,
    
    pub vault_program: Program<'info, Vault>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(ctx: Context<CancelBounty>) -> Result<()> {
    let bounty_pool = &ctx.accounts.bounty_pool;
    
    // Check no milestones are under review
    let has_pending_reviews = bounty_pool.milestones
        .iter()
        .any(|m| m.status == MilestoneStatus::Submitted);
    
    require!(
        !has_pending_reviews,
        BountyError::PendingReviews
    );
    
    // Check bounty is not already completed or cancelled
    require!(
        bounty_pool.status != BountyStatus::Completed &&
        bounty_pool.status != BountyStatus::Cancelled,
        BountyError::InvalidBountyStatus
    );
    
    // Prepare signer seeds for CPI
    let bounty_id_bytes = bounty_pool.bounty_id.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"bounty_pool",
        bounty_pool.employer.as_ref(),
        &bounty_id_bytes,
        &[bounty_pool.bump],
    ]];
    
    // CPI to Vault program to close escrow and refund
    let cpi_accounts = CloseEscrow {
        escrow_vault: ctx.accounts.vault_escrow.to_account_info(),
        vault_token_account: ctx.accounts.vault_token_account.to_account_info(),
        depositor: ctx.accounts.employer.to_account_info(),
        depositor_token_account: ctx.accounts.employer_token_account.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.vault_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    
    vault::cpi::close_escrow(cpi_ctx)?;
    
    msg!("Bounty cancelled and funds refunded to employer");
    
    Ok(())
}

