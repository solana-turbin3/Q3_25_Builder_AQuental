use anchor_lang::prelude::*;

/// Maximum number of pause/resume cycles allowed per sprint
pub const MAX_PAUSE_RESUME_COUNT: u8 = 3;

/// Minimum withdrawal amount in the smallest unit (6 decimals for USDC/USDT)
/// 10 USDC = 10_000_000 (10 * 10^6)
pub const MIN_WITHDRAWAL_AMOUNT_USDC: u64 = 10_000_000;

/// Minimum withdrawal amount in lamports for SOL
/// 0.01 SOL = 10_000_000 lamports (equivalent value to 10 USDC at ~$1000/SOL)
pub const MIN_WITHDRAWAL_AMOUNT_SOL: u64 = 10_000_000;

/// USDC Mint on Mainnet
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/// USDT Mint on Mainnet  
pub const USDT_MINT: Pubkey = pubkey!("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

/// USDC Mint on Devnet (for testing)
pub const USDC_MINT_DEVNET: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

/// Native SOL Mint
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

/// Check if a mint is supported
pub fn is_supported_mint(mint: &Pubkey) -> bool {
    *mint == USDC_MINT || 
    *mint == USDT_MINT || 
    *mint == USDC_MINT_DEVNET || 
    *mint == WSOL_MINT
}

/// Get minimum withdrawal amount for a mint
pub fn get_min_withdrawal_amount(mint: &Pubkey) -> u64 {
    if *mint == WSOL_MINT {
        MIN_WITHDRAWAL_AMOUNT_SOL
    } else {
        MIN_WITHDRAWAL_AMOUNT_USDC
    }
}
