pub mod errors;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use errors::*;
use instructions::*;

declare_id!("8qvnjVHuK27Wbzhe5HCuXybDLRN41t5LAZ9BgNKpiymh");

#[program]
pub mod bounty {
    use super::*;

    pub fn create_bounty_pool(
        ctx: Context<CreateBountyPool>,
        bounty_id: u64,
        vault_id: u64,
        title: String,
        description_url: String,
        total_amount: u64,
        milestones: Vec<MilestoneInput>,
        associated_sprint: Option<Pubkey>,
        expires_at: Option<i64>,
        arbiter: Option<Pubkey>,
    ) -> Result<()> {
        instructions::create_bounty_pool::handler(
            ctx,
            bounty_id,
            vault_id,
            title,
            description_url,
            total_amount,
            milestones,
            associated_sprint,
            expires_at,
            arbiter,
        )
    }

    pub fn fund_bounty(
        ctx: Context<FundBounty>,
        amount: u64,
    ) -> Result<()> {
        instructions::fund_bounty::handler(ctx, amount)
    }

    pub fn claim_milestone(
        ctx: Context<ClaimMilestone>,
        milestone_id: u32,
    ) -> Result<()> {
        instructions::claim_milestone::handler(ctx, milestone_id)
    }

    pub fn submit_milestone(
        ctx: Context<SubmitMilestone>,
        milestone_id: u32,
        evidence_url: String,
        git_reference: String,
    ) -> Result<()> {
        instructions::submit_milestone::handler(
            ctx,
            milestone_id,
            evidence_url,
            git_reference,
        )
    }

    pub fn approve_milestone(
        ctx: Context<ApproveMilestone>,
        milestone_id: u32,
    ) -> Result<()> {
        instructions::approve_milestone::handler(ctx, milestone_id)
    }
}
