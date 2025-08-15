use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::BountyError;

// Import Vault program types
use vault::cpi::accounts::DepositFunds;
use vault::program::Vault;
use vault::state::EscrowVault;

#[derive(Accounts)]
pub struct FundBounty<'info> {
    #[account(
        mut,
        seeds = [b"bounty_pool", bounty_pool.employer.as_ref(), bounty_pool.bounty_id.to_le_bytes().as_ref()],
        bump = bounty_pool.bump
    )]
    pub bounty_pool: Account<'info, BountyPool>,
    
    #[account(
        mut,
        seeds = [b"bounty_vault_config", bounty_pool.key().as_ref()],
        bump = vault_config.bump
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
    
    /// CHECK: Vault program's config account
    pub vault_config_account: UncheckedAccount<'info>,
    
    pub vault_program: Program<'info, Vault>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handler(ctx: Context<FundBounty>, amount: u64) -> Result<()> {
    let bounty_pool = &mut ctx.accounts.bounty_pool;
    let vault_config = &mut ctx.accounts.vault_config;
    
    // Validate amount
    require!(
        amount > 0,
        BountyError::InvalidAmount
    );
    
    // Check if funding amount doesn't exceed what's needed
    let remaining_to_fund = bounty_pool.total_amount
        .checked_sub(vault_config.total_deposited)
        .ok_or(BountyError::ArithmeticOverflow)?;
    
    require!(
        amount <= remaining_to_fund,
        BountyError::ExcessiveFunding
    );
    
    // CPI to Vault program to deposit funds
    let cpi_accounts = DepositFunds {
        escrow_vault: ctx.accounts.vault_escrow.to_account_info(),
        vault_token_account: ctx.accounts.vault_token_account.to_account_info(),
        depositor: ctx.accounts.employer.to_account_info(),
        depositor_token_account: ctx.accounts.employer_token_account.to_account_info(),
        config: ctx.accounts.vault_config_account.to_account_info(),
        token_program: ctx.accounts.token_program.to_account_info(),
        associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
    };
    
    let cpi_ctx = CpiContext::new(
        ctx.accounts.vault_program.to_account_info(),
        cpi_accounts,
    );
    
    vault::cpi::deposit_funds(cpi_ctx, amount)?;
    
    // Update vault config
    vault_config.total_deposited = vault_config.total_deposited
        .checked_add(amount)
        .ok_or(BountyError::ArithmeticOverflow)?;
    
    // Update bounty status if fully funded
    if vault_config.total_deposited == bounty_pool.total_amount {
        bounty_pool.status = BountyStatus::Active;
        msg!("Bounty pool fully funded and activated");
    }
    
    msg!("Deposited {} tokens to bounty vault", amount);
    msg!("Total deposited: {}/{}", vault_config.total_deposited, bounty_pool.total_amount);
    
    Ok(())
}
