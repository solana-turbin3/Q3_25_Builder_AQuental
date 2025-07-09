use anchor_client::solana_sdk::pubkey::Pubkey;
use anchor_lang::prelude::*;
use anchor_lang::AnchorDeserialize;

declare_id!("TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM");

#[program]
pub mod q3_pre_reqs_rs {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, github: String) -> Result<()> {
        Ok(())
    }

    pub fn submit_rs(ctx: Context<SubmitRs>) -> Result<()> {
        Ok(())
    }

    pub fn submit_ts(ctx: Context<SubmitTs>) -> Result<()> {
        Ok(())
    }

    pub fn update(ctx: Context<Update>, github: String) -> Result<()> {
        Ok(())
    }

    pub fn close(ctx: Context<Close>) -> Result<()> {
        Ok(())
    }

    pub fn create_collection(ctx: Context<CreateCollection>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut, signer)]
    pub user: Signer<'info>,
    #[account(
        init,
        payer = user,
        space = 8 + 32 + 1 + 1 + 1 + 4 + 64, // discriminator + pubkey + u8 + bool + bool + string length + string
        seeds = [b"prereqs", user.key().as_ref()],
        bump
    )]
    pub account: Account<'info, ApplicationAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitRs<'info> {
    #[account(mut, signer)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"prereqs", user.key().as_ref()],
        bump = account.bump
    )]
    pub account: Account<'info, ApplicationAccount>,
    #[account(mut, signer)]
    pub mint: Signer<'info>,
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: Authority PDA
    #[account(
        seeds = [b"collection", collection.key().as_ref()],
        bump,
        seeds::program = mpl_core_program.key()
    )]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: MPL Core program
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitTs<'info> {
    #[account(mut, signer)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"prereqs", user.key().as_ref()],
        bump = account.bump
    )]
    pub account: Account<'info, ApplicationAccount>,
    #[account(mut, signer)]
    pub mint: Signer<'info>,
    #[account(mut)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: Authority PDA
    #[account(
        seeds = [b"collection", collection.key().as_ref()],
        bump,
        seeds::program = mpl_core_program.key()
    )]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: MPL Core program
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Update<'info> {
    #[account(mut, signer)]
    pub user: Signer<'info>,
    #[account(
        seeds = [b"prereqs", user.key().as_ref()],
        bump = account.bump
    )]
    pub account: Account<'info, ApplicationAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        close = user,
        seeds = [b"prereqs", user.key().as_ref()],
        bump = account.bump
    )]
    pub account: Account<'info, ApplicationAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateCollection<'info> {
    #[account(mut, signer)]
    pub creator: Signer<'info>,
    #[account(mut, signer)]
    pub collection: Signer<'info>,
    /// CHECK: Authority PDA
    #[account(
        seeds = [b"collection", collection.key().as_ref()],
        bump,
        seeds::program = mpl_core_program.key()
    )]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: MPL Core program
    #[account(address = mpl_core::ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct ApplicationAccount {
    pub user: Pubkey,
    pub bump: u8,
    pub pre_req_ts: bool,
    pub pre_req_rs: bool,
    pub github: String,
}

// MPL Core program ID
pub mod mpl_core {
    use anchor_lang::prelude::*;
    declare_id!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
}

#[error_code]
pub enum ErrorCode {
    #[msg("TS submission not completed.")]
    PreReqTsNotCompleted = 6000,
    #[msg("TS submission already completed.")]
    PreReqTsAlreadyCompleted = 6001,
    #[msg("Rust submission already completed.")]
    PreReqRsAlreadyCompleted = 6002,
    #[msg("Submission not allowed.")]
    PreReqRsNotInTimeWindow = 6003,
}
