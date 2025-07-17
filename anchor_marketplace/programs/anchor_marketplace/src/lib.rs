use anchor_lang::prelude::*;

declare_id!("Rc55Bpvuafwv7MAz2ux7LdGYbr5jprezrW5h2vU2Vf6");

#[program]
pub mod anchor_marketplace {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
