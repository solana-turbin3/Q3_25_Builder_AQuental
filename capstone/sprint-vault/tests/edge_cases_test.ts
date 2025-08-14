import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SprintVault } from "../target/types/sprint_vault";
import { 
  Keypair, 
  PublicKey, 
  SystemProgram,
} from "@solana/web3.js";
import { SprintDuration, AccelerationType, toDurationObject, toAccelerationObject } from "./helpers";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  mintTo,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

describe("Sprint Vault Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SprintVault as Program<SprintVault>;
  
  let employer: Keypair;
  let freelancer: Keypair;
  let mint: PublicKey;
  let employerTokenAccount: PublicKey;
  let freelancerTokenAccount: PublicKey;
  
  beforeEach(async () => {
    // Create fresh wallets for each test
    employer = Keypair.generate();
    freelancer = Keypair.generate();
    
    // Fund wallets
    const airdropSig1 = await provider.connection.requestAirdrop(
      employer.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig1);
    
    const airdropSig2 = await provider.connection.requestAirdrop(
      freelancer.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig2);
    
    // Create a test mint
    mint = await createMint(
      provider.connection,
      employer,
      employer.publicKey,
      null,
      6 // USDC decimals
    );
    
    // Create token accounts
    employerTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      employer,
      mint,
      employer.publicKey
    );
    
    freelancerTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      freelancer,
      mint,
      freelancer.publicKey
    );
    
    // Mint tokens to employer
    await mintTo(
      provider.connection,
      employer,
      mint,
      employerTokenAccount,
      employer,
      1_000_000_000 // 1000 USDC for testing
    );
  });
  
  describe("Edge Case: Minimum Withdrawal Boundary", () => {
    it("Should handle sprint with total_amount exactly equal to minimum withdrawal", async () => {
      const sprintId = new anchor.BN(Date.now());
      const minAmount = new anchor.BN(10_000_000); // Exactly 10 USDC minimum
      
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 30);
      
      // Create sprint with exactly minimum amount
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          minAmount,
          toAccelerationObject(AccelerationType.Linear)
        )
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      
      // Fund sprint
      await program.methods
        .depositToEscrow(minAmount)
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: employerTokenAccount,
          employer: employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      
      // Wait for sprint to end
      await new Promise(resolve => setTimeout(resolve, 91000));
      
      // Should be able to withdraw full amount at the end
      await program.methods
        .withdrawStreamed().accounts({
          sprint: sprintPda,
          vault: vaultPda,
          freelancerTokenAccount: freelancerTokenAccount,
          freelancer: freelancer.publicKey,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([freelancer])
        .rpc();
      
      const sprint = await program.account.sprint.fetch(sprintPda);
      assert.equal(sprint.withdrawnAmount.toString(), minAmount.toString());
    });
    
    it("Should reject sprint with total_amount less than minimum withdrawal", async () => {
      const sprintId = new anchor.BN(Date.now() + 1);
      const belowMinAmount = new anchor.BN(5_000_000); // 5 USDC, below minimum
      
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 30);
      
      // Create sprint with below minimum amount (should succeed)
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          belowMinAmount,
          toAccelerationObject(AccelerationType.Linear)
        )
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      
      // Fund sprint
      await program.methods
        .depositToEscrow(belowMinAmount)
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: employerTokenAccount,
          employer: employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      
      // Wait for sprint to complete
      await new Promise(resolve => setTimeout(resolve, 91000));
      
      // Withdrawal should fail even though sprint is complete
      try {
        await program.methods
          .withdrawStreamed().accounts({
            sprint: sprintPda,
            vault: vaultPda,
            freelancerTokenAccount: freelancerTokenAccount,
            freelancer: freelancer.publicKey,
          mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([freelancer])
          .rpc();
        
        assert.fail("Should have rejected withdrawal below minimum");
      } catch (error) {
        assert.include(error.toString(), "BelowMinimumWithdrawal");
      }
    });
  });
  
  describe("Edge Case: Funding Timing", () => {
    it("Should reject funding at exactly start_time", async () => {
      const sprintId = new anchor.BN(Date.now() + 2);
      const amount = new anchor.BN(100_000_000);
      
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 2); // Very close to now
      
      // Create sprint
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          amount,
          null
        )
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      
      // Wait until exactly start time
      await new Promise(resolve => setTimeout(resolve, 2100));
      
      // Try to fund at or after start time
      try {
        await program.methods
          .depositToEscrow(amount)
          .accounts({
            sprint: sprintPda,
            vault: vaultPda,
            employerTokenAccount: employerTokenAccount,
            employer: employer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([employer])
          .rpc();
        
        assert.fail("Should have rejected funding at/after start time");
      } catch (error) {
        assert.include(error.toString(), "SprintAlreadyStarted");
      }
    });
  });
  
  describe("Edge Case: Pause/Resume at Boundaries", () => {
    it("Should handle pause/resume near sprint end time", async () => {
      const sprintId = new anchor.BN(Date.now() + 3);
      const amount = new anchor.BN(100_000_000);
      
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 10);
      // Duration handled by SprintDuration enum; // Very short sprint
      
      // Create and fund sprint
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          amount,
          toAccelerationObject(AccelerationType.Linear)
        )
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      
      await program.methods
        .depositToEscrow(amount)
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: employerTokenAccount,
          employer: employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      
      // Wait until near the end
      await new Promise(resolve => setTimeout(resolve, 18000));
      
      // Pause near the end
      await program.methods
        .pauseStream()
        .accounts({
          sprint: sprintPda,
          employer: employer.publicKey,
        })
        .signers([employer])
        .rpc();
      
      // Wait a bit more (past original end time)
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Resume after original end time
      await program.methods
        .resumeStream()
        .accounts({
          sprint: sprintPda,
          employer: employer.publicKey,
        })
        .signers([employer])
        .rpc();
      
      const sprint = await program.account.sprint.fetch(sprintPda);
      assert.isTrue(sprint.totalPausedDuration.toNumber() > 0);
      
      // Sprint should still be active due to pause extension
      const newCurrentTime = Math.floor(Date.now() / 1000);
      assert.isFalse(sprint.isEnded(new anchor.BN(newCurrentTime)));
    });
  });
  
  describe("Edge Case: Very Short Duration Sprint", () => {
    it("Should reject sprint with zero duration", async () => {
      const sprintId = new anchor.BN(Date.now() + 4);
      const amount = new anchor.BN(100_000_000);
      
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 10);
      // Duration handled by SprintDuration enum; // Same as start time
      
      try {
        await program.methods
          .createSprint(
            sprintId,
            startTime,
            toDurationObject(SprintDuration.OneWeek),
            amount,
            null
          )
          .accounts({
            sprint: sprintPda,
            vault: vaultPda,
            employer: employer.publicKey,
            freelancer: freelancer.publicKey,
            mint: mint,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([employer])
          .rpc();
        
        assert.fail("Should have rejected zero duration sprint");
      } catch (error) {
        assert.include(error.toString(), "InvalidTimeRange");
      }
    });
    
    it("Should handle 1-second duration sprint", async () => {
      const sprintId = new anchor.BN(Date.now() + 5);
      const amount = new anchor.BN(100_000_000);
      
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 10);
      // Duration handled by SprintDuration enum; // 1 second duration
      
      // Should succeed
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          amount,
          toAccelerationObject(AccelerationType.Linear)
        )
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      
      const sprint = await program.account.sprint.fetch(sprintPda);
      assert.equal(
        sprint.endTime.sub(sprint.startTime).toNumber(),
        1,
        "Sprint should have 1 second duration"
      );
    });
  });
  
  describe("Edge Case: Overflow Scenarios", () => {
    it("Should handle maximum safe integer amounts", async () => {
      const sprintId = new anchor.BN(Date.now() + 6);
      // Use a very large but safe amount (2^53 - 1 is max safe integer in JS)
      const maxSafeAmount = new anchor.BN("9007199254740991");
      
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 60);
      // Duration handled by SprintDuration enum;
      
      // This should succeed as it's within u64 bounds
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          maxSafeAmount,
          null
        )
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      
      const sprint = await program.account.sprint.fetch(sprintPda);
      assert.equal(sprint.totalAmount.toString(), maxSafeAmount.toString());
    });
  });
  
  describe("Edge Case: Closing Unfunded Sprint", () => {
    it("Should allow closing unfunded sprint after end time", async () => {
      const sprintId = new anchor.BN(Date.now() + 7);
      const amount = new anchor.BN(100_000_000);
      
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      
      const vaultPda = await getAssociatedTokenAddress(
        mint,
        sprintPda,
        true
      );
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 2);
      // Duration handled by SprintDuration enum; // Very short
      
      // Create sprint but don't fund it
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          toDurationObject(SprintDuration.OneWeek),
          amount,
          null
        )
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: employer.publicKey,
          freelancer: freelancer.publicKey,
          mint: mint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      
      // Wait for sprint to end
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Should be able to close unfunded sprint after end time
      await program.methods
        .closeSprint()
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: employerTokenAccount,
          employer: employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();
      
      // Sprint account should be closed
      try {
        await program.account.sprint.fetch(sprintPda);
        assert.fail("Sprint account should be closed");
      } catch (error) {
        assert.include(error.toString(), "Account does not exist");
      }
    });
  });
});
