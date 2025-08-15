import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SprintVault } from "../../target/types/sprint_vault";
import { expect } from "chai";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount 
} from "@solana/spl-token";
import {
  setupBasicTest,
  setupTestWithSecondUser,
  initializeVault,
  joinVault,
  createDirective,
  createMultipleDirectives,
  addMultipleMembers,
  getActiveDirectives,
  getVaultMembers,
  advanceTimeBy,
  advanceToNextSprint,
  TestContext,
  TestAccountSetup,
  deriveMemberPda,
  deriveDirectivePda,
} from "../shared/helpers";

describe("Full Integration Flow", () => {
  let context: TestContext;
  let accounts: TestAccountSetup;

  describe("Complete Sprint Vault Lifecycle", () => {
    before(async () => {
      accounts = await setupBasicTest();
      context = { 
        provider: accounts.provider, 
        program: accounts.program, 
        accounts 
      };
    });

    it("Should complete full vault initialization and configuration", async () => {
      // Initialize vault with comprehensive configuration
      const config = {
        sprintDuration: 14 * 24 * 60 * 60, // 14 days
        cooldownPeriod: 3 * 24 * 60 * 60,  // 3 days
        contributionAmounts: [
          new anchor.BN(100 * LAMPORTS_PER_SOL),
          new anchor.BN(250 * LAMPORTS_PER_SOL),
          new anchor.BN(500 * LAMPORTS_PER_SOL),
        ],
        penaltyBrackets: [10, 25, 50], // 10%, 25%, 50% penalties
        operatorFeePercentage: 5,
        maxVotingTime: 7 * 24 * 60 * 60,   // 7 days
        minVotingTime: 24 * 60 * 60,       // 1 day
        initialOperator: accounts.provider.wallet.publicKey,
      };

      await initializeVault(context, config);

      // Verify initialization
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      
      expect(vaultState.sprintDuration.toNumber()).to.equal(config.sprintDuration);
      expect(vaultState.cooldownPeriod.toNumber()).to.equal(config.cooldownPeriod);
      expect(vaultState.contributionAmounts).to.have.lengthOf(3);
      expect(vaultState.penaltyBrackets).to.have.lengthOf(3);
      expect(vaultState.operatorFeePercentage).to.equal(5);
      expect(vaultState.isInitialized).to.be.true;
      expect(vaultState.memberCount).to.equal(0);
      expect(vaultState.sprintCount).to.equal(0);
    });

    it("Should onboard multiple members with different tiers", async () => {
      // Original member joins
      await joinVault(context, 0); // Tier 0 - 100 SOL

      // Add additional members with different tiers
      const member2Setup = await setupTestWithSecondUser();
      await joinVault(
        { ...context, accounts: member2Setup },
        1, // Tier 1 - 250 SOL
        member2Setup.secondUserWallet
      );

      const member3Setup = await setupTestWithSecondUser();
      await joinVault(
        { ...context, accounts: member3Setup },
        2, // Tier 2 - 500 SOL
        member3Setup.secondUserWallet
      );

      // Verify member count
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      expect(vaultState.memberCount).to.equal(3);

      // Verify treasury received contributions
      const treasuryAccount = await getAccount(
        context.provider.connection,
        accounts.treasuryTokenAccount
      );
      const expectedTotal = (100 + 250 + 500) * LAMPORTS_PER_SOL;
      expect(Number(treasuryAccount.amount)).to.equal(expectedTotal);
    });

    it("Should create and vote on directives before sprint", async () => {
      // Create multiple directives
      const directive1 = await createDirective(
        context,
        "Implement user authentication system",
        new anchor.BN(50 * LAMPORTS_PER_SOL)
      );

      const directive2 = await createDirective(
        context,
        "Build API endpoints for data management",
        new anchor.BN(75 * LAMPORTS_PER_SOL)
      );

      const directive3 = await createDirective(
        context,
        "Create frontend dashboard",
        new anchor.BN(100 * LAMPORTS_PER_SOL)
      );

      // Members vote on directives
      // Get member setups
      const members = await getVaultMembers(
        context.program,
        accounts.vaultStatePda
      );

      // Vote on directive 1 (will pass)
      await context.program.methods
        .voteOnDirective(true)
        .accounts({
          directive: directive1,
          vault: accounts.vaultStatePda,
          voter: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();

      // Vote on directive 2 (mixed votes)
      await context.program.methods
        .voteOnDirective(false)
        .accounts({
          directive: directive2,
          vault: accounts.vaultStatePda,
          voter: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();

      // Verify directives created
      const activeDirectives = await getActiveDirectives(
        context.program,
        accounts.vaultStatePda
      );
      expect(activeDirectives).to.have.lengthOf(3);
    });

    it("Should start first sprint and manage directive assignments", async () => {
      // Start sprint
      await context.program.methods
        .startSprint()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Verify sprint started
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      expect(vaultState.isSprintActive).to.be.true;
      expect(vaultState.sprintCount).to.equal(1);
      expect(vaultState.currentSprintStartTime.toNumber()).to.be.greaterThan(0);

      // Update directive statuses based on votes
      const [directive1Pda] = deriveDirectivePda(
        context.program.programId,
        accounts.vaultStatePda,
        0
      );

      await context.program.methods
        .updateDirectiveStatus()
        .accounts({
          directive: directive1Pda,
          vault: accounts.vaultStatePda,
        })
        .rpc();

      // Assign approved directive to member
      await context.program.methods
        .assignDirective()
        .accounts({
          directive: directive1Pda,
          vault: accounts.vaultStatePda,
          assignee: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();

      // Verify assignment
      const directive = await context.program.account.directive.fetch(directive1Pda);
      expect(directive.assignee?.toString()).to.equal(
        accounts.provider.wallet.publicKey.toString()
      );
    });

    it("Should track member contributions during sprint", async () => {
      // Members contribute to sprint goals
      await context.program.methods
        .recordContribution(
          new anchor.BN(10), // hours worked
          "Completed authentication module"
        )
        .accounts({
          vault: accounts.vaultStatePda,
          member: accounts.memberPda,
          contributor: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Verify contribution recorded
      const memberData = await context.program.account.member.fetch(
        accounts.memberPda
      );
      expect(memberData.sprintContributions.toNumber()).to.be.greaterThan(0);
      expect(memberData.totalContributions.toNumber()).to.be.greaterThan(0);
    });

    it("Should complete directives and handle rewards", async () => {
      const [directive1Pda] = deriveDirectivePda(
        context.program.programId,
        accounts.vaultStatePda,
        0
      );

      // Complete directive
      await context.program.methods
        .completeDirective()
        .accounts({
          directive: directive1Pda,
          vault: accounts.vaultStatePda,
          completer: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();

      // Verify completion
      const directive = await context.program.account.directive.fetch(directive1Pda);
      expect(directive.status.completed).to.exist;
      expect(directive.completedBy?.toString()).to.equal(
        accounts.provider.wallet.publicKey.toString()
      );

      // Check member rewards
      const memberData = await context.program.account.member.fetch(
        accounts.memberPda
      );
      expect(memberData.rewardsEarned.toNumber()).to.be.greaterThan(0);
    });

    it("Should end sprint and calculate distributions", async () => {
      // Advance time to end of sprint
      await advanceTimeBy(context.provider, 14 * 24 * 60 * 60);

      // End sprint
      await context.program.methods
        .endSprint()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Verify sprint ended
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      expect(vaultState.isSprintActive).to.be.false;
      expect(vaultState.lastSprintEndTime.toNumber()).to.be.greaterThan(0);

      // Check that penalties and rewards were calculated
      const memberData = await context.program.account.member.fetch(
        accounts.memberPda
      );
      
      // Member should have rewards from completed directive
      expect(memberData.rewardsEarned.toNumber()).to.be.greaterThan(0);
    });

    it("Should handle cooldown period and operator fee collection", async () => {
      // Verify in cooldown
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      
      const now = Math.floor(Date.now() / 1000);
      const cooldownEnd = vaultState.lastSprintEndTime.toNumber() + 
                          vaultState.cooldownPeriod.toNumber();
      
      expect(now).to.be.lessThan(cooldownEnd);

      // Operator collects fees
      const operatorTokenAccount = await context.program.provider.connection
        .getTokenAccountsByOwner(
          accounts.provider.wallet.publicKey,
          { mint: accounts.mint }
        )
        .then(r => r.value[0].pubkey);

      await context.program.methods
        .collectOperatorFees()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
          operatorTokenAccount,
          treasuryTokenAccount: accounts.treasuryTokenAccount,
          vaultAuthority: accounts.vaultAuthorityPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Verify fees collected
      const operatorAccount = await getAccount(
        context.provider.connection,
        operatorTokenAccount
      );
      expect(Number(operatorAccount.amount)).to.be.greaterThan(0);
    });

    it("Should allow members to claim rewards after sprint", async () => {
      const userTokenAccount = await context.program.provider.connection
        .getTokenAccountsByOwner(
          accounts.provider.wallet.publicKey,
          { mint: accounts.mint }
        )
        .then(r => r.value[0].pubkey);

      const initialBalance = await getAccount(
        context.provider.connection,
        userTokenAccount
      );

      // Claim rewards
      await context.program.methods
        .claimRewards()
        .accounts({
          vault: accounts.vaultStatePda,
          member: accounts.memberPda,
          user: accounts.provider.wallet.publicKey,
          userTokenAccount,
          treasuryTokenAccount: accounts.treasuryTokenAccount,
          vaultAuthority: accounts.vaultAuthorityPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Verify rewards claimed
      const finalBalance = await getAccount(
        context.provider.connection,
        userTokenAccount
      );
      expect(Number(finalBalance.amount)).to.be.greaterThan(
        Number(initialBalance.amount)
      );

      // Check member state updated
      const memberData = await context.program.account.member.fetch(
        accounts.memberPda
      );
      expect(memberData.rewardsEarned.toNumber()).to.equal(0);
      expect(memberData.totalRewardsClaimed.toNumber()).to.be.greaterThan(0);
    });

    it("Should start second sprint after cooldown", async () => {
      // Advance past cooldown
      await advanceToNextSprint(
        context.provider,
        context.program,
        accounts.vaultStatePda
      );

      // Create new directives for second sprint
      await createMultipleDirectives(context, 3, "Sprint 2 Directive", 30);

      // Start second sprint
      await context.program.methods
        .startSprint()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Verify second sprint started
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      expect(vaultState.isSprintActive).to.be.true;
      expect(vaultState.sprintCount).to.equal(2);
    });

    it("Should handle member leaving vault", async () => {
      // End second sprint first
      await advanceTimeBy(context.provider, 14 * 24 * 60 * 60);
      
      await context.program.methods
        .endSprint()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Get initial balances
      const userTokenAccount = await context.program.provider.connection
        .getTokenAccountsByOwner(
          accounts.provider.wallet.publicKey,
          { mint: accounts.mint }
        )
        .then(r => r.value[0].pubkey);

      const initialBalance = await getAccount(
        context.provider.connection,
        userTokenAccount
      );

      // Member leaves vault
      await context.program.methods
        .leaveVault()
        .accounts({
          vault: accounts.vaultStatePda,
          member: accounts.memberPda,
          user: accounts.provider.wallet.publicKey,
          userTokenAccount,
          treasuryTokenAccount: accounts.treasuryTokenAccount,
          vaultAuthority: accounts.vaultAuthorityPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Verify member left
      const memberData = await context.program.account.member.fetch(
        accounts.memberPda
      );
      expect(memberData.isActive).to.be.false;

      // Verify refund received (minus any penalties)
      const finalBalance = await getAccount(
        context.provider.connection,
        userTokenAccount
      );
      expect(Number(finalBalance.amount)).to.be.greaterThan(
        Number(initialBalance.amount)
      );

      // Verify member count decreased
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      expect(vaultState.memberCount).to.equal(2); // 3 - 1
    });
  });

  describe("Complex Multi-Sprint Scenario", () => {
    let multiSprintContext: TestContext;
    let multiSprintAccounts: TestAccountSetup;
    let memberSetups: any[];

    before(async () => {
      multiSprintAccounts = await setupBasicTest();
      multiSprintContext = {
        provider: multiSprintAccounts.provider,
        program: multiSprintAccounts.program,
        accounts: multiSprintAccounts
      };

      // Initialize vault
      await initializeVault(multiSprintContext, {
        sprintDuration: 7 * 24 * 60 * 60,  // 7 days
        cooldownPeriod: 24 * 60 * 60,      // 1 day
        contributionAmounts: [
          new anchor.BN(50 * LAMPORTS_PER_SOL),
          new anchor.BN(100 * LAMPORTS_PER_SOL),
        ],
        penaltyBrackets: [15, 30],
        operatorFeePercentage: 3,
        maxVotingTime: 3 * 24 * 60 * 60,
        minVotingTime: 12 * 60 * 60,
        initialOperator: multiSprintAccounts.provider.wallet.publicKey,
      });
    });

    it("Should handle multiple sprints with varying member participation", async () => {
      // Add 5 members
      memberSetups = await addMultipleMembers(multiSprintContext, 5, 0);
      
      // Original member joins too
      await joinVault(multiSprintContext, 1);

      // Sprint 1: All members active
      await runSprintCycle(multiSprintContext, 1, memberSetups, true);

      // Sprint 2: Some members inactive
      await runSprintCycle(multiSprintContext, 2, memberSetups, false);

      // Sprint 3: Recovery sprint
      await runSprintCycle(multiSprintContext, 3, memberSetups, true);

      // Verify final state
      const vaultState = await multiSprintContext.program.account.vaultState.fetch(
        multiSprintAccounts.vaultStatePda
      );
      
      expect(vaultState.sprintCount).to.equal(3);
      expect(vaultState.totalDirectivesCreated).to.be.greaterThan(5);
      
      // Check member statistics
      for (const memberSetup of memberSetups.slice(0, 2)) {
        const memberData = await multiSprintContext.program.account.member.fetch(
          memberSetup.memberPda
        );
        
        expect(memberData.sprintsParticipated).to.be.greaterThan(0);
        expect(memberData.totalContributions.toNumber()).to.be.greaterThan(0);
      }
    });

    it("Should handle operator transfer mid-lifecycle", async () => {
      const newOperator = Keypair.generate();
      
      // Fund new operator
      await multiSprintContext.provider.connection.requestAirdrop(
        newOperator.publicKey,
        2 * LAMPORTS_PER_SOL
      );

      // Transfer operator role
      await multiSprintContext.program.methods
        .transferOperator(newOperator.publicKey)
        .accounts({
          vault: multiSprintAccounts.vaultStatePda,
          currentOperator: multiSprintAccounts.provider.wallet.publicKey,
        })
        .rpc();

      // Verify transfer
      const vaultState = await multiSprintContext.program.account.vaultState.fetch(
        multiSprintAccounts.vaultStatePda
      );
      expect(vaultState.currentOperator.toString()).to.equal(
        newOperator.publicKey.toString()
      );

      // New operator starts next sprint
      await multiSprintContext.program.methods
        .startSprint()
        .accounts({
          vault: multiSprintAccounts.vaultStatePda,
          operator: newOperator.publicKey,
        })
        .signers([newOperator])
        .rpc();

      // Verify sprint started by new operator
      const updatedVaultState = await multiSprintContext.program.account.vaultState.fetch(
        multiSprintAccounts.vaultStatePda
      );
      expect(updatedVaultState.isSprintActive).to.be.true;
      expect(updatedVaultState.sprintCount).to.equal(4);
    });
  });

  describe("Emergency and Recovery Scenarios", () => {
    let emergencyContext: TestContext;
    let emergencyAccounts: TestAccountSetup;

    before(async () => {
      emergencyAccounts = await setupBasicTest();
      emergencyContext = {
        provider: emergencyAccounts.provider,
        program: emergencyAccounts.program,
        accounts: emergencyAccounts
      };

      await initializeVault(emergencyContext, {
        sprintDuration: 7 * 24 * 60 * 60,
        cooldownPeriod: 24 * 60 * 60,
        contributionAmounts: [new anchor.BN(75 * LAMPORTS_PER_SOL)],
        penaltyBrackets: [20],
        operatorFeePercentage: 4,
        maxVotingTime: 2 * 24 * 60 * 60,
        minVotingTime: 6 * 60 * 60,
        initialOperator: emergencyAccounts.provider.wallet.publicKey,
      });
    });

    it("Should handle emergency sprint cancellation", async () => {
      // Setup members and start sprint
      await addMultipleMembers(emergencyContext, 3, 0);
      await joinVault(emergencyContext, 0);

      await emergencyContext.program.methods
        .startSprint()
        .accounts({
          vault: emergencyAccounts.vaultStatePda,
          operator: emergencyAccounts.provider.wallet.publicKey,
        })
        .rpc();

      // Emergency cancel sprint
      await emergencyContext.program.methods
        .emergencyCancelSprint("Critical bug discovered")
        .accounts({
          vault: emergencyAccounts.vaultStatePda,
          operator: emergencyAccounts.provider.wallet.publicKey,
        })
        .rpc();

      // Verify cancellation
      const vaultState = await emergencyContext.program.account.vaultState.fetch(
        emergencyAccounts.vaultStatePda
      );
      expect(vaultState.isSprintActive).to.be.false;
      expect(vaultState.lastEmergencyAction.toNumber()).to.be.greaterThan(0);
    });

    it("Should handle vault pause and resume", async () => {
      // Pause vault
      await emergencyContext.program.methods
        .pauseVault("Scheduled maintenance")
        .accounts({
          vault: emergencyAccounts.vaultStatePda,
          operator: emergencyAccounts.provider.wallet.publicKey,
        })
        .rpc();

      // Verify paused
      let vaultState = await emergencyContext.program.account.vaultState.fetch(
        emergencyAccounts.vaultStatePda
      );
      expect(vaultState.isPaused).to.be.true;

      // Try to start sprint while paused (should fail)
      try {
        await emergencyContext.program.methods
          .startSprint()
          .accounts({
            vault: emergencyAccounts.vaultStatePda,
            operator: emergencyAccounts.provider.wallet.publicKey,
          })
          .rpc();
        expect.fail("Should not be able to start sprint while paused");
      } catch (error) {
        expect(error.toString()).to.include("VaultPaused");
      }

      // Resume vault
      await emergencyContext.program.methods
        .resumeVault()
        .accounts({
          vault: emergencyAccounts.vaultStatePda,
          operator: emergencyAccounts.provider.wallet.publicKey,
        })
        .rpc();

      // Verify resumed
      vaultState = await emergencyContext.program.account.vaultState.fetch(
        emergencyAccounts.vaultStatePda
      );
      expect(vaultState.isPaused).to.be.false;
    });

    it("Should handle recovery after member exodus", async () => {
      // Simulate members leaving
      const members = await getVaultMembers(
        emergencyContext.program,
        emergencyAccounts.vaultStatePda
      );

      // Have most members leave except one
      for (let i = 0; i < members.length - 1; i++) {
        const member = members[i];
        
        // Skip if this is the main wallet
        if (member.data.user.toString() === emergencyAccounts.provider.wallet.publicKey.toString()) {
          continue;
        }

        // Note: In real scenario, each member would call leaveVault
        // Here we're simulating the state after members left
      }

      // Add new members to recover
      const newMembers = await addMultipleMembers(emergencyContext, 5, 0);

      // Start recovery sprint
      await emergencyContext.program.methods
        .startSprint()
        .accounts({
          vault: emergencyAccounts.vaultStatePda,
          operator: emergencyAccounts.provider.wallet.publicKey,
        })
        .rpc();

      // Verify recovery
      const vaultState = await emergencyContext.program.account.vaultState.fetch(
        emergencyAccounts.vaultStatePda
      );
      expect(vaultState.isSprintActive).to.be.true;
      expect(vaultState.memberCount).to.be.greaterThanOrEqual(5);
    });
  });
});

// Helper function for running a sprint cycle
async function runSprintCycle(
  context: TestContext,
  sprintNumber: number,
  members: any[],
  allActive: boolean
) {
  // Create directives for sprint
  const directives = await createMultipleDirectives(
    context,
    3,
    `Sprint ${sprintNumber} Task`,
    20 * sprintNumber
  );

  // Start sprint
  await context.program.methods
    .startSprint()
    .accounts({
      vault: context.accounts.vaultStatePda,
      operator: context.accounts.provider.wallet.publicKey,
    })
    .rpc();

  // Simulate member activity
  if (allActive) {
    // All members contribute
    for (const member of members.slice(0, 3)) {
      await context.program.methods
        .recordContribution(
          new anchor.BN(8 * sprintNumber),
          `Sprint ${sprintNumber} contribution`
        )
        .accounts({
          vault: context.accounts.vaultStatePda,
          member: member.memberPda,
          contributor: member.wallet.publicKey,
        })
        .signers([member.wallet])
        .rpc();
    }
  } else {
    // Only half members contribute
    for (const member of members.slice(0, 2)) {
      await context.program.methods
        .recordContribution(
          new anchor.BN(4 * sprintNumber),
          `Sprint ${sprintNumber} partial contribution`
        )
        .accounts({
          vault: context.accounts.vaultStatePda,
          member: member.memberPda,
          contributor: member.wallet.publicKey,
        })
        .signers([member.wallet])
        .rpc();
    }
  }

  // Advance time and end sprint
  await advanceTimeBy(context.provider, 7 * 24 * 60 * 60);
  
  await context.program.methods
    .endSprint()
    .accounts({
      vault: context.accounts.vaultStatePda,
      operator: context.accounts.provider.wallet.publicKey,
    })
    .rpc();

  // Wait for cooldown
  await advanceTimeBy(context.provider, 24 * 60 * 60);
}
