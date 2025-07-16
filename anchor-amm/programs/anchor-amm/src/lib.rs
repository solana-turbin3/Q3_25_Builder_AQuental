// programs/amm/src/lib.rs
use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use errors::*;
use instructions::*;
use state::*;

declare_id!("7Jfk3eEeHhc93ndPv3g5GUMkZ353142Z1EfeJ8SxaVKm");

#[program]
pub mod amm {
    use super::*;

    /// Initialize a new liquidity pool with two tokens.
    pub fn initialize(
        ctx: Context<Initialize>,
        fee: u64, // Basis points (e.g. 30 = 0.3 %)
    ) -> Result<()> {
        instructions::initialize::handler(ctx, fee)
    }

    /// Deposit two tokens at the current ratio and receive LP tokens.
    pub fn deposit(ctx: Context<Deposit>, max_a: u64, max_b: u64) -> Result<()> {
        instructions::deposit::handler(ctx, max_a, max_b)
    }

    /// Burn LP tokens and withdraw your share of the two reserves.
    pub fn withdraw(ctx: Context<Withdraw>, lp_amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, lp_amount)
    }

    /// Swap token A for token B (or vice-versa) using the constant-product curve x*y=k.
    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_amount_out: u64) -> Result<()> {
        instructions::swap::handler(ctx, amount_in, min_amount_out)
    }
}
