use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::state::{Listing, Marketplace};

/// ---------------------------
/// ACCOUNT CONTEXTS
/// ---------------------------

#[derive(Accounts)]
#[instruction(name: String, fee: u16)]
pub struct Initialize<'info> {
    #[account(
        init,
        seeds = [b"marketplace", name.as_bytes()],
        bump,
        payer = admin,
        space = 8 + 32 + (4 + 50) + 2 + 32 + 1 // 8 + 32 + 54 + 2 + 32 + 1 = 129 bytes
    )]
    pub marketplace: Account<'info, Marketplace>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: treasury is just a pubkey
    pub treasury: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct List<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    #[account(mut)]
    pub maker_mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = maker_mint,
        associated_token::authority = maker,
    )]
    pub maker_ata: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = maker,
        associated_token::mint = maker_mint,
        associated_token::authority = marketplace,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init,
        seeds = [b"listing", maker_mint.key().as_ref()],
        bump,
        payer = maker,
        space = 8 + 32 + 32 + 8
    )]
    pub listing: Account<'info, Listing>,
    #[account(
        seeds = [b"marketplace", marketplace.name.as_bytes()],
        bump = marketplace.bump,
    )]
    pub marketplace: Account<'info, Marketplace>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Purchase<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    /// CHECK: This is the maker account that will receive SOL payments
    pub maker: AccountInfo<'info>, // receives SOL
    #[account(mut)]
    pub maker_mint: Account<'info, Mint>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        close = maker, // SOL rent to maker
        seeds = [b"listing", maker_mint.key().as_ref()],
        bump,
    )]
    pub listing: Account<'info, Listing>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = maker_mint,
        associated_token::authority = buyer,
    )]
    pub taker_ata: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"marketplace", marketplace.name.as_bytes()],
        bump = marketplace.bump,
    )]
    pub marketplace: Account<'info, Marketplace>,
    #[account(mut)]
    /// CHECK: This is the treasury account that will receive fees
    pub treasury: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Delist<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    #[account(mut)]
    pub maker_mint: Account<'info, Mint>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub maker_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        close = maker,
        seeds = [b"listing", maker_mint.key().as_ref()],
        bump,
    )]
    pub listing: Account<'info, Listing>,
    #[account(
        seeds = [b"marketplace", marketplace.name.as_bytes()],
        bump = marketplace.bump,
    )]
    pub marketplace: Account<'info, Marketplace>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}
