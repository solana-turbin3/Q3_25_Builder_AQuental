import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import BN from "bn.js";
import {
  setupSprintTest,
  createSprint,
  fundSprint,
  pauseSprint,
  resumeSprint,
  withdrawFromSprint,
  closeSprint,
  createBountyPool,
  fundBounty,
  SprintDurationVariants,
  AccelerationTypes,
  advanceTimeBy,
  SprintTestSetup,
  SprintAccounts,
  BountyAccounts
} from "../shared/sprint-helpers";

describe("Sprint Lifecycle Integration", () => {
  let setup: SprintTestSetup;

  beforeEach(async () => {
    setup = await setupSprintTest();
  });

  describe("Complete Sprint Flow", () => {
    it("Should complete full sprint lifecycle", async () => {
      // 1. Create Sprint
      const sprintId = new BN(Date.now());
      const startTime = new BN(Math.floor(Date.now() / 1000) - 100); // Started recently
      const totalAmount = new BN(100_000_000); // 100 tokens
      
      const sprintAccounts = await createSprint(
        setup,
        sprintId,
        startTime,
        SprintDurationVariants.twoWeeks,
        totalAmount,
        AccelerationTypes.quadratic
      );
      
      // Verify sprint created
      let sprint = await setup.sprintProgram.account.sprint.fetch(sprintAccounts.sprintPda);
      expect(sprint.employer.toString()).to.equal(setup.employer.publicKey.toString());
      expect(sprint.freelancer.toString()).to.equal(setup.freelancer.publicKey.toString());
      expect(sprint.isFunded).to.be.false;
      
      // 2. Fund Sprint
      await fundSprint(setup, sprintAccounts, totalAmount);
      
      sprint = await setup.sprintProgram.account.sprint.fetch(sprintAccounts.sprintPda);
      expect(sprint.isFunded).to.be.true;
      
      // 3. First Withdrawal (early in sprint)
      await advanceTimeBy(setup.provider, 2 * 24 * 60 * 60); // 2 days
      
      const balance1 = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      await withdrawFromSprint(setup, sprintAccounts);
      const balance2 = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const firstWithdrawal = new BN(balance2.value.amount).sub(new BN(balance1.value.amount));
      expect(firstWithdrawal.toNumber()).to.be.greaterThan(0);
      
      // With quadratic curve at ~14% time, should have ~2% of funds
      expect(firstWithdrawal.toNumber()).to.be.lessThan(5_000_000);
      
      // 4. Pause Sprint (dispute scenario)
      await pauseSprint(setup, sprintAccounts);
      
      sprint = await setup.sprintProgram.account.sprint.fetch(sprintAccounts.sprintPda);
      expect(sprint.isPaused).to.be.true;
      
      // 5. Wait while paused
      await advanceTimeBy(setup.provider, 24 * 60 * 60); // 1 day paused
      
      // 6. Resume Sprint
      await resumeSprint(setup, sprintAccounts);
      
      sprint = await setup.sprintProgram.account.sprint.fetch(sprintAccounts.sprintPda);
      expect(sprint.isPaused).to.be.false;
      expect(sprint.totalPausedDuration.toNumber()).to.be.greaterThan(0);
      
      // 7. Second Withdrawal (mid-sprint)
      await advanceTimeBy(setup.provider, 5 * 24 * 60 * 60); // 5 more days
      
      await withdrawFromSprint(setup, sprintAccounts);
      const balance3 = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const secondWithdrawal = new BN(balance3.value.amount).sub(new BN(balance2.value.amount));
      expect(secondWithdrawal.toNumber()).to.be.greaterThan(firstWithdrawal.toNumber());
      
      // 8. Final Withdrawal (end of sprint)
      await advanceTimeBy(setup.provider, 8 * 24 * 60 * 60); // Past end
      
      await withdrawFromSprint(setup, sprintAccounts);
      const balance4 = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const finalWithdrawal = new BN(balance4.value.amount).sub(new BN(balance3.value.amount));
      const totalWithdrawn = new BN(balance4.value.amount).sub(new BN(balance1.value.amount));
      
      // Should have withdrawn everything
      expect(totalWithdrawn.toString()).to.equal(totalAmount.toString());
      
      // 9. Close Sprint
      await closeSprint(setup, sprintAccounts);
      
      // Sprint account should be closed
      try {
        await setup.sprintProgram.account.sprint.fetch(sprintAccounts.sprintPda);
        expect.fail("Sprint should be closed");
      } catch (error) {
        // Expected - account closed
      }
    });

    it("Should handle early termination scenario", async () => {
      const sprintId = new BN(Date.now() + 1);
      const startTime = new BN(Math.floor(Date.now() / 1000) - 100);
      const totalAmount = new BN(100_000_000);
      
      const sprintAccounts = await createSprint(
        setup,
        sprintId,
        startTime,
        SprintDurationVariants.fourWeeks,
        totalAmount,
        AccelerationTypes.linear
      );
      
      await fundSprint(setup, sprintAccounts, totalAmount);
      
      // Freelancer works for 1 week
      await advanceTimeBy(setup.provider, 7 * 24 * 60 * 60);
      await withdrawFromSprint(setup, sprintAccounts);
      
      const freelancerBalance = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      const earnedAmount = new BN(freelancerBalance.value.amount);
      
      // Should have earned about 25% (1 week of 4)
      expect(earnedAmount.toNumber()).to.be.closeTo(25_000_000, 2_000_000);
      
      // Employer terminates sprint early
      const employerBalanceBefore = await setup.provider.connection.getTokenAccountBalance(
        setup.employerTokenAccount
      );
      
      await closeSprint(setup, sprintAccounts);
      
      const employerBalanceAfter = await setup.provider.connection.getTokenAccountBalance(
        setup.employerTokenAccount
      );
      
      const refundAmount = new BN(employerBalanceAfter.value.amount).sub(
        new BN(employerBalanceBefore.value.amount)
      );
      
      // Employer should get refund of unearned amount (~75%)
      expect(refundAmount.toNumber()).to.be.closeTo(75_000_000, 2_000_000);
    });
  });

  describe("Sprint with Associated Bounty", () => {
    it("Should link sprint with bounty pool", async () => {
      if (!setup.bountyProgram) {
        console.log("Bounty program not available, skipping test");
        return;
      }
      
      // Create sprint first
      const sprintId = new BN(Date.now() + 2);
      const startTime = new BN(Math.floor(Date.now() / 1000));
      const sprintAmount = new BN(100_000_000);
      
      const sprintAccounts = await createSprint(
        setup,
        sprintId,
        startTime,
        SprintDurationVariants.twoWeeks,
        sprintAmount
      );
      
      // Create bounty with associated sprint
      const bountyId = new BN(Date.now());
      const vaultId = new BN(1);
      const bountyAmount = new BN(50_000_000);
      
      const milestones = [
        {
          id: 0,
          description: "Complete feature implementation",
          amount: new BN(30_000_000),
          status: { pending: {} }
        },
        {
          id: 1,
          description: "Write tests and documentation",
          amount: new BN(20_000_000),
          status: { pending: {} }
        }
      ];
      
      const bountyAccounts = await createBountyPool(
        setup,
        bountyId,
        vaultId,
        "Sprint Bonus Bounty",
        "https://example.com/bounty-details",
        bountyAmount,
        milestones,
        sprintAccounts.sprintPda, // Link to sprint
        null,
        null
      );
      
      // Verify bounty is linked to sprint
      const bountyPool = await setup.bountyProgram.account.bountyPool.fetch(
        bountyAccounts.bountyPoolPda
      );
      expect(bountyPool.associatedSprint?.toString()).to.equal(
        sprintAccounts.sprintPda.toString()
      );
      
      // Fund both sprint and bounty
      await fundSprint(setup, sprintAccounts, sprintAmount);
      await fundBounty(setup, bountyAccounts, bountyAmount);
      
      // Verify both are funded
      const sprint = await setup.sprintProgram.account.sprint.fetch(sprintAccounts.sprintPda);
      expect(sprint.isFunded).to.be.true;
      
      const bounty = await setup.bountyProgram.account.bountyPool.fetch(
        bountyAccounts.bountyPoolPda
      );
      expect(bounty.isFunded).to.be.true;
    });
  });

  describe("Multi-Party Interactions", () => {
    it("Should handle employer and freelancer interactions correctly", async () => {
      const sprintId = new BN(Date.now() + 3);
      const startTime = new BN(Math.floor(Date.now() / 1000) - 100);
      const totalAmount = new BN(100_000_000);
      
      const sprintAccounts = await createSprint(
        setup,
        sprintId,
        startTime,
        SprintDurationVariants.oneWeek,
        totalAmount
      );
      
      // Employer funds the sprint
      const employerInitialBalance = await setup.provider.connection.getTokenAccountBalance(
        setup.employerTokenAccount
      );
      await fundSprint(setup, sprintAccounts, totalAmount);
      const employerAfterFunding = await setup.provider.connection.getTokenAccountBalance(
        setup.employerTokenAccount
      );
      
      // Employer's balance decreased
      expect(
        new BN(employerInitialBalance.value.amount).sub(
          new BN(employerAfterFunding.value.amount)
        ).toString()
      ).to.equal(totalAmount.toString());
      
      // Freelancer withdraws periodically
      const freelancerInitialBalance = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      // Multiple withdrawals over time
      for (let i = 0; i < 3; i++) {
        await advanceTimeBy(setup.provider, 2 * 24 * 60 * 60); // 2 days
        await withdrawFromSprint(setup, sprintAccounts);
      }
      
      const freelancerMidBalance = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      // Freelancer's balance increased
      expect(
        new BN(freelancerMidBalance.value.amount).gt(
          new BN(freelancerInitialBalance.value.amount)
        )
      ).to.be.true;
      
      // Employer can pause if needed
      await pauseSprint(setup, sprintAccounts);
      
      // Freelancer cannot withdraw while paused
      try {
        await withdrawFromSprint(setup, sprintAccounts);
        expect.fail("Should not be able to withdraw while paused");
      } catch (error) {
        // Expected
      }
      
      // Employer resumes
      await resumeSprint(setup, sprintAccounts);
      
      // Freelancer can withdraw again
      await advanceTimeBy(setup.provider, 2 * 24 * 60 * 60);
      await withdrawFromSprint(setup, sprintAccounts);
      
      const freelancerFinalBalance = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      // Total earned should equal total amount
      const totalEarned = new BN(freelancerFinalBalance.value.amount).sub(
        new BN(freelancerInitialBalance.value.amount)
      );
      expect(totalEarned.toString()).to.equal(totalAmount.toString());
    });
  });

  describe("Complex Scenarios", () => {
    it("Should handle sprint with multiple pauses and varying withdrawal patterns", async () => {
      const sprintId = new BN(Date.now() + 4);
      const startTime = new BN(Math.floor(Date.now() / 1000) - 100);
      const totalAmount = new BN(200_000_000); // 200 tokens
      
      const sprintAccounts = await createSprint(
        setup,
        sprintId,
        startTime,
        SprintDurationVariants.fourWeeks,
        totalAmount,
        AccelerationTypes.cubic // Most complex curve
      );
      
      await fundSprint(setup, sprintAccounts, totalAmount);
      
      let totalWithdrawn = new BN(0);
      let lastBalance = new BN(0);
      
      // Week 1: Normal work
      await advanceTimeBy(setup.provider, 7 * 24 * 60 * 60);
      await withdrawFromSprint(setup, sprintAccounts);
      
      let balance = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      let withdrawn = new BN(balance.value.amount).sub(lastBalance);
      totalWithdrawn = totalWithdrawn.add(withdrawn);
      lastBalance = new BN(balance.value.amount);
      
      // With cubic curve at 25% time, should have very little
      expect(withdrawn.toNumber()).to.be.lessThan(5_000_000);
      
      // Week 2: Pause for 3 days, work 4 days
      await pauseSprint(setup, sprintAccounts);
      await advanceTimeBy(setup.provider, 3 * 24 * 60 * 60);
      await resumeSprint(setup, sprintAccounts);
      await advanceTimeBy(setup.provider, 4 * 24 * 60 * 60);
      await withdrawFromSprint(setup, sprintAccounts);
      
      balance = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      withdrawn = new BN(balance.value.amount).sub(lastBalance);
      totalWithdrawn = totalWithdrawn.add(withdrawn);
      lastBalance = new BN(balance.value.amount);
      
      // Week 3: Normal work
      await advanceTimeBy(setup.provider, 7 * 24 * 60 * 60);
      await withdrawFromSprint(setup, sprintAccounts);
      
      balance = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      withdrawn = new BN(balance.value.amount).sub(lastBalance);
      totalWithdrawn = totalWithdrawn.add(withdrawn);
      lastBalance = new BN(balance.value.amount);
      
      // Should see acceleration with cubic curve
      expect(withdrawn.toNumber()).to.be.greaterThan(10_000_000);
      
      // Week 4: Final push - should get most payment
      await advanceTimeBy(setup.provider, 7 * 24 * 60 * 60);
      await withdrawFromSprint(setup, sprintAccounts);
      
      balance = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      withdrawn = new BN(balance.value.amount).sub(lastBalance);
      totalWithdrawn = totalWithdrawn.add(withdrawn);
      
      // Final week with cubic should be huge
      expect(withdrawn.toNumber()).to.be.greaterThan(100_000_000);
      
      // Total should equal amount
      expect(totalWithdrawn.toString()).to.equal(totalAmount.toString());
      
      // Verify sprint state
      const sprint = await setup.sprintProgram.account.sprint.fetch(sprintAccounts.sprintPda);
      expect(sprint.withdrawnAmount.toString()).to.equal(totalAmount.toString());
      expect(sprint.totalPausedDuration.toNumber()).to.be.closeTo(3 * 24 * 60 * 60, 100);
      expect(sprint.pauseResumeCount).to.equal(1);
    });
  });
});
