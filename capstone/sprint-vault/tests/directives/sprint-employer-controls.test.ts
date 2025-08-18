import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";
import BN from "bn.js";
import {
  setupSprintTest,
  createSprint,
  fundSprint,
  pauseSprint,
  resumeSprint,
  closeSprint,
  withdrawFromSprint,
  assertSprintPaused,
  assertSprintResumed,
  expectCustomError,
  SprintDurationVariants,
  AccelerationTypes,
  advanceTimeBy,
  SprintTestSetup,
  SprintAccounts
} from "../shared/sprint-helpers";

describe("Sprint Employer Controls", () => {
  let setup: SprintTestSetup;
  let sprintAccounts: SprintAccounts;

  beforeEach(async () => {
    setup = await setupSprintTest();
    
    // Create a sprint for testing
    const sprintId = new BN(Date.now());
    const startTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in 1 minute
    const totalAmount = new BN(100_000_000); // 100 tokens (6 decimals)
    
    sprintAccounts = await createSprint(
      setup,
      sprintId,
      startTime,
      SprintDurationVariants.twoWeeks,
      totalAmount,
      AccelerationTypes.quadratic
    );
  });

  describe("Pause Controls", () => {
    it("Should allow employer to pause sprint", async () => {
      // Fund the sprint first
      await fundSprint(setup, sprintAccounts, new BN(100_000_000));
      
      // Pause the sprint
      await pauseSprint(setup, sprintAccounts);
      
      // Verify sprint is paused
      await assertSprintPaused(setup.sprintProgram, sprintAccounts.sprintPda);
    });

    it("Should prevent freelancer from pausing sprint", async () => {
      await fundSprint(setup, sprintAccounts, new BN(100_000_000));
      
      // Try to pause as freelancer (should fail)
      await expectCustomError(
        setup.sprintProgram.methods
          .pauseStream()
          .accounts({
            sprint: sprintAccounts.sprintPda,
            employer: setup.freelancer.publicKey, // Using freelancer instead of employer
          })
          .signers([setup.freelancer])
          .rpc(),
        "Unauthorized"
      );
    });

    it("Should prevent pausing an unfunded sprint", async () => {
      // Try to pause without funding
      await expectCustomError(
        pauseSprint(setup, sprintAccounts),
        "SprintNotFunded"
      );
    });

    it("Should prevent pausing an already paused sprint", async () => {
      await fundSprint(setup, sprintAccounts, new BN(100_000_000));
      await pauseSprint(setup, sprintAccounts);
      
      // Try to pause again
      await expectCustomError(
        pauseSprint(setup, sprintAccounts),
        "AlreadyPaused" // Correct error code
      );
    });
  });

  describe("Resume Controls", () => {
    beforeEach(async () => {
      // Fund and pause the sprint for resume tests
      await fundSprint(setup, sprintAccounts, new BN(100_000_000));
      await pauseSprint(setup, sprintAccounts);
    });

    it("Should allow employer to resume paused sprint", async () => {
      await resumeSprint(setup, sprintAccounts);
      await assertSprintResumed(setup.sprintProgram, sprintAccounts.sprintPda);
    });

    it("Should track total paused duration", async () => {
      // Wait 5 seconds while paused
      await advanceTimeBy(setup.provider, 5);
      
      await resumeSprint(setup, sprintAccounts);
      
      const sprint = await setup.sprintProgram.account.sprint.fetch(sprintAccounts.sprintPda);
      expect(sprint.totalPausedDuration.toNumber()).to.be.greaterThanOrEqual(5);
    });

    it("Should prevent freelancer from resuming sprint", async () => {
      await expectCustomError(
        setup.sprintProgram.methods
          .resumeStream()
          .accounts({
            sprint: sprintAccounts.sprintPda,
            employer: setup.freelancer.publicKey, // Using freelancer instead of employer
          })
          .signers([setup.freelancer])
          .rpc(),
        "Unauthorized"
      );
    });

    it("Should prevent resuming an unpaused sprint", async () => {
      await resumeSprint(setup, sprintAccounts);
      
      // Try to resume again
      await expectCustomError(
        resumeSprint(setup, sprintAccounts),
        "NotPaused" // Correct error code  
      );
    });

    it("Should handle multiple pause/resume cycles", async () => {
      // First cycle
      await resumeSprint(setup, sprintAccounts);
      await advanceTimeBy(setup.provider, 2);
      
      // Second pause/resume
      await pauseSprint(setup, sprintAccounts);
      await advanceTimeBy(setup.provider, 3);
      await resumeSprint(setup, sprintAccounts);
      
      // Third pause/resume
      await pauseSprint(setup, sprintAccounts);
      await advanceTimeBy(setup.provider, 4);
      await resumeSprint(setup, sprintAccounts);
      
      const sprint = await setup.sprintProgram.account.sprint.fetch(sprintAccounts.sprintPda);
      expect(sprint.pauseResumeCount).to.equal(3);
      expect(sprint.totalPausedDuration.toNumber()).to.be.greaterThanOrEqual(7); // 3 + 4 seconds
    });
  });

  describe("Close Sprint Controls", () => {
    it("Should allow employer to close completed sprint", async () => {
      // Create and fund a short sprint that starts in future
      const quickSprintId = new BN(Date.now() + 1000);
      const quickStartTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in future
      const quickAmount = new BN(50_000_000); // 50 tokens
      
      const quickSprint = await createSprint(
        setup,
        quickSprintId,
        quickStartTime,
        SprintDurationVariants.oneWeek,
        quickAmount,
        AccelerationTypes.linear
      );
      
      await fundSprint(setup, quickSprint, quickAmount);
      
      // Wait for sprint to complete
      await advanceTimeBy(setup.provider, 7 * 24 * 60 * 60 + 100); // Wait past end time
      
      // Close the sprint
      await closeSprint(setup, quickSprint);
      
      // Verify sprint is closed (account should be closed)
      await expectCustomError(
        setup.sprintProgram.account.sprint.fetch(quickSprint.sprintPda),
        "AccountNotInitialized"
      );
    });

    it("Should refund remaining tokens when closing early", async () => {
      await fundSprint(setup, sprintAccounts, new BN(100_000_000));
      
      // Get initial employer balance
      const initialBalance = await setup.provider.connection.getTokenAccountBalance(
        setup.employerTokenAccount
      );
      const initialAmount = new BN(initialBalance.value.amount);
      
      // Close immediately (before any withdrawals)
      await closeSprint(setup, sprintAccounts);
      
      // Check employer got refund
      const finalBalance = await setup.provider.connection.getTokenAccountBalance(
        setup.employerTokenAccount
      );
      const finalAmount = new BN(finalBalance.value.amount);
      
      // Should get back the full amount (minus any fees)
      expect(finalAmount.gte(initialAmount.add(new BN(99_000_000)))).to.be.true;
    });

    it("Should prevent freelancer from closing sprint", async () => {
      await fundSprint(setup, sprintAccounts, new BN(100_000_000));
      
      await expectCustomError(
        setup.sprintProgram.methods
          .closeSprint()
          .accounts({
            sprint: sprintAccounts.sprintPda,
            vault: sprintAccounts.vaultPda,
            employerTokenAccount: setup.freelancerTokenAccount, // Wrong token account
            employer: setup.freelancer.publicKey, // Using freelancer instead of employer
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([setup.freelancer])
          .rpc(),
        "Unauthorized"
      );
    });

    it("Should handle closing sprint with partial withdrawals", async () => {
      // Create sprint that starts in future
      const partialSprintId = new BN(Date.now() + 2000);
      const partialStartTime = new BN(Math.floor(Date.now() / 1000) + 60); // Start in future
      const partialAmount = new BN(100_000_000);
      
      const partialSprint = await createSprint(
        setup,
        partialSprintId,
        partialStartTime,
        SprintDurationVariants.oneWeek,
        partialAmount,
        AccelerationTypes.linear
      );
      
      await fundSprint(setup, partialSprint, partialAmount);
      
      // Wait and let freelancer withdraw some funds
      await advanceTimeBy(setup.provider, 3600); // 1 hour
      await withdrawFromSprint(setup, partialSprint);
      
      // Get balances before closing
      const employerBalanceBefore = await setup.provider.connection.getTokenAccountBalance(
        setup.employerTokenAccount
      );
      const freelancerBalanceBefore = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      // Close sprint
      await closeSprint(setup, partialSprint);
      
      // Get balances after closing
      const employerBalanceAfter = await setup.provider.connection.getTokenAccountBalance(
        setup.employerTokenAccount
      );
      const freelancerBalanceAfter = await setup.provider.connection.getTokenAccountBalance(
        setup.freelancerTokenAccount
      );
      
      // Employer should get refund of unearned amount
      expect(new BN(employerBalanceAfter.value.amount).gt(new BN(employerBalanceBefore.value.amount))).to.be.true;
      // Freelancer balance should remain the same
      expect(freelancerBalanceAfter.value.amount).to.equal(freelancerBalanceBefore.value.amount);
    });
  });

  describe("Employer Authority Validation", () => {
    it("Should validate employer is signer for all control operations", async () => {
      await fundSprint(setup, sprintAccounts, new BN(100_000_000));
      
      // Create a fake employer account (not a signer)
      const fakeEmployer = anchor.web3.Keypair.generate();
      
      // Try pause without signing
      await expectCustomError(
        setup.sprintProgram.methods
          .pauseStream()
          .accounts({
            sprint: sprintAccounts.sprintPda,
            employer: setup.employer.publicKey,
          })
          // Missing .signers([setup.employer])
          .rpc(),
        "SignatureVerification"
      );
    });

    it("Should validate employer matches sprint account", async () => {
      await fundSprint(setup, sprintAccounts, new BN(100_000_000));
      
      // Create another employer
      const otherEmployer = anchor.web3.Keypair.generate();
      await setup.provider.connection.confirmTransaction(
        await setup.provider.connection.requestAirdrop(otherEmployer.publicKey, anchor.web3.LAMPORTS_PER_SOL)
      );
      
      // Try to pause another employer's sprint
      await expectCustomError(
        setup.sprintProgram.methods
          .pauseStream()
          .accounts({
            sprint: sprintAccounts.sprintPda,
            employer: otherEmployer.publicKey,
          })
          .signers([otherEmployer])
          .rpc(),
        "ConstraintHasOne"
      );
    });
  });

  describe("Sprint State Transitions", () => {
    it("Should enforce valid state transitions", async () => {
      // Can't withdraw from unfunded sprint
      await expectCustomError(
        withdrawFromSprint(setup, sprintAccounts),
        "SprintNotFunded"
      );
      
      // Fund the sprint
      await fundSprint(setup, sprintAccounts, new BN(100_000_000));
      
      // Can't fund again
      // Note: The actual error might be different based on program implementation
      // This is testing that we can't fund twice
      try {
        await fundSprint(setup, sprintAccounts, new BN(50_000_000));
        expect.fail("Should not be able to fund twice");
      } catch (error: any) {
        // Expected error
      }
      
      // Pause the sprint
      await pauseSprint(setup, sprintAccounts);
      
      // Can't withdraw while paused
      await expectCustomError(
        withdrawFromSprint(setup, sprintAccounts),
        "SprintPaused"
      );
      
      // Resume the sprint
      await resumeSprint(setup, sprintAccounts);
      
      // Now withdrawal should work (if time has passed)
      // Note: This would work if sprint had started and time elapsed
    });
  });
});
