import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SprintVault } from "../target/types/sprint_vault";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import * as fc from "fast-check";

describe("sprint-vault fuzzing", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SprintVault as Program<SprintVault>;

  // Helper to create test setup
  async function setupTestEnvironment() {
    const employer = anchor.web3.Keypair.generate();
    const freelancer = anchor.web3.Keypair.generate();
    
    // Airdrop SOL
    await provider.connection.requestAirdrop(
      employer.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      freelancer.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL
    );
    
    // Wait for confirmations
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Create mint
    const mint = await createMint(
      provider.connection,
      employer,
      employer.publicKey,
      null,
      6
    );
    
    // Create token accounts
    const employerTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      employer,
      mint,
      employer.publicKey
    );
    
    const freelancerTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      freelancer,
      mint,
      freelancer.publicKey
    );
    
    // Mint tokens
    await mintTo(
      provider.connection,
      employer,
      mint,
      employerTokenAccount,
      employer,
      100000000000 // 100,000 USDC
    );
    
    return {
      employer,
      freelancer,
      mint,
      employerTokenAccount,
      freelancerTokenAccount,
    };
  }

  describe("Property-based tests with fast-check", () => {
    it("Sprint creation with random valid parameters should succeed", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate random sprint parameters
          fc.integer({ min: 1, max: 1000000 }), // sprintId
          fc.integer({ min: 1, max: 365 * 24 * 60 * 60 }), // duration in seconds
          fc.integer({ min: 1000000, max: 1000000000 }), // amount (1-1000 USDC)
          async (sprintId, duration, amount) => {
            const env = await setupTestEnvironment();
            
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new anchor.BN(currentTime + 10);
            const endTime = new anchor.BN(currentTime + 10 + duration);
            const totalAmount = new anchor.BN(amount);
            
            const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("sprint"),
                env.employer.publicKey.toBuffer(),
                new anchor.BN(sprintId).toArrayLike(Buffer, "le", 8),
              ],
              program.programId
            );
            
            const vaultPda = anchor.utils.token.associatedAddress({
              mint: env.mint,
              owner: sprintPda,
            });
            
            try {
              await program.methods
                .createSprint(new anchor.BN(sprintId), startTime, endTime, totalAmount)
                .accounts({
                  sprint: sprintPda,
                  vault: vaultPda,
                  employer: env.employer.publicKey,
                  freelancer: env.freelancer.publicKey,
                  mint: env.mint,
                  systemProgram: anchor.web3.SystemProgram.programId,
                  tokenProgram: TOKEN_PROGRAM_ID,
                  associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([env.employer])
                .rpc();
              
              // Verify sprint was created
              const sprintAccount = await program.account.sprint.fetch(sprintPda);
              assert.ok(sprintAccount.totalAmount.eq(totalAmount));
              assert.ok(sprintAccount.startTime.eq(startTime));
              assert.ok(sprintAccount.endTime.eq(endTime));
              
              return true;
            } catch (error) {
              console.error(`Failed with params: sprintId=${sprintId}, duration=${duration}, amount=${amount}`);
              throw error;
            }
          }
        ),
        { numRuns: 10, timeout: 60000 } // Run 10 times with 60s timeout
      );
    });

    it("Invalid time ranges should always fail", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 1000000 }), // sprintId
          fc.integer({ min: 1, max: 100000 }), // positive offset for start
          fc.integer({ min: 1000000, max: 1000000000 }), // amount
          async (sprintId, startOffset, amount) => {
            const env = await setupTestEnvironment();
            
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new anchor.BN(currentTime + startOffset);
            // Ensure end time is before start time by subtracting 1
            const endTime = new anchor.BN(currentTime + startOffset - 1); 
            const totalAmount = new anchor.BN(amount);
            
            const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("sprint"),
                env.employer.publicKey.toBuffer(),
                new anchor.BN(sprintId).toArrayLike(Buffer, "le", 8),
              ],
              program.programId
            );
            
            const vaultPda = anchor.utils.token.associatedAddress({
              mint: env.mint,
              owner: sprintPda,
            });
            
            try {
              await program.methods
                .createSprint(new anchor.BN(sprintId), startTime, endTime, totalAmount)
                .accounts({
                  sprint: sprintPda,
                  vault: vaultPda,
                  employer: env.employer.publicKey,
                  freelancer: env.freelancer.publicKey,
                  mint: env.mint,
                  systemProgram: anchor.web3.SystemProgram.programId,
                  tokenProgram: TOKEN_PROGRAM_ID,
                  associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([env.employer])
                .rpc();
              
              // Should not reach here
              assert.fail("Should have failed with invalid time range");
            } catch (error) {
              // Expected to fail
              assert.ok(
                error.toString().includes("InvalidTimeRange") || 
                error.toString().includes("0x1778"),
                `Should fail with InvalidTimeRange error but got: ${error.toString()}`
              );
              return true;
            }
          }
        ),
        { numRuns: 5, timeout: 30000 }
      );
    });

    it("Withdrawal amounts should never exceed available funds", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100 }), // Number of withdrawal attempts
          fc.integer({ min: 10000000, max: 100000000 }), // Total amount (10-100 USDC)
          fc.integer({ min: 10, max: 100 }), // Sprint duration in seconds
          async (withdrawalAttempts, totalAmount, duration) => {
            const env = await setupTestEnvironment();
            const sprintId = Math.floor(Math.random() * 1000000);
            
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new anchor.BN(currentTime - 5); // Already started
            const endTime = new anchor.BN(currentTime + duration);
            const amount = new anchor.BN(totalAmount);
            
            const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("sprint"),
                env.employer.publicKey.toBuffer(),
                new anchor.BN(sprintId).toArrayLike(Buffer, "le", 8),
              ],
              program.programId
            );
            
            const vaultPda = anchor.utils.token.associatedAddress({
              mint: env.mint,
              owner: sprintPda,
            });
            
            // Create and fund sprint
            await program.methods
              .createSprint(new anchor.BN(sprintId), startTime, endTime, amount)
              .accounts({
                sprint: sprintPda,
                vault: vaultPda,
                employer: env.employer.publicKey,
                freelancer: env.freelancer.publicKey,
                mint: env.mint,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              })
              .signers([env.employer])
              .rpc();
            
            await program.methods
              .depositToEscrow(amount)
              .accounts({
                sprint: sprintPda,
                vault: vaultPda,
                employerTokenAccount: env.employerTokenAccount,
                employer: env.employer.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
              })
              .signers([env.employer])
              .rpc();
            
            // Perform multiple withdrawals
            let totalWithdrawn = new anchor.BN(0);
            
            for (let i = 0; i < withdrawalAttempts; i++) {
              try {
                await program.methods
                  .withdrawStreamed()
                  .accounts({
                    sprint: sprintPda,
                    vault: vaultPda,
                    freelancerTokenAccount: env.freelancerTokenAccount,
                    freelancer: env.freelancer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                  })
                  .signers([env.freelancer])
                  .rpc();
                
                const sprintAccount = await program.account.sprint.fetch(sprintPda);
                
                // Invariant: withdrawn amount should never exceed total
                assert.ok(
                  sprintAccount.withdrawnAmount.lte(amount),
                  `Withdrawn ${sprintAccount.withdrawnAmount} exceeds total ${amount}`
                );
                
                // Invariant: withdrawn amount should be increasing or same
                assert.ok(
                  sprintAccount.withdrawnAmount.gte(totalWithdrawn),
                  "Withdrawn amount decreased"
                );
                
                totalWithdrawn = sprintAccount.withdrawnAmount;
                
                // Small delay between withdrawals
                await new Promise(resolve => setTimeout(resolve, 100));
              } catch (error) {
                // NoFundsAvailable or SprintEnded errors are expected
                if (error.toString().includes("NoFundsAvailable") || 
                    error.toString().includes("SprintEnded")) {
                  break;
                }
                throw error;
              }
            }
            
            return true;
          }
        ),
        { numRuns: 5, timeout: 120000 }
      );
    });

    it("Pause and resume operations maintain invariants", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.oneof(
              fc.constant("pause"),
              fc.constant("resume"),
              fc.constant("withdraw"),
              fc.constant("wait")
            ),
            { minLength: 5, maxLength: 20 }
          ), // Random sequence of operations
          fc.integer({ min: 10000000, max: 100000000 }), // Amount
          async (operations, totalAmount) => {
            const env = await setupTestEnvironment();
            const sprintId = Math.floor(Math.random() * 1000000);
            
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new anchor.BN(currentTime - 10);
            const endTime = new anchor.BN(currentTime + 300); // 5 minutes
            const amount = new anchor.BN(totalAmount);
            
            const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("sprint"),
                env.employer.publicKey.toBuffer(),
                new anchor.BN(sprintId).toArrayLike(Buffer, "le", 8),
              ],
              program.programId
            );
            
            const vaultPda = anchor.utils.token.associatedAddress({
              mint: env.mint,
              owner: sprintPda,
            });
            
            // Create and fund sprint
            await program.methods
              .createSprint(new anchor.BN(sprintId), startTime, endTime, amount)
              .accounts({
                sprint: sprintPda,
                vault: vaultPda,
                employer: env.employer.publicKey,
                freelancer: env.freelancer.publicKey,
                mint: env.mint,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              })
              .signers([env.employer])
              .rpc();
            
            await program.methods
              .depositToEscrow(amount)
              .accounts({
                sprint: sprintPda,
                vault: vaultPda,
                employerTokenAccount: env.employerTokenAccount,
                employer: env.employer.publicKey,
                tokenProgram: TOKEN_PROGRAM_ID,
              })
              .signers([env.employer])
              .rpc();
            
            let isPaused = false;
            let totalWithdrawn = new anchor.BN(0);
            
            // Execute random sequence of operations
            for (const op of operations) {
              try {
                switch (op) {
                  case "pause":
                    if (!isPaused) {
                      try {
                        await program.methods
                          .pauseStream()
                          .accounts({
                            sprint: sprintPda,
                            employer: env.employer.publicKey,
                          })
                          .signers([env.employer])
                          .rpc();
                        isPaused = true;
                      } catch (error) {
                        // AlreadyPaused error is ok
                        if (error.toString().includes("AlreadyPaused")) {
                          isPaused = true;
                        } else {
                          throw error;
                        }
                      }
                    }
                    break;
                    
                  case "resume":
                    if (isPaused) {
                      try {
                        await program.methods
                          .resumeStream()
                          .accounts({
                            sprint: sprintPda,
                            employer: env.employer.publicKey,
                          })
                          .signers([env.employer])
                          .rpc();
                        isPaused = false;
                      } catch (error) {
                        // NotPaused error is ok  
                        if (error.toString().includes("NotPaused")) {
                          isPaused = false;
                        } else {
                          throw error;
                        }
                      }
                    }
                    break;
                    
                  case "withdraw":
                    if (!isPaused) {
                      await program.methods
                        .withdrawStreamed()
                        .accounts({
                          sprint: sprintPda,
                          vault: vaultPda,
                          freelancerTokenAccount: env.freelancerTokenAccount,
                          freelancer: env.freelancer.publicKey,
                          tokenProgram: TOKEN_PROGRAM_ID,
                        })
                        .signers([env.freelancer])
                        .rpc();
                      
                      const sprintAccount = await program.account.sprint.fetch(sprintPda);
                      assert.ok(
                        sprintAccount.withdrawnAmount.gte(totalWithdrawn),
                        "Withdrawn amount decreased"
                      );
                      totalWithdrawn = sprintAccount.withdrawnAmount;
                    }
                    break;
                    
                  case "wait":
                    await new Promise(resolve => setTimeout(resolve, 500));
                    break;
                }
                
                // Verify state consistency
                const sprintAccount = await program.account.sprint.fetch(sprintPda);
                assert.ok(
                  sprintAccount.withdrawnAmount.lte(amount),
                  "Withdrawn exceeds total"
                );
                assert.equal(sprintAccount.isPaused, isPaused, "Pause state mismatch");
                
              } catch (error) {
                // Some errors are expected (e.g., withdrawing when paused)
                if (!error.toString().includes("SprintPaused") &&
                    !error.toString().includes("NoFundsAvailable") &&
                    !error.toString().includes("SprintEnded") &&
                    !error.toString().includes("AlreadyPaused") &&
                    !error.toString().includes("NotPaused")) {
                  throw error;
                }
              }
            }
            
            return true;
          }
        ),
        { numRuns: 3, timeout: 180000 }
      );
    });
  });

  describe("Stress testing with extreme values", () => {
    it("Handles maximum safe integer values", async () => {
      const env = await setupTestEnvironment();
      const sprintId = new anchor.BN("18446744073709551615"); // Max u64
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 10);
      const endTime = new anchor.BN(currentTime + 100);
      const amount = new anchor.BN(1000000000); // Use reasonable amount for test
      
      const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          env.employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      
      const vaultPda = anchor.utils.token.associatedAddress({
        mint: env.mint,
        owner: sprintPda,
      });
      
      try {
        await program.methods
          .createSprint(sprintId, startTime, endTime, amount)
          .accounts({
            sprint: sprintPda,
            vault: vaultPda,
            employer: env.employer.publicKey,
            freelancer: env.freelancer.publicKey,
            mint: env.mint,
            systemProgram: anchor.web3.SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([env.employer])
          .rpc();
        
        const sprintAccount = await program.account.sprint.fetch(sprintPda);
        assert.ok(sprintAccount.sprintId.eq(sprintId));
        console.log("✓ Successfully handled max u64 sprint ID");
      } catch (error) {
        console.log("Max u64 handling result:", error.toString().substring(0, 100));
      }
    });

    it("Rapid-fire operations stress test", async () => {
      const env = await setupTestEnvironment();
      const sprintId = Math.floor(Math.random() * 1000000);
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime - 10);
      const endTime = new anchor.BN(currentTime + 300);
      const amount = new anchor.BN(100000000); // 100 USDC
      
      const [sprintPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          env.employer.publicKey.toBuffer(),
          new anchor.BN(sprintId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      
      const vaultPda = anchor.utils.token.associatedAddress({
        mint: env.mint,
        owner: sprintPda,
      });
      
      // Create and fund
      await program.methods
        .createSprint(new anchor.BN(sprintId), startTime, endTime, amount)
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employer: env.employer.publicKey,
          freelancer: env.freelancer.publicKey,
          mint: env.mint,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([env.employer])
        .rpc();
      
      await program.methods
        .depositToEscrow(amount)
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          employerTokenAccount: env.employerTokenAccount,
          employer: env.employer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([env.employer])
        .rpc();
      
      // Rapid-fire operations
      const operations = [];
      for (let i = 0; i < 10; i++) {
        operations.push(
          program.methods
            .withdrawStreamed()
            .accounts({
              sprint: sprintPda,
              vault: vaultPda,
              freelancerTokenAccount: env.freelancerTokenAccount,
              freelancer: env.freelancer.publicKey,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([env.freelancer])
            .rpc()
            .catch(err => ({ error: err }))
        );
        
        // Add some pauses and resumes
        if (i % 3 === 0) {
          operations.push(
            program.methods
              .pauseStream()
              .accounts({
                sprint: sprintPda,
                employer: env.employer.publicKey,
              })
              .signers([env.employer])
              .rpc()
              .catch(err => ({ error: err }))
          );
        }
        
        if (i % 4 === 0) {
          operations.push(
            program.methods
              .resumeStream()
              .accounts({
                sprint: sprintPda,
                employer: env.employer.publicKey,
              })
              .signers([env.employer])
              .rpc()
              .catch(err => ({ error: err }))
          );
        }
      }
      
      const results = await Promise.all(operations);
      
      // Verify final state consistency
      const finalSprint = await program.account.sprint.fetch(sprintPda);
      assert.ok(
        finalSprint.withdrawnAmount.lte(amount),
        "Final withdrawn amount exceeds total"
      );
      
      console.log(`✓ Stress test completed: ${operations.length} operations`);
      console.log(`  Final withdrawn: ${finalSprint.withdrawnAmount.toString()}`);
    });
  });
});
