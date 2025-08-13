use anchor_lang::prelude::*;
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
        sprint.to_bytes().to_vec(),
    ]
}
