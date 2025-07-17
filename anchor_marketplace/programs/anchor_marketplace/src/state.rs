use anchor_lang::prelude::*;

/// ---------------------------
/// DATA STRUCTURES
/// ---------------------------

#[account]
pub struct Marketplace {
    pub admin: Pubkey,
    pub name: String,
    pub fee: u16, // basis points
    pub treasury: Pubkey,
    pub bump: u8,
}

#[account]
pub struct Listing {
    pub maker: Pubkey,
    pub mint: Pubkey,
    pub price: u64,
}
