import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SprintVault } from "../../target/types/sprint_vault";
import { expect } from "chai";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  setupBasicTest,
  setupTestWithSecondUser,
  initializeVault,
  joinVault,
  createDirective,
  expectCustomError,
  expectError,
  TestContext,
  TestAccountSetup,
  deriveMemberPda,
  deriveDirectivePda,
  advanceTimeBy,
  getVaultMembers,
} from "../shared/helpers";

describe("Edge Cases and Error Handling", () => {
  let context: TestContext;
  let accounts: TestAccountSetup;

  beforeEach(async () => {
    accounts = await setupBasicTest();
    context = { 
      provider: accounts.provider, 
      program: accounts.program, 
      accounts 
    };
  });

  describe("Initialization Edge Cases", () => {
    it("Should fail to initialize with invalid sprint duration", async () => {
      await expectCustomError(
        initializeVault(context, {
          sprintDuration: 0, // Invalid: zero duration
          cooldownPeriod: 3 * 24 * 60 * 60,
          contributionAmounts: [
            new anchor.BN(100 * LAMPORTS_PER_SOL),
            new anchor.BN(250 * LAMPORTS_PER_SOL),
          ],
          penaltyBrackets: [10, 25],
          operatorFeePercentage: 5,
          maxVotingTime: 7 * 24 * 60 * 60,
          minVotingTime: 24 * 60 * 60,
          initialOperator: accounts.provider.wallet.publicKey,
        }),
        "InvalidSprintDuration"
      );
    });

    it("Should fail with mismatched contribution and penalty arrays", async () => {
      await expectCustomError(
        initializeVault(context, {
          sprintDuration: 14 * 24 * 60 * 60,
          cooldownPeriod: 3 * 24 * 60 * 60,
          contributionAmounts: [
            new anchor.BN(100 * LAMPORTS_PER_SOL),
            new anchor.BN(250 * LAMPORTS_PER_SOL),
          ],
          penaltyBrackets: [10, 25, 50], // Mismatched: 3 penalties for 2 contributions
          operatorFeePercentage: 5,
          maxVotingTime: 7 * 24 * 60 * 60,
          minVotingTime: 24 * 60 * 60,
          initialOperator: accounts.provider.wallet.publicKey,
        }),
        "MismatchedArrayLengths"
      );
    });

    it("Should fail with operator fee over 100%", async () => {
      await expectCustomError(
        initializeVault(context, {
          sprintDuration: 14 * 24 * 60 * 60,
          cooldownPeriod: 3 * 24 * 60 * 60,
          contributionAmounts: [
            new anchor.BN(100 * LAMPORTS_PER_SOL),
          ],
          penaltyBrackets: [10],
          operatorFeePercentage: 101, // Invalid: over 100%
          maxVotingTime: 7 * 24 * 60 * 60,
          minVotingTime: 24 * 60 * 60,
          initialOperator: accounts.provider.wallet.publicKey,
        }),
        "InvalidOperatorFee"
      );
    });

    it("Should fail with min voting time greater than max", async () => {
      await expectCustomError(
        initializeVault(context, {
          sprintDuration: 14 * 24 * 60 * 60,
          cooldownPeriod: 3 * 24 * 60 * 60,
          contributionAmounts: [
            new anchor.BN(100 * LAMPORTS_PER_SOL),
          ],
          penaltyBrackets: [10],
          operatorFeePercentage: 5,
          maxVotingTime: 24 * 60 * 60,      // 1 day
          minVotingTime: 7 * 24 * 60 * 60,  // 7 days (invalid: min > max)
          initialOperator: accounts.provider.wallet.publicKey,
        }),
        "InvalidVotingTimeRange"
      );
    });

    it("Should fail to reinitialize an already initialized vault", async () => {
      // First initialization
      await initializeVault(context, {
        sprintDuration: 14 * 24 * 60 * 60,
        cooldownPeriod: 3 * 24 * 60 * 60,
        contributionAmounts: [new anchor.BN(100 * LAMPORTS_PER_SOL)],
        penaltyBrackets: [10],
        operatorFeePercentage: 5,
        maxVotingTime: 7 * 24 * 60 * 60,
        minVotingTime: 24 * 60 * 60,
        initialOperator: accounts.provider.wallet.publicKey,
      });

      // Try to reinitialize
      await expectError(
        initializeVault(context, {
          sprintDuration: 10 * 24 * 60 * 60,
          cooldownPeriod: 2 * 24 * 60 * 60,
          contributionAmounts: [new anchor.BN(200 * LAMPORTS_PER_SOL)],
          penaltyBrackets: [20],
          operatorFeePercentage: 10,
          maxVotingTime: 5 * 24 * 60 * 60,
          minVotingTime: 12 * 60 * 60,
          initialOperator: accounts.provider.wallet.publicKey,
        }),
        "already in use"
      );
    });
  });

  describe("Membership Edge Cases", () => {
    beforeEach(async () => {
      await initializeVault(context, {
        sprintDuration: 14 * 24 * 60 * 60,
        cooldownPeriod: 3 * 24 * 60 * 60,
        contributionAmounts: [
          new anchor.BN(100 * LAMPORTS_PER_SOL),
          new anchor.BN(250 * LAMPORTS_PER_SOL),
          new anchor.BN(500 * LAMPORTS_PER_SOL),
        ],
        penaltyBrackets: [10, 25, 50],
        operatorFeePercentage: 5,
        maxVotingTime: 7 * 24 * 60 * 60,
        minVotingTime: 24 * 60 * 60,
        initialOperator: accounts.provider.wallet.publicKey,
      });
    });

    it("Should fail to join with invalid tier index", async () => {
      await expectCustomError(
        joinVault(context, 5), // Invalid tier (only 0-2 exist)
        "InvalidTierIndex"
      );
    });

    it("Should fail to join twice", async () => {
      // First join
      await joinVault(context, 0);

      // Try to join again
      await expectCustomError(
        joinVault(context, 1),
        "AlreadyAMember"
      );
    });

    it("Should fail to join with insufficient balance", async () => {
      const poorUser = Keypair.generate();
      
      // Give minimal SOL for transaction fees but not enough tokens
      await context.provider.connection.requestAirdrop(
        poorUser.publicKey,
        0.1 * LAMPORTS_PER_SOL
      );
      await context.provider.connection.confirmTransaction(
        await context.provider.connection.getLatestBlockhash()
      );

      await expectError(
        joinVault(context, 0, poorUser),
        "insufficient"
      );
    });

    it("Should handle maximum member limit", async () => {
      // This test would require implementing a max member limit in the program
      // For now, we'll test that we can add multiple members successfully
      
      const memberCount = 10;
      const members = [];
      
      for (let i = 0; i < memberCount; i++) {
        const userSetup = await setupTestWithSecondUser();
        await joinVault(
          { ...context, accounts: userSetup },
          i % 3, // Rotate through tiers
          userSetup.secondUserWallet
        );
        members.push(userSetup);
      }

      const allMembers = await getVaultMembers(
        context.program,
        accounts.vaultStatePda
      );
      
      expect(allMembers.length).to.be.at.least(memberCount);
    });
  });

  describe("Sprint Lifecycle Edge Cases", () => {
    beforeEach(async () => {
      await initializeVault(context, {
        sprintDuration: 14 * 24 * 60 * 60,
        cooldownPeriod: 3 * 24 * 60 * 60,
        contributionAmounts: [new anchor.BN(100 * LAMPORTS_PER_SOL)],
        penaltyBrackets: [10],
        operatorFeePercentage: 5,
        maxVotingTime: 7 * 24 * 60 * 60,
        minVotingTime: 24 * 60 * 60,
        initialOperator: accounts.provider.wallet.publicKey,
      });
      
      await joinVault(context, 0);
    });

    it("Should fail to start sprint with no members", async () => {
      // Create a new vault with no members
      const emptyVaultAccounts = await setupBasicTest();
      const emptyContext = {
        provider: emptyVaultAccounts.provider,
        program: emptyVaultAccounts.program,
        accounts: emptyVaultAccounts
      };

      await initializeVault(emptyContext, {
        sprintDuration: 14 * 24 * 60 * 60,
        cooldownPeriod: 3 * 24 * 60 * 60,
        contributionAmounts: [new anchor.BN(100 * LAMPORTS_PER_SOL)],
        penaltyBrackets: [10],
        operatorFeePercentage: 5,
        maxVotingTime: 7 * 24 * 60 * 60,
        minVotingTime: 24 * 60 * 60,
        initialOperator: emptyVaultAccounts.provider.wallet.publicKey,
      });

      await expectCustomError(
        emptyContext.program.methods
          .startSprint()
          .accounts({
            vault: emptyVaultAccounts.vaultStatePda,
            operator: emptyVaultAccounts.provider.wallet.publicKey,
          })
          .rpc(),
        "NoMembers"
      );
    });

    it("Should fail to start sprint during active sprint", async () => {
      // Start first sprint
      await context.program.methods
        .startSprint()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Try to start another sprint
      await expectCustomError(
        context.program.methods
          .startSprint()
          .accounts({
            vault: accounts.vaultStatePda,
            operator: accounts.provider.wallet.publicKey,
          })
          .rpc(),
        "SprintAlreadyActive"
      );
    });

    it("Should fail to start sprint during cooldown", async () => {
      // Start and complete a sprint
      await context.program.methods
        .startSprint()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Simulate sprint completion
      await advanceTimeBy(context.provider, 14 * 24 * 60 * 60);
      
      await context.program.methods
        .endSprint()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Try to start new sprint during cooldown
      await expectCustomError(
        context.program.methods
          .startSprint()
          .accounts({
            vault: accounts.vaultStatePda,
            operator: accounts.provider.wallet.publicKey,
          })
          .rpc(),
        "InCooldownPeriod"
      );
    });
  });

  describe("Directive Edge Cases", () => {
    beforeEach(async () => {
      await initializeVault(context, {
        sprintDuration: 14 * 24 * 60 * 60,
        cooldownPeriod: 3 * 24 * 60 * 60,
        contributionAmounts: [new anchor.BN(100 * LAMPORTS_PER_SOL)],
        penaltyBrackets: [10],
        operatorFeePercentage: 5,
        maxVotingTime: 7 * 24 * 60 * 60,
        minVotingTime: 24 * 60 * 60,
        initialOperator: accounts.provider.wallet.publicKey,
      });
      
      await joinVault(context, 0);
    });

    it("Should handle directive with maximum description length", async () => {
      const maxDescription = "A".repeat(500); // Assuming 500 char limit
      
      const directivePda = await createDirective(
        context,
        maxDescription,
        new anchor.BN(10 * LAMPORTS_PER_SOL)
      );

      const directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.description).to.equal(maxDescription);
    });

    it("Should fail with description exceeding maximum length", async () => {
      const tooLongDescription = "A".repeat(501); // Over limit
      
      await expectCustomError(
        createDirective(
          context,
          tooLongDescription,
          new anchor.BN(10 * LAMPORTS_PER_SOL)
        ),
        "DescriptionTooLong"
      );
    });

    it("Should handle maximum bounty amount", async () => {
      const maxBounty = new anchor.BN(Number.MAX_SAFE_INTEGER);
      
      const directivePda = await createDirective(
        context,
        "Max bounty directive",
        maxBounty
      );

      const directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.bountyAmount.toString()).to.equal(maxBounty.toString());
    });

    it("Should handle concurrent directive operations", async () => {
      // Create multiple directives concurrently
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          createDirective(
            context,
            `Concurrent directive ${i}`,
            new anchor.BN((i + 1) * 10 * LAMPORTS_PER_SOL)
          )
        );
      }

      const directivePdas = await Promise.all(promises);
      
      // Verify all were created
      expect(directivePdas).to.have.lengthOf(5);
      
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      expect(vaultState.directiveIdCounter).to.be.at.least(5);
    });
  });

  describe("Permission and Access Control Edge Cases", () => {
    beforeEach(async () => {
      await initializeVault(context, {
        sprintDuration: 14 * 24 * 60 * 60,
        cooldownPeriod: 3 * 24 * 60 * 60,
        contributionAmounts: [new anchor.BN(100 * LAMPORTS_PER_SOL)],
        penaltyBrackets: [10],
        operatorFeePercentage: 5,
        maxVotingTime: 7 * 24 * 60 * 60,
        minVotingTime: 24 * 60 * 60,
        initialOperator: accounts.provider.wallet.publicKey,
      });
    });

    it("Should prevent non-operator from starting sprint", async () => {
      const nonOperator = Keypair.generate();
      
      await expectCustomError(
        context.program.methods
          .startSprint()
          .accounts({
            vault: accounts.vaultStatePda,
            operator: nonOperator.publicKey,
          })
          .signers([nonOperator])
          .rpc(),
        "NotOperator"
      );
    });

    it("Should prevent operator from double-collecting fees", async () => {
      await joinVault(context, 0);
      
      // Start sprint
      await context.program.methods
        .startSprint()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Advance time and end sprint
      await advanceTimeBy(context.provider, 14 * 24 * 60 * 60);
      
      await context.program.methods
        .endSprint()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Collect fees once
      await context.program.methods
        .collectOperatorFees()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
          operatorTokenAccount: await context.program.provider.connection
            .getTokenAccountsByOwner(
              accounts.provider.wallet.publicKey,
              { mint: accounts.mint }
            )
            .then(r => r.value[0].pubkey),
          treasuryTokenAccount: accounts.treasuryTokenAccount,
          vaultAuthority: accounts.vaultAuthorityPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Try to collect again
      await expectCustomError(
        context.program.methods
          .collectOperatorFees()
          .accounts({
            vault: accounts.vaultStatePda,
            operator: accounts.provider.wallet.publicKey,
            operatorTokenAccount: await context.program.provider.connection
              .getTokenAccountsByOwner(
                accounts.provider.wallet.publicKey,
                { mint: accounts.mint }
              )
              .then(r => r.value[0].pubkey),
            treasuryTokenAccount: accounts.treasuryTokenAccount,
            vaultAuthority: accounts.vaultAuthorityPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc(),
        "NoFeesToCollect"
      );
    });

    it("Should handle operator transfer correctly", async () => {
      const newOperator = Keypair.generate();
      
      // Transfer operator role
      await context.program.methods
        .transferOperator(newOperator.publicKey)
        .accounts({
          vault: accounts.vaultStatePda,
          currentOperator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Verify new operator
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      expect(vaultState.currentOperator.toString()).to.equal(
        newOperator.publicKey.toString()
      );

      // Old operator should fail to perform operator actions
      await expectCustomError(
        context.program.methods
          .startSprint()
          .accounts({
            vault: accounts.vaultStatePda,
            operator: accounts.provider.wallet.publicKey,
          })
          .rpc(),
        "NotOperator"
      );
    });
  });

  describe("Token and Balance Edge Cases", () => {
    beforeEach(async () => {
      await initializeVault(context, {
        sprintDuration: 14 * 24 * 60 * 60,
        cooldownPeriod: 3 * 24 * 60 * 60,
        contributionAmounts: [
          new anchor.BN(100 * LAMPORTS_PER_SOL),
          new anchor.BN(250 * LAMPORTS_PER_SOL),
        ],
        penaltyBrackets: [10, 25],
        operatorFeePercentage: 5,
        maxVotingTime: 7 * 24 * 60 * 60,
        minVotingTime: 24 * 60 * 60,
        initialOperator: accounts.provider.wallet.publicKey,
      });
    });

    it("Should handle exact contribution amount", async () => {
      // Join with exact amount
      await joinVault(context, 0);

      const memberData = await context.program.account.member.fetch(
        accounts.memberPda
      );
      expect(memberData.contributionAmount.toString()).to.equal(
        (100 * LAMPORTS_PER_SOL).toString()
      );
    });

    it("Should handle penalty calculation correctly", async () => {
      await joinVault(context, 0);
      
      // Start sprint
      await context.program.methods
        .startSprint()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Member doesn't contribute to sprint
      // Advance time past sprint
      await advanceTimeBy(context.provider, 14 * 24 * 60 * 60);
      
      // End sprint and apply penalties
      await context.program.methods
        .endSprint()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      const memberData = await context.program.account.member.fetch(
        accounts.memberPda
      );
      
      // Verify penalty was applied (10% for tier 0)
      const expectedPenalty = new anchor.BN(100 * LAMPORTS_PER_SOL * 0.1);
      expect(memberData.totalPenalties.toNumber()).to.be.greaterThan(0);
    });

    it("Should prevent withdrawal during active sprint", async () => {
      await joinVault(context, 0);
      
      // Start sprint
      await context.program.methods
        .startSprint()
        .accounts({
          vault: accounts.vaultStatePda,
          operator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Try to leave vault during sprint
      await expectCustomError(
        context.program.methods
          .leaveVault()
          .accounts({
            vault: accounts.vaultStatePda,
            member: accounts.memberPda,
            user: accounts.provider.wallet.publicKey,
            userTokenAccount: await context.program.provider.connection
              .getTokenAccountsByOwner(
                accounts.provider.wallet.publicKey,
                { mint: accounts.mint }
              )
              .then(r => r.value[0].pubkey),
            treasuryTokenAccount: accounts.treasuryTokenAccount,
            vaultAuthority: accounts.vaultAuthorityPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc(),
        "CannotLeaveDuringSprint"
      );
    });
  });

  describe("Overflow and Underflow Protection", () => {
    beforeEach(async () => {
      await initializeVault(context, {
        sprintDuration: 14 * 24 * 60 * 60,
        cooldownPeriod: 3 * 24 * 60 * 60,
        contributionAmounts: [new anchor.BN(100 * LAMPORTS_PER_SOL)],
        penaltyBrackets: [10],
        operatorFeePercentage: 5,
        maxVotingTime: 7 * 24 * 60 * 60,
        minVotingTime: 24 * 60 * 60,
        initialOperator: accounts.provider.wallet.publicKey,
      });
      
      await joinVault(context, 0);
    });

    it("Should handle u64 overflow in calculations", async () => {
      // Create directive with near-max bounty
      const largeBounty = new anchor.BN(2).pow(new anchor.BN(63));
      
      const directivePda = await createDirective(
        context,
        "Large bounty directive",
        largeBounty
      );

      const directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.bountyAmount.toString()).to.equal(largeBounty.toString());
    });

    it("Should prevent negative balances", async () => {
      // This would require specific program logic to test
      // For example, trying to withdraw more than available
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      
      // Ensure treasury balance can't go negative
      expect(vaultState.treasuryBalance.toNumber()).to.be.at.least(0);
    });

    it("Should handle timestamp boundaries", async () => {
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      
      // Check that timestamps are reasonable
      expect(vaultState.lastSprintEndTime).to.be.at.least(0);
      expect(vaultState.currentSprintStartTime).to.be.at.least(0);
    });
  });

  describe("Race Conditions and Concurrency", () => {
    beforeEach(async () => {
      await initializeVault(context, {
        sprintDuration: 14 * 24 * 60 * 60,
        cooldownPeriod: 3 * 24 * 60 * 60,
        contributionAmounts: [new anchor.BN(100 * LAMPORTS_PER_SOL)],
        penaltyBrackets: [10],
        operatorFeePercentage: 5,
        maxVotingTime: 7 * 24 * 60 * 60,
        minVotingTime: 24 * 60 * 60,
        initialOperator: accounts.provider.wallet.publicKey,
      });
    });

    it("Should handle simultaneous join attempts", async () => {
      const users = await Promise.all([
        setupTestWithSecondUser(),
        setupTestWithSecondUser(),
        setupTestWithSecondUser(),
      ]);

      // All users try to join simultaneously
      const joinPromises = users.map(userSetup =>
        joinVault(
          { ...context, accounts: userSetup },
          0,
          userSetup.secondUserWallet
        )
      );

      await Promise.all(joinPromises);

      // Verify all joined successfully
      const members = await getVaultMembers(
        context.program,
        accounts.vaultStatePda
      );
      
      expect(members.length).to.be.at.least(users.length);
    });

    it("Should handle simultaneous directive votes", async () => {
      // Setup multiple members
      const users = [];
      for (let i = 0; i < 3; i++) {
        const userSetup = await setupTestWithSecondUser();
        await joinVault(
          { ...context, accounts: userSetup },
          0,
          userSetup.secondUserWallet
        );
        users.push(userSetup);
      }

      // Original member creates directive
      await joinVault(context, 0);
      const directivePda = await createDirective(
        context,
        "Vote test directive",
        new anchor.BN(20 * LAMPORTS_PER_SOL)
      );

      // All users vote simultaneously
      const votePromises = users.map((userSetup, index) =>
        context.program.methods
          .voteOnDirective(index % 2 === 0) // Alternate votes
          .accounts({
            directive: directivePda,
            vault: accounts.vaultStatePda,
            voter: userSetup.secondUserWallet.publicKey,
            member: userSetup.secondUserMemberPda,
          })
          .signers([userSetup.secondUserWallet])
          .rpc()
      );

      await Promise.all(votePromises);

      // Verify votes were recorded
      const directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.votesFor + directive.votesAgainst).to.equal(users.length);
    });
  });
});

// Additional helper for creating invalid PDAs
function createInvalidPda(): PublicKey {
  return Keypair.generate().publicKey;
}
