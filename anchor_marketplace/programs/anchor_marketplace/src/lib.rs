// lib.rs
use anchor_lang::prelude::*;
use anchor_spl::{
    token::{self, CloseAccount, Transfer},
};

declare_id!("Rc55Bpvuafwv7MAz2ux7LdGYbr5jprezrW5h2vU2Vf6");

// Module declarations
mod constants;
mod contexts;
mod state;

// Public re-exports
pub use constants::*;
pub use contexts::*;
pub use state::*;

#[program]
pub mod anchor_marketplace {
    use super::*;

    /// ----------------------------------------------------------
    /// 1. INITIALIZE GLOBAL MARKETPLACE
    /// ----------------------------------------------------------
    /// Creates the global `Marketplace` PDA that stores global
    /// state such as the fee (basis points) and treasury.
    pub fn initialize(ctx: Context<Initialize>, name: String, fee: u16) -> Result<()> {
        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.admin = ctx.accounts.admin.key();
        marketplace.name = name;
        // Enforce minimum and maximum fee
        marketplace.fee = if fee < MIN_MARKETPLACE_FEE {
            MIN_MARKETPLACE_FEE
        } else if fee > MAX_MARKETPLACE_FEE {
            MAX_MARKETPLACE_FEE
        } else {
            fee
        };
        marketplace.treasury = ctx.accounts.treasury.key();
        marketplace.bump = ctx.bumps.marketplace;
        Ok(())
    }

    /// ----------------------------------------------------------
    /// 2. LIST A DIGITAL GOOD
    /// ----------------------------------------------------------
    /// Transfers the NFT/SPL token into an escrow vault
    /// and creates a `Listing` PDA with the desired price.
    pub fn list(
        ctx: Context<List>,
        price: u64, // lamports
    ) -> Result<()> {
        let listing = &mut ctx.accounts.listing;
        listing.maker = ctx.accounts.maker.key();
        listing.mint = ctx.accounts.maker_mint.key();
        listing.price = price;

        // Transfer NFT from maker → vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.maker_ata.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.maker.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, 1)?; // 1 NFT

        Ok(())
    }

    /// ----------------------------------------------------------
    /// 3. PURCHASE A LISTED ITEM
    /// ----------------------------------------------------------
    /// Transfers SOL (minus fee) to seller, transfers NFT
    /// from escrow → buyer, and closes the `Listing` PDA.
    pub fn purchase(ctx: Context<Purchase>) -> Result<()> {
        let listing = &ctx.accounts.listing;
        let marketplace = &ctx.accounts.marketplace;

        // Calculate fee
        let fee = listing
            .price
            .checked_mul(marketplace.fee as u64)
            .unwrap()
            .checked_div(10_000)
            .unwrap();
        let net = listing.price - fee;

        // Transfer SOL from buyer to seller
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.buyer.key(),
            &ctx.accounts.maker.key(),
            net,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.maker.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Transfer fee to treasury
        if fee > 0 {
            let fee_ix = anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.buyer.key(),
                &marketplace.treasury,
                fee,
            );
            anchor_lang::solana_program::program::invoke(
                &fee_ix,
                &[
                    ctx.accounts.buyer.to_account_info(),
                    ctx.accounts.treasury.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        // Transfer NFT escrow → buyer
        let seeds = &[
            b"marketplace",
            marketplace.name.as_bytes(),
            &[marketplace.bump],
        ];
        let signer_seeds = &[&seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.taker_ata.to_account_info(),
            authority: ctx.accounts.marketplace.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, 1)?;

        // Close vault account
        let close_cpi_accounts = CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: ctx.accounts.marketplace.to_account_info(),
        };
        let close_cpi_program = ctx.accounts.token_program.to_account_info();
        let close_cpi_ctx =
            CpiContext::new_with_signer(close_cpi_program, close_cpi_accounts, signer_seeds);
        token::close_account(close_cpi_ctx)?;

        // The listing account is automatically closed by the `close` constraint

        Ok(())
    }

    /// ----------------------------------------------------------
    /// 4. CANCEL LISTING
    /// ----------------------------------------------------------
    /// Re-mints the NFT back to the original owner and closes
    /// the escrow vault and `Listing` PDA.
    pub fn delist(ctx: Context<Delist>) -> Result<()> {
        // Transfer NFT escrow → maker
        let seeds = &[
            b"marketplace",
            ctx.accounts.marketplace.name.as_bytes(),
            &[ctx.accounts.marketplace.bump],
        ];
        let signer_seeds = &[&seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.maker_ata.to_account_info(),
            authority: ctx.accounts.marketplace.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, 1)?;

        // Close vault account
        let close_cpi_accounts = CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: ctx.accounts.marketplace.to_account_info(),
        };
        let close_cpi_program = ctx.accounts.token_program.to_account_info();
        let close_cpi_ctx =
            CpiContext::new_with_signer(close_cpi_program, close_cpi_accounts, signer_seeds);
        token::close_account(close_cpi_ctx)?;

        Ok(())
    }
}
