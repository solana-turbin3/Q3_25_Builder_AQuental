import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SprintVault } from "../../target/types/sprint_vault";
import { expect } from "chai";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  setupBasicTest,
  setupTestWithSecondUser,
  initializeVault,
  joinVault,
  createDirective,
  assertDirectiveCreated,
  expectCustomError,
  createMultipleDirectives,
  getActiveDirectives,
  TestContext,
  TestAccountSetup,
  deriveMemberPda,
  deriveDirectivePda,
} from "../shared/helpers";

describe("Directive Operations", () => {
  let context: TestContext;
  let accounts: TestAccountSetup;

  beforeEach(async () => {
    accounts = await setupBasicTest();
    context = { 
      provider: accounts.provider, 
      program: accounts.program, 
      accounts 
    };

    // Initialize vault with standard config
    await initializeVault(context, {
      sprintDuration: 14 * 24 * 60 * 60, // 14 days
      cooldownPeriod: 3 * 24 * 60 * 60,  // 3 days
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

    // Join vault as member
    await joinVault(context, 0);
  });

  describe("Directive Creation", () => {
    it("Should create a directive successfully", async () => {
      const description = "Build new feature X";
      const bountyAmount = new anchor.BN(50 * LAMPORTS_PER_SOL);

      const directivePda = await createDirective(
        context,
        description,
        bountyAmount
      );

      await assertDirectiveCreated(
        context.program,
        directivePda,
        description,
        bountyAmount,
        accounts.provider.wallet.publicKey
      );
    });

    it("Should increment directive ID counter", async () => {
      const firstDirective = await createDirective(
        context,
        "First directive",
        new anchor.BN(10 * LAMPORTS_PER_SOL)
      );

      const secondDirective = await createDirective(
        context,
        "Second directive",
        new anchor.BN(20 * LAMPORTS_PER_SOL)
      );

      // Check vault state counter
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      expect(vaultState.directiveIdCounter).to.equal(2);

      // Verify both directives exist
      const firstData = await context.program.account.directive.fetch(firstDirective);
      expect(firstData.description).to.equal("First directive");

      const secondData = await context.program.account.directive.fetch(secondDirective);
      expect(secondData.description).to.equal("Second directive");
    });

    it("Should fail if creator is not a member", async () => {
      const nonMemberAccounts = await setupTestWithSecondUser();
      const nonMemberContext = {
        provider: nonMemberAccounts.provider,
        program: nonMemberAccounts.program,
        accounts: nonMemberAccounts
      };

      await expectCustomError(
        createDirective(
          nonMemberContext,
          "Invalid directive",
          new anchor.BN(10 * LAMPORTS_PER_SOL),
          nonMemberAccounts.secondUserWallet
        ),
        "NotAMember"
      );
    });

    it("Should fail with empty description", async () => {
      await expectCustomError(
        createDirective(
          context,
          "",
          new anchor.BN(10 * LAMPORTS_PER_SOL)
        ),
        "InvalidDescription"
      );
    });

    it("Should fail with zero bounty amount", async () => {
      await expectCustomError(
        createDirective(
          context,
          "Valid description",
          new anchor.BN(0)
        ),
        "InvalidBountyAmount"
      );
    });
  });

  describe("Directive Voting", () => {
    let directivePda: PublicKey;

    beforeEach(async () => {
      directivePda = await createDirective(
        context,
        "Test directive for voting",
        new anchor.BN(25 * LAMPORTS_PER_SOL)
      );
    });

    it("Should allow member to vote on directive", async () => {
      await context.program.methods
        .voteOnDirective(true)
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
          voter: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();

      const directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.votesFor).to.equal(1);
      expect(directive.votesAgainst).to.equal(0);
    });

    it("Should track votes for and against", async () => {
      // Add second member
      const secondUserSetup = await setupTestWithSecondUser();
      const secondContext = {
        provider: secondUserSetup.provider,
        program: secondUserSetup.program,
        accounts: secondUserSetup
      };
      
      await joinVault(secondContext, 0, secondUserSetup.secondUserWallet);

      // First member votes for
      await context.program.methods
        .voteOnDirective(true)
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
          voter: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();

      // Second member votes against
      await secondContext.program.methods
        .voteOnDirective(false)
        .accounts({
          directive: directivePda,
          vault: secondUserSetup.vaultStatePda,
          voter: secondUserSetup.secondUserWallet.publicKey,
          member: secondUserSetup.secondUserMemberPda,
        })
        .signers([secondUserSetup.secondUserWallet])
        .rpc();

      const directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.votesFor).to.equal(1);
      expect(directive.votesAgainst).to.equal(1);
    });

    it("Should prevent double voting", async () => {
      // First vote
      await context.program.methods
        .voteOnDirective(true)
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
          voter: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();

      // Try to vote again
      await expectCustomError(
        context.program.methods
          .voteOnDirective(false)
          .accounts({
            directive: directivePda,
            vault: accounts.vaultStatePda,
            voter: accounts.provider.wallet.publicKey,
            member: accounts.memberPda,
          })
          .rpc(),
        "AlreadyVoted"
      );
    });

    it("Should prevent non-members from voting", async () => {
      const nonMemberSetup = await setupTestWithSecondUser();
      
      await expectCustomError(
        nonMemberSetup.program.methods
          .voteOnDirective(true)
          .accounts({
            directive: directivePda,
            vault: nonMemberSetup.vaultStatePda,
            voter: nonMemberSetup.secondUserWallet.publicKey,
            member: nonMemberSetup.secondUserMemberPda,
          })
          .signers([nonMemberSetup.secondUserWallet])
          .rpc(),
        "NotAMember"
      );
    });
  });

  describe("Directive Status Updates", () => {
    let directivePda: PublicKey;

    beforeEach(async () => {
      directivePda = await createDirective(
        context,
        "Directive for status testing",
        new anchor.BN(30 * LAMPORTS_PER_SOL)
      );
    });

    it("Should approve directive with sufficient votes", async () => {
      // Add multiple members and have them vote
      const additionalMembers = await setupMultipleVotingMembers(context, 3);
      
      // Original member votes for
      await voteOnDirective(context, directivePda, true);
      
      // Additional members vote for
      for (const member of additionalMembers) {
        await voteOnDirective(
          { ...context, accounts: { ...context.accounts, ...member } },
          directivePda,
          true,
          member.wallet
        );
      }

      // Update directive status
      await context.program.methods
        .updateDirectiveStatus()
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
        })
        .rpc();

      const directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.status.active).to.exist;
    });

    it("Should reject directive with insufficient votes", async () => {
      // Add multiple members and have them vote against
      const additionalMembers = await setupMultipleVotingMembers(context, 3);
      
      // Original member votes against
      await voteOnDirective(context, directivePda, false);
      
      // Additional members vote against
      for (const member of additionalMembers) {
        await voteOnDirective(
          { ...context, accounts: { ...context.accounts, ...member } },
          directivePda,
          false,
          member.wallet
        );
      }

      // Update directive status
      await context.program.methods
        .updateDirectiveStatus()
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
        })
        .rpc();

      const directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.status.rejected).to.exist;
    });

    it("Should mark directive as completed", async () => {
      // First approve the directive
      await approveDirective(context, directivePda);

      // Mark as completed by assignee
      await context.program.methods
        .completeDirective()
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
          completer: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();

      const directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.status.completed).to.exist;
    });

    it("Should cancel directive by creator", async () => {
      await context.program.methods
        .cancelDirective()
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
          creator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      const directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.status.cancelled).to.exist;
    });

    it("Should prevent cancellation by non-creator", async () => {
      const secondUserSetup = await setupTestWithSecondUser();
      await joinVault(
        { ...context, accounts: secondUserSetup },
        0,
        secondUserSetup.secondUserWallet
      );

      await expectCustomError(
        context.program.methods
          .cancelDirective()
          .accounts({
            directive: directivePda,
            vault: accounts.vaultStatePda,
            creator: secondUserSetup.secondUserWallet.publicKey,
          })
          .signers([secondUserSetup.secondUserWallet])
          .rpc(),
        "Unauthorized"
      );
    });
  });

  describe("Directive Assignment", () => {
    let directivePda: PublicKey;

    beforeEach(async () => {
      directivePda = await createDirective(
        context,
        "Directive for assignment",
        new anchor.BN(40 * LAMPORTS_PER_SOL)
      );
      
      // Approve the directive
      await approveDirective(context, directivePda);
    });

    it("Should assign directive to member", async () => {
      await context.program.methods
        .assignDirective()
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
          assignee: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();

      const directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.assignee?.toString()).to.equal(
        accounts.provider.wallet.publicKey.toString()
      );
    });

    it("Should prevent assignment to non-member", async () => {
      const nonMemberSetup = await setupTestWithSecondUser();
      
      await expectCustomError(
        context.program.methods
          .assignDirective()
          .accounts({
            directive: directivePda,
            vault: accounts.vaultStatePda,
            assignee: nonMemberSetup.secondUserWallet.publicKey,
            member: nonMemberSetup.secondUserMemberPda,
          })
          .signers([nonMemberSetup.secondUserWallet])
          .rpc(),
        "NotAMember"
      );
    });

    it("Should prevent double assignment", async () => {
      // First assignment
      await context.program.methods
        .assignDirective()
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
          assignee: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();

      // Try to assign to another member
      const secondUserSetup = await setupTestWithSecondUser();
      await joinVault(
        { ...context, accounts: secondUserSetup },
        0,
        secondUserSetup.secondUserWallet
      );

      await expectCustomError(
        context.program.methods
          .assignDirective()
          .accounts({
            directive: directivePda,
            vault: accounts.vaultStatePda,
            assignee: secondUserSetup.secondUserWallet.publicKey,
            member: secondUserSetup.secondUserMemberPda,
          })
          .signers([secondUserSetup.secondUserWallet])
          .rpc(),
        "DirectiveAlreadyAssigned"
      );
    });

    it("Should unassign directive", async () => {
      // First assign
      await context.program.methods
        .assignDirective()
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
          assignee: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();

      // Unassign
      await context.program.methods
        .unassignDirective()
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
          assignee: accounts.provider.wallet.publicKey,
        })
        .rpc();

      const directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.assignee).to.be.null;
    });
  });

  describe("Batch Directive Operations", () => {
    it("Should create multiple directives", async () => {
      const directivePdas = await createMultipleDirectives(context, 5);
      
      expect(directivePdas).to.have.lengthOf(5);
      
      const vaultState = await context.program.account.vaultState.fetch(
        accounts.vaultStatePda
      );
      expect(vaultState.directiveIdCounter).to.equal(5);
    });

    it("Should query active directives", async () => {
      // Create some directives
      await createMultipleDirectives(context, 3);
      
      // Get one directive and cancel it
      const [directivePda] = deriveDirectivePda(
        context.program.programId,
        accounts.vaultStatePda,
        0
      );
      
      await context.program.methods
        .cancelDirective()
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
          creator: accounts.provider.wallet.publicKey,
        })
        .rpc();

      // Query active directives
      const activeDirectives = await getActiveDirectives(
        context.program,
        accounts.vaultStatePda
      );
      
      // Should have 2 active (proposed) and 1 cancelled (not included)
      expect(activeDirectives).to.have.lengthOf(2);
    });

    it("Should handle directive lifecycle", async () => {
      const directivePda = await createDirective(
        context,
        "Full lifecycle directive",
        new anchor.BN(50 * LAMPORTS_PER_SOL)
      );

      // Check initial status
      let directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.status.proposed).to.exist;

      // Approve it
      await approveDirective(context, directivePda);
      directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.status.active).to.exist;

      // Assign it
      await context.program.methods
        .assignDirective()
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
          assignee: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();
      
      directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.assignee).to.not.be.null;

      // Complete it
      await context.program.methods
        .completeDirective()
        .accounts({
          directive: directivePda,
          vault: accounts.vaultStatePda,
          completer: accounts.provider.wallet.publicKey,
          member: accounts.memberPda,
        })
        .rpc();

      directive = await context.program.account.directive.fetch(directivePda);
      expect(directive.status.completed).to.exist;
    });
  });
});

// Helper functions specific to directive tests
async function setupMultipleVotingMembers(
  context: TestContext,
  count: number
) {
  const members = [];
  for (let i = 0; i < count; i++) {
    const userSetup = await setupTestWithSecondUser();
    await joinVault(
      { ...context, accounts: userSetup },
      0,
      userSetup.secondUserWallet
    );
    members.push({
      wallet: userSetup.secondUserWallet,
      memberPda: userSetup.secondUserMemberPda,
    });
  }
  return members;
}

async function voteOnDirective(
  context: TestContext,
  directivePda: PublicKey,
  voteFor: boolean,
  voter?: any
) {
  const voterWallet = voter?.wallet || context.accounts.provider.wallet;
  const memberPda = voter?.memberPda || context.accounts.memberPda;

  await context.program.methods
    .voteOnDirective(voteFor)
    .accounts({
      directive: directivePda,
      vault: context.accounts.vaultStatePda,
      voter: voterWallet.publicKey,
      member: memberPda,
    })
    .signers(voter?.wallet ? [voter.wallet] : [])
    .rpc();
}

async function approveDirective(
  context: TestContext,
  directivePda: PublicKey
) {
  // Simulate approval by having enough votes
  const additionalMembers = await setupMultipleVotingMembers(context, 2);
  
  await voteOnDirective(context, directivePda, true);
  
  for (const member of additionalMembers) {
    await voteOnDirective(
      { ...context, accounts: { ...context.accounts, ...member } },
      directivePda,
      true,
      member
    );
  }

  await context.program.methods
    .updateDirectiveStatus()
    .accounts({
      directive: directivePda,
      vault: context.accounts.vaultStatePda,
    })
    .rpc();
}
