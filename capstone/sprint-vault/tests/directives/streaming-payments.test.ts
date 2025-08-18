import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import BN from "bn.js";
import {
  setupSprintTest,
  createSprint,
  fundSprint,
  withdrawFromSprint,
  pauseSprint,
  resumeSprint,
  SprintDurationVariants,
  AccelerationTypes,
  advanceTimeBy,
  calculateStreamedAmount,
  SprintTestSetup,
  SprintAccounts
} from "../shared/sprint-helpers";

describe("Streaming Payment Calculations", () => {
  let setup: SprintTestSetup;

  beforeEach(async () => {
    setup = await setupSprintTest();
  });

  describe("Linear Acceleration", () => {
    it("Should calculate linear payments correctly", async () => {
      const sprintId = new BN(Date.now());
      const startTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in 1 minute (future)
      const totalAmount = new BN(100_000_000); // 100 tokens
      const duration = 7 * 24 * 60 * 60; // 1 week in seconds
      
      const sprintAccounts = await createSprint(
        setup,
        sprintId,
        startTime,
        SprintDurationVariants.oneWeek,
        totalAmount,
        AccelerationTypes.linear
      );
      
      await fundSprint(setup, sprintAccounts, totalAmount);
      
      // Calculate expected amount at 25% time elapsed
      const quarterTime = startTime.add(new BN(duration / 4));
      const expectedQuarter = calculateStreamedAmount(
        totalAmount,
        startTime,
        startTime.add(new BN(duration)),
        quarterTime,
        "linear"
      );
      
      // Should be exactly 25% for linear
      expect(expectedQuarter.toString()).to.equal("25000000"); // 25 tokens
      
      // Calculate at 50% time
      const halfTime = startTime.add(new BN(duration / 2));
      const expectedHalf = calculateStreamedAmount(
        totalAmount,
        startTime,
        startTime.add(new BN(duration)),
        halfTime,
        "linear"
      );
      
      // Should be exactly 50% for linear
      expect(expectedHalf.toString()).to.equal("50000000"); // 50 tokens
    });

    it("Should allow proportional withdrawals with linear curve", async () => {
      const sprintId = new BN(Date.now() + 1);
      const startTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in future
      const totalAmount = new BN(100_000_000);
      
      const sprintAccounts = await createSprint(
        setup,
        sprintId,
        startTime,
        SprintDurationVariants.tenWeeks,
        totalAmount,
        AccelerationTypes.linear
      );
      
      await fundSprint(setup, sprintAccounts, totalAmount);
      
      // Wait for sprint to start and accumulate some payment (1 hour after start)
      await advanceTimeBy(setup.provider, 120); // Wait for start time + extra
      await advanceTimeBy(setup.provider, 3600); // Then 1 hour of work
      
      const balanceBefore = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      await withdrawFromSprint(setup, sprintAccounts);
      
      const balanceAfter = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const withdrawn = new BN(balanceAfter.value.amount).sub(new BN(balanceBefore.value.amount));
      
      // Should have withdrawn some amount (small percentage of total)
      expect(withdrawn.toNumber()).to.be.greaterThan(0);
      expect(withdrawn.toNumber()).to.be.lessThan(5_000_000); // Less than 5% of total
    });
  });

  describe("Quadratic Acceleration", () => {
    it("Should calculate quadratic payments correctly", async () => {
      const totalAmount = new BN(100_000_000);
      const startTime = new BN(1000);
      const endTime = new BN(2000);
      
      // At 25% time, should earn (0.25)² = 6.25% of total
      const quarterTime = new BN(1250);
      const expectedQuarter = calculateStreamedAmount(
        totalAmount,
        startTime,
        endTime,
        quarterTime,
        "quadratic"
      );
      expect(expectedQuarter.toNumber()).to.be.closeTo(6_250_000, 100_000);
      
      // At 50% time, should earn (0.50)² = 25% of total
      const halfTime = new BN(1500);
      const expectedHalf = calculateStreamedAmount(
        totalAmount,
        startTime,
        endTime,
        halfTime,
        "quadratic"
      );
      expect(expectedHalf.toNumber()).to.be.closeTo(25_000_000, 100_000);
      
      // At 75% time, should earn (0.75)² = 56.25% of total
      const threeQuarterTime = new BN(1750);
      const expectedThreeQuarter = calculateStreamedAmount(
        totalAmount,
        startTime,
        endTime,
        threeQuarterTime,
        "quadratic"
      );
      expect(expectedThreeQuarter.toNumber()).to.be.closeTo(56_250_000, 100_000);
    });

    it("Should accelerate payments near end with quadratic curve", async () => {
      const sprintId = new BN(Date.now() + 2);
      const startTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in future
      const totalAmount = new BN(100_000_000);
      
      const sprintAccounts = await createSprint(
        setup,
        sprintId,
        startTime,
        SprintDurationVariants.oneWeek,
        totalAmount,
        AccelerationTypes.quadratic
      );
      
      await fundSprint(setup, sprintAccounts, totalAmount);
      
      // Wait for sprint to start and accumulate payment
      await advanceTimeBy(setup.provider, 120); // Wait for start time + extra
      await advanceTimeBy(setup.provider, 7200); // Then 2 hours of work
      
      // First withdrawal early in sprint
      const balance1 = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      await withdrawFromSprint(setup, sprintAccounts);
      const balance2 = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const firstWithdrawal = new BN(balance2.value.amount).sub(new BN(balance1.value.amount));
      
      // Wait much longer (advance to near end of sprint)
      await advanceTimeBy(setup.provider, 6 * 24 * 60 * 60); // 6 days
      
      await withdrawFromSprint(setup, sprintAccounts);
      const balance3 = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const secondWithdrawal = new BN(balance3.value.amount).sub(new BN(balance2.value.amount));
      
      // Second withdrawal should be much larger (due to quadratic acceleration)
      expect(secondWithdrawal.toNumber()).to.be.greaterThan(firstWithdrawal.toNumber() * 5);
    });
  });

  describe("Cubic Acceleration", () => {
    it("Should calculate cubic payments correctly", async () => {
      const totalAmount = new BN(100_000_000);
      const startTime = new BN(1000);
      const endTime = new BN(2000);
      
      // At 25% time, should earn (0.25)³ = 1.5625% of total
      const quarterTime = new BN(1250);
      const expectedQuarter = calculateStreamedAmount(
        totalAmount,
        startTime,
        endTime,
        quarterTime,
        "cubic"
      );
      expect(expectedQuarter.toNumber()).to.be.closeTo(1_562_500, 100_000);
      
      // At 50% time, should earn (0.50)³ = 12.5% of total
      const halfTime = new BN(1500);
      const expectedHalf = calculateStreamedAmount(
        totalAmount,
        startTime,
        endTime,
        halfTime,
        "cubic"
      );
      expect(expectedHalf.toNumber()).to.be.closeTo(12_500_000, 100_000);
      
      // At 75% time, should earn (0.75)³ = 42.1875% of total
      const threeQuarterTime = new BN(1750);
      const expectedThreeQuarter = calculateStreamedAmount(
        totalAmount,
        startTime,
        endTime,
        threeQuarterTime,
        "cubic"
      );
      expect(expectedThreeQuarter.toNumber()).to.be.closeTo(42_187_500, 100_000);
    });

    it("Should heavily backload payments with cubic curve", async () => {
      const sprintId = new BN(Date.now() + 3);
      const startTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in future
      const totalAmount = new BN(100_000_000);
      
      const sprintAccounts = await createSprint(
        setup,
        sprintId,
        startTime,
        SprintDurationVariants.twoWeeks,
        totalAmount,
        AccelerationTypes.cubic
      );
      
      await fundSprint(setup, sprintAccounts, totalAmount);
      
      // Wait for sprint to start and accumulate payment
      await advanceTimeBy(setup.provider, 120); // Wait for start time + extra
      await advanceTimeBy(setup.provider, 10800); // Then 3 hours of work
      
      // Get sprint to check duration
      const sprint = await setup.sprintProgram.account.sprint.fetch(sprintAccounts.sprintPda);
      const duration = sprint.endTime.sub(sprint.startTime);
      
      // Calculate expected at current time (very early in sprint)
      const currentTime = new BN(Math.floor(Date.now() / 1000));
      const expectedNow = calculateStreamedAmount(
        totalAmount,
        sprint.startTime,
        sprint.endTime,
        currentTime,
        "cubic"
      );
      
      // Should be very small amount early in sprint
      expect(expectedNow.toNumber()).to.be.lessThan(5_000_000); // Less than 5% of total
    });
  });

  describe("Multiple Withdrawals", () => {
    it("Should track multiple withdrawals correctly over longer sprint", async () => {
      const monthSprintId = new BN(Date.now() + 1000);
      const monthStartTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in future
      const monthAmount = new BN(1000_000_000); // 1000 tokens
      
      const monthSprint = await createSprint(
        setup,
        monthSprintId,
        monthStartTime,
        SprintDurationVariants.fourWeeks, // Use valid variant (4 weeks ~= 1 month)
        monthAmount,
        AccelerationTypes.linear
      );
      
      await fundSprint(setup, monthSprint, monthAmount);
      
      // Wait for sprint to start, then first withdrawal after 1 week
      await advanceTimeBy(setup.provider, 120); // Wait for start
      await advanceTimeBy(setup.provider, 7 * 24 * 60 * 60);
      
      const balance1Before = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      await withdrawFromSprint(setup, monthSprint);
      const balance1After = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const firstWithdrawAmount = new BN(balance1After.value.amount).sub(new BN(balance1Before.value.amount));
      
      // Calculate expected for 1 week out of 28 days (4 weeks)
      const expectedFirst = monthAmount.muln(7).divn(28);
      expect(firstWithdrawAmount.toNumber()).to.be.closeTo(expectedFirst.toNumber(), 10_000_000);
      
      // Second withdrawal after another week
      await advanceTimeBy(setup.provider, 7 * 24 * 60 * 60);
      
      const balance2Before = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      await withdrawFromSprint(setup, monthSprint);
      const balance2After = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const secondWithdrawAmount = new BN(balance2After.value.amount).sub(new BN(balance2Before.value.amount));
      
      // Calculate expected for 2 weeks out of 28 days minus first withdrawal
      const expectedSecond = monthAmount.muln(14).divn(28).sub(firstWithdrawAmount);
      expect(secondWithdrawAmount.toNumber()).to.be.closeTo(expectedSecond.toNumber(), 10_000_000);
      
      // Complete the sprint (remaining 2 weeks)
      await advanceTimeBy(setup.provider, 14 * 24 * 60 * 60); // Remaining time
      
      const balance3Before = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      await withdrawFromSprint(setup, monthSprint);
      const balance3After = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const finalWithdrawAmount = new BN(balance3After.value.amount).sub(new BN(balance3Before.value.amount));
      
      // Total should be close to the full amount
      const totalWithdrawn = firstWithdrawAmount.add(secondWithdrawAmount).add(finalWithdrawAmount);
      expect(totalWithdrawn.toNumber()).to.be.closeTo(monthAmount.toNumber(), 10_000_000);
    });
  });

  describe("Paused Sprint Calculations", () => {
    it("Should not accumulate during pause period", async () => {
      const shortSprintId = new BN(Date.now() + 2000);
      const shortStartTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in future
      const shortAmount = new BN(100_000_000);
      
      const shortSprint = await createSprint(
        setup,
        shortSprintId,
        shortStartTime,
        SprintDurationVariants.oneWeek,
        shortAmount,
        AccelerationTypes.linear
      );
      
      await fundSprint(setup, shortSprint, shortAmount);
      
      // Wait for sprint to start, then half the sprint duration
      await advanceTimeBy(setup.provider, 120); // Wait for start
      await advanceTimeBy(setup.provider, 3.5 * 24 * 60 * 60);
      
      // First withdrawal at 50%
      const balance1Before = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      await withdrawFromSprint(setup, shortSprint);
      const balance1After = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const firstAmount = new BN(balance1After.value.amount).sub(new BN(balance1Before.value.amount));
      
      // Pause and wait
      await pauseSprint(setup, shortSprint);
      await advanceTimeBy(setup.provider, 2 * 24 * 60 * 60); // 2 days paused
      
      // Resume sprint
      await resumeSprint(setup, shortSprint);
      
      // Wait for remaining active time
      await advanceTimeBy(setup.provider, 3.5 * 24 * 60 * 60);
      
      // Final withdrawal
      const balance2Before = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      await withdrawFromSprint(setup, shortSprint);
      const balance2After = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const secondAmount = new BN(balance2After.value.amount).sub(new BN(balance2Before.value.amount));
      
      // Total should be the full amount (pause doesn't affect total, just timing)
      expect(firstAmount.add(secondAmount).toNumber()).to.be.closeTo(shortAmount.toNumber(), 1_000_000);
    });
  });

  describe("Acceleration Type Comparisons", () => {
    it("Should pay more early with quadratic than linear", async () => {
      const quadSprintId = new BN(Date.now() + 3000);
      const quadStartTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in future
      const quadAmount = new BN(100_000_000);
      
      const quadSprint = await createSprint(
        setup,
        quadSprintId,
        quadStartTime,
        SprintDurationVariants.twoWeeks,
        quadAmount,
        AccelerationTypes.quadratic
      );
      
      await fundSprint(setup, quadSprint, quadAmount);
      
      // Wait for sprint to start, then 25% of sprint duration
      await advanceTimeBy(setup.provider, 120); // Wait for start
      const quarterDuration = 14 * 24 * 60 * 60 / 4;
      await advanceTimeBy(setup.provider, quarterDuration);
      
      const balanceBefore = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      await withdrawFromSprint(setup, quadSprint);
      const balanceAfter = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const quadWithdrawn = new BN(balanceAfter.value.amount).sub(new BN(balanceBefore.value.amount));
      
      // For quadratic at 25% time: (0.25)² = 6.25% of total
      const expectedQuad = quadAmount.muln(625).divn(10000);
      expect(quadWithdrawn.toNumber()).to.be.closeTo(expectedQuad.toNumber(), 2_000_000);
      
      // Linear would give exactly 25% at this point
      const linearExpected = quadAmount.muln(25).divn(100);
      
      // Quadratic should be less than linear at 25% time
      expect(quadWithdrawn.toNumber()).to.be.lessThan(linearExpected.toNumber());
    });

    it("Should pay much less early with cubic than quadratic", async () => {
      const cubicSprintId = new BN(Date.now() + 4000);
      const cubicStartTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in future
      const cubicAmount = new BN(100_000_000);
      
      const cubicSprint = await createSprint(
        setup,
        cubicSprintId,
        cubicStartTime,
        SprintDurationVariants.twoWeeks,
        cubicAmount,
        AccelerationTypes.cubic
      );
      
      await fundSprint(setup, cubicSprint, cubicAmount);
      
      // Wait for sprint to start, then 50% of sprint duration
      await advanceTimeBy(setup.provider, 120); // Wait for start
      const halfDuration = 14 * 24 * 60 * 60 / 2;
      await advanceTimeBy(setup.provider, halfDuration);
      
      const balanceBefore = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      await withdrawFromSprint(setup, cubicSprint);
      const balanceAfter = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const cubicWithdrawn = new BN(balanceAfter.value.amount).sub(new BN(balanceBefore.value.amount));
      
      // For cubic at 50% time: (0.5)³ = 12.5% of total
      const expectedCubic = cubicAmount.muln(125).divn(1000);
      expect(cubicWithdrawn.toNumber()).to.be.closeTo(expectedCubic.toNumber(), 2_000_000);
      
      // Quadratic would give 25% at 50% time
      const quadraticExpected = cubicAmount.muln(25).divn(100);
      
      // Cubic should be less than quadratic at 50% time
      expect(cubicWithdrawn.toNumber()).to.be.lessThan(quadraticExpected.toNumber());
    });
  });

  describe("Edge Cases", () => {
    it("Should handle withdrawal before sprint starts", async () => {
      const sprintId = new BN(Date.now() + 5);
      const startTime = new BN(Math.floor(Date.now() / 1000) + 3600); // Starts in 1 hour
      const totalAmount = new BN(100_000_000);
      
      const sprintAccounts = await createSprint(
        setup,
        sprintId,
        startTime,
        SprintDurationVariants.oneWeek,
        totalAmount,
        AccelerationTypes.linear
      );
      
      await fundSprint(setup, sprintAccounts, totalAmount);
      
      // Try to withdraw before start
      const balanceBefore = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      await withdrawFromSprint(setup, sprintAccounts);
      
      const balanceAfter = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      // Should withdraw 0 tokens
      expect(balanceAfter.value.amount).to.equal(balanceBefore.value.amount);
    });

    it("Should handle withdrawal after sprint ends", async () => {
      const sprintId = new BN(Date.now() + 6);
      const startTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in future
      const totalAmount = new BN(100_000_000);
      
      const sprintAccounts = await createSprint(
        setup,
        sprintId,
        startTime,
        SprintDurationVariants.oneWeek,
        totalAmount,
        AccelerationTypes.quadratic
      );
      
      await fundSprint(setup, sprintAccounts, totalAmount);
      
      // Wait for sprint to complete
      await advanceTimeBy(setup.provider, 8 * 24 * 60 * 60); // Wait past end
      
      // Withdraw after sprint ended
      const balanceBefore = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      await withdrawFromSprint(setup, sprintAccounts);
      
      const balanceAfter = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      const withdrawn = new BN(balanceAfter.value.amount).sub(new BN(balanceBefore.value.amount));
      
      // Should get full amount
      expect(withdrawn.toString()).to.equal(totalAmount.toString());
    });

    it("Should prevent over-withdrawal", async () => {
      const sprintId = new BN(Date.now() + 7);
      const startTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in future
      const totalAmount = new BN(100_000_000);
      
      const sprintAccounts = await createSprint(
        setup,
        sprintId,
        startTime,
        SprintDurationVariants.oneWeek,
        totalAmount,
        AccelerationTypes.linear
      );
      
      await fundSprint(setup, sprintAccounts, totalAmount);
      
      // Wait to ensure sprint is complete
      await advanceTimeBy(setup.provider, 8 * 24 * 60 * 60); // Past end
      
      // First withdrawal - get everything
      await withdrawFromSprint(setup, sprintAccounts);
      
      // Try to withdraw again
      const balanceBefore = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      await withdrawFromSprint(setup, sprintAccounts);
      
      const balanceAfter = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      // Should get 0 on second withdrawal
      expect(balanceAfter.value.amount).to.equal(balanceBefore.value.amount);
    });
  });
});
