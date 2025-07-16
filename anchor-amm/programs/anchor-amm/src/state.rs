// programs/amm/src/state.rs
use anchor_lang::prelude::*;

#[account]
pub struct Pool {
    pub token_a: Pubkey,    // Mint of token A
    pub token_b: Pubkey,    // Mint of token B
    pub reserve_a: u64,     // Raw amount of token A
    pub reserve_b: u64,     // Raw amount of token B
    pub lp_supply: u64,     // Total LP tokens minted
    pub fee: u64,           // Swap fee in basis points
    pub bump: u8,           // PDA bump
}

impl Pool {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1;
}
