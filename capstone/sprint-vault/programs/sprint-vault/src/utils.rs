use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, TokenAccount};
use crate::errors::SprintVaultError;

/// Validate that the time range is valid
pub fn validate_time_range(start_time: i64, end_time: i64, current_time: i64) -> Result<()> {
    // End time must be after start time
    if end_time <= start_time {
        return Err(error!(SprintVaultError::InvalidTimeRange));
    }
    
    // Start time must be in the future (or at least current)
    if start_time < current_time {
        msg!("Warning: Sprint start time is in the past");
    }
    
    Ok(())
}

/// Validate that the amount is valid
pub fn validate_amount(amount: u64) -> Result<()> {
    if amount == 0 {
        return Err(error!(SprintVaultError::InvalidAmount));
    }
    Ok(())
}

/// Get the current timestamp from Clock sysvar
pub fn get_current_time() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

/// Calculate the release rate (tokens per second)
pub fn calculate_release_rate(total_amount: u64, start_time: i64, end_time: i64) -> Result<u64> {
    let duration = end_time
        .checked_sub(start_time)
        .ok_or(SprintVaultError::MathOverflow)?;
    
    if duration == 0 {
        return Err(error!(SprintVaultError::InvalidTimeRange));
    }
    
    let rate = total_amount
        .checked_div(duration as u64)
        .ok_or(SprintVaultError::MathOverflow)?;
    
    Ok(rate)
}

/// Generate sprint seeds for PDA derivation
pub fn get_sprint_seeds<'a>(employer: &'a Pubkey, sprint_id: u64) -> Vec<Vec<u8>> {
    vec![
        b"sprint".to_vec(),
        employer.to_bytes().to_vec(),
        sprint_id.to_le_bytes().to_vec(),
    ]
}

/// Generate vault seeds for PDA derivation
pub fn get_vault_seeds<'a>(sprint: &'a Pubkey) -> Vec<Vec<u8>> {
    vec![
        b"vault".to_vec(),
        sprint.as_ref().to_vec(),
    ]
}

/// Validate token account is not frozen
pub fn validate_token_account_not_frozen(token_account: &Account<TokenAccount>) -> Result<()> {
    // Check if the token account is frozen
    // The SPL Token account has a state field that indicates if it's frozen
    // In SPL Token, the account state is stored as an enum:
    // - Uninitialized
    // - Initialized
    // - Frozen
    
    // Check if account is frozen by checking the state field
    // SPL Token accounts have the frozen state encoded in the account data
    // The state is at byte offset 108 in the token account data
    let account_info = token_account.to_account_info();
    let account_data = account_info.data.borrow();
    
    // For SPL Token accounts, check if frozen (state == 2)
    // The state field is at offset 108 and is 1 byte
    // 0 = Uninitialized, 1 = Initialized, 2 = Frozen
    if account_data.len() > 108 {
        let state = account_data[108];
        require!(
            state != 2, // 2 represents Frozen state
            SprintVaultError::FrozenTokenAccount
        );
    }
    
    // Also ensure the account is initialized and has valid data
    require!(
        token_account.owner != Pubkey::default(),
        SprintVaultError::FrozenTokenAccount
    );
    
    Ok(())
}

/// Validate mint decimals match expected value
pub fn validate_mint_decimals(mint: &Account<Mint>, expected_decimals: u8) -> Result<()> {
    require!(
        mint.decimals == expected_decimals,
        SprintVaultError::InvalidTokenDecimals
    );
    Ok(())
}

/// Get network cluster from environment
pub fn get_network_cluster() -> NetworkCluster {
    // In production, this would detect the actual network
    // For now, we'll use a feature flag or environment variable
    #[cfg(feature = "mainnet")]
    return NetworkCluster::Mainnet;
    
    #[cfg(feature = "devnet")]
    return NetworkCluster::Devnet;
    
    // Default to localnet for testing
    NetworkCluster::Localnet
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum NetworkCluster {
    Mainnet,
    Devnet,
    Testnet,
    Localnet,
}

/// Validate mint is appropriate for the current network
pub fn validate_mint_for_network(mint: &Pubkey) -> Result<()> {
    use crate::constants::*;
    
    let cluster = get_network_cluster();
    
    match cluster {
        NetworkCluster::Mainnet => {
            // On mainnet, only accept mainnet mints
            require!(
                *mint == USDC_MINT || *mint == USDT_MINT || *mint == WSOL_MINT,
                SprintVaultError::InvalidNetworkMint
            );
        },
        NetworkCluster::Devnet => {
            // On devnet, accept devnet test tokens
            require!(
                *mint == USDC_MINT_DEVNET || *mint == WSOL_MINT,
                SprintVaultError::InvalidNetworkMint
            );
        },
        NetworkCluster::Localnet => {
            // On localnet, allow any mint for testing
            msg!("Localnet: Allowing any mint for testing");
        },
        _ => {
            // On testnet, accept any supported mint
            require!(
                is_supported_mint(mint),
                SprintVaultError::UnsupportedMint
            );
        }
    }
    
    Ok(())
}

/// Calculate dust threshold based on token decimals
pub fn get_dust_threshold(decimals: u8) -> u64 {
    // Dust is defined as less than 0.0001 of the base unit
    // For 6 decimals: 100 (0.0001 USDC)
    // For 9 decimals: 100000 (0.0001 SOL)
    match decimals {
        6 => 100,       // 0.0001 USDC
        9 => 100_000,   // 0.0001 SOL
        _ => 10_u64.pow(decimals as u32 - 4), // Dynamic calculation
    }
}

/// Check if amount is considered dust
pub fn is_dust_amount(amount: u64, decimals: u8) -> bool {
    amount > 0 && amount < get_dust_threshold(decimals)
}

/// Round amount to avoid precision issues
pub fn round_amount_for_precision(amount: u64, decimals: u8) -> u64 {
    // Round to nearest 0.000001 for 6 decimals
    // This prevents accumulation of rounding errors
    let precision_factor = 10_u64.pow(decimals.saturating_sub(6) as u32);
    if precision_factor > 1 {
        (amount / precision_factor) * precision_factor
    } else {
        amount
    }
}
