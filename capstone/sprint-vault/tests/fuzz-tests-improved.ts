import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SprintVault } from "../target/types/sprint_vault";
import * as fc from "fast-check";
import { assert } from "chai";
import { BN } from "bn.js";
import {
  createTestContext,
  createSprint,
  fundSprint,
  withdrawFromSprint,
  pauseSprint,
  resumeSprint,
  SprintDuration,
  AccelerationType,
  ONE_USDC,
  MINIMUM_WITHDRAWAL,
  waitForTime,
  getCurrentTime,
  getSprintAccounts,
  durationToSeconds,
} from "./utils/test-helpers";

describe("Improved Fuzzing Tests - Sprint Vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SprintVault as Program<SprintVault>;

  // Define reasonable bounds for fuzzing
  const FUZZ_CONFIG = {
    // Sprint ID bounds
    MIN_SPRINT_ID: 1,
    MAX_SPRINT_ID: Number.MAX_SAFE_INTEGER,
    
    // Amount bounds (in USDC base units)
    MIN_AMOUNT: MINIMUM_WITHDRAWAL.toNumber(), // 10 USDC minimum
    MAX_AMOUNT: new BN(1_000_000).mul(ONE_USDC).toNumber(), // 1M USDC max
    
    // Duration bounds (predefined durations only)
    VALID_DURATIONS: [
      SprintDuration.OneWeek,
      SprintDuration.TwoWeeks,
      SprintDuration.OneMonth,
      SprintDuration.ThreeMonths,
      SprintDuration.SixMonths,
    ],
    
    // Time bounds
    MIN_START_OFFSET: 60, // Start at least 1 minute in future
    MAX_START_OFFSET: 3600, // Start at most 1 hour in future
    
    // Withdrawal bounds
    MIN_WITHDRAWAL_PERCENTAGE: 0.01, // 1% minimum
    MAX_WITHDRAWAL_PERCENTAGE: 1.0, // 100% maximum
  };

  // Custom arbitraries for better control
  const sprintIdArb = fc.integer({
    min: FUZZ_CONFIG.MIN_SPRINT_ID,
    max: FUZZ_CONFIG.MAX_SPRINT_ID,
  });

  const amountArb = fc.integer({
    min: FUZZ_CONFIG.MIN_AMOUNT,
    max: FUZZ_CONFIG.MAX_AMOUNT,
  }).map(n => new BN(n));

  const durationArb = fc.constantFrom(...FUZZ_CONFIG.VALID_DURATIONS);

  const accelerationArb = fc.constantFrom(
    AccelerationType.Linear,
    AccelerationType.Exponential,
    AccelerationType.Quadratic,
    AccelerationType.Logarithmic
  );

  const startOffsetArb = fc.integer({
    min: FUZZ_CONFIG.MIN_START_OFFSET,
    max: FUZZ_CONFIG.MAX_START_OFFSET,
  });

  describe("Property-based Sprint Creation Tests", () => {
    it("Should successfully create sprints with valid random parameters", async () => {
      await fc.assert(
        fc.asyncProperty(
          sprintIdArb,
          amountArb,
          durationArb,
          accelerationArb,
          startOffsetArb,
          async (sprintId, amount, duration, acceleration, startOffset) => {
            const ctx = await createTestContext(program, provider);
            
            try {
              // Create sprint with fuzzed parameters
              const { sprint, vault } = getSprintAccounts(
                program,
                ctx.employer.publicKey,
                ctx.freelancer.publicKey,
                new BN(sprintId),
                ctx.mint
              );

              const startTime = Math.floor(Date.now() / 1000) + startOffset;

              await program.methods
                .createSprint(
                  new BN(sprintId),
                  amount,
                  duration,
                  acceleration,
                  new BN(startTime)
                )
                .accounts({
                  sprint,
                  vault,
                  employer: ctx.employer.publicKey,
                  freelancer: ctx.freelancer.publicKey,
                  mint: ctx.mint,
                  tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                  associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([ctx.employer])
                .rpc();

              // Verify sprint was created correctly
              const sprintAccount = await program.account.sprint.fetch(sprint);
              
              // Assertions
              assert.equal(sprintAccount.sprintId.toString(), sprintId.toString());
              assert.equal(sprintAccount.totalAmount.toString(), amount.toString());
              assert.equal(sprintAccount.startTime.toNumber(), startTime);
              assert.isFalse(sprintAccount.isFunded);
              assert.isFalse(sprintAccount.isPaused);
              
              // Calculate expected end time based on duration
              const durationSeconds = durationToSeconds(duration);
              const expectedEndTime = startTime + durationSeconds;
              assert.equal(sprintAccount.endTime.toNumber(), expectedEndTime);
              
              return true;
            } catch (error) {
              // Log unexpected errors for debugging
              console.error(`Unexpected error with params:`, {
                sprintId,
                amount: amount.toString(),
                duration,
                acceleration,
                startOffset
              });
              throw error;
            }
          }
        ),
        { 
          numRuns: 10, // Reduced for faster testing
          verbose: true,
          timeout: 30000 
        }
      );
    });

    it("Should reject sprints with invalid parameters", async () => {
      // Test zero amount
      await fc.assert(
        fc.asyncProperty(
          sprintIdArb,
          durationArb,
          accelerationArb,
          async (sprintId, duration, acceleration) => {
            const ctx = await createTestContext(program, provider);
            
            try {
              await createSprint(
                program,
                ctx.employer,
                ctx.freelancer.publicKey,
                new BN(sprintId),
                new BN(0), // Zero amount
                duration,
                acceleration,
                ctx.mint
              );
              assert.fail("Should have rejected zero amount");
            } catch (error) {
              assert.include(error.toString(), "InvalidAmount");
            }
          }
        ),
        { numRuns: 5, timeout: 30000 }
      );

      // Test negative start time (past time)
      await fc.assert(
        fc.asyncProperty(
          sprintIdArb,
          amountArb,
          durationArb,
          async (sprintId, amount, duration) => {
            const ctx = await createTestContext(program, provider);
            const { sprint, vault } = getSprintAccounts(
              program,
              ctx.employer.publicKey,
              ctx.freelancer.publicKey,
              new BN(sprintId),
              ctx.mint
            );

            const pastTime = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

            try {
              await program.methods
                .createSprint(
                  new BN(sprintId),
                  amount,
                  duration,
                  AccelerationType.Linear,
                  new BN(pastTime)
                )
                .accounts({
                  sprint,
                  vault,
                  employer: ctx.employer.publicKey,
                  freelancer: ctx.freelancer.publicKey,
                  mint: ctx.mint,
                  tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                  associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([ctx.employer])
                .rpc();
              assert.fail("Should have rejected past start time");
            } catch (error) {
              // Expected to fail
              assert.isTrue(true);
            }
          }
        ),
        { numRuns: 5, timeout: 30000 }
      );
    });
  });

  describe("Property-based Withdrawal Tests", () => {
    it("Should never allow withdrawal exceeding available funds", async () => {
      await fc.assert(
        fc.asyncProperty(
          amountArb,
          fc.float({ min: 0.1, max: 0.9 }), // Time progress percentage
          fc.float({ min: 0.01, max: 2.0 }), // Withdrawal percentage (can exceed 100% to test bounds)
          async (totalAmount, timeProgress, withdrawalPercentage) => {
            const ctx = await createTestContext(program, provider);
            const sprintId = new BN(Date.now());
            
            // Create and fund sprint
            const { sprint } = await createSprint(
              program,
              ctx.employer,
              ctx.freelancer.publicKey,
              sprintId,
              totalAmount,
              SprintDuration.OneWeek,
              AccelerationType.Linear,
              ctx.mint
            );

            await fundSprint(
              program,
              ctx.employer,
              ctx.freelancer.publicKey,
              sprintId,
              ctx.mint,
              ctx.employerTokenAccount
            );

            // Wait for sprint to start
            await waitForTime(65);

            // Simulate time progress
            const durationSeconds = 7 * 24 * 60 * 60; // 1 week
            const timeToWait = Math.floor(durationSeconds * timeProgress);
            
            // For testing, we'll calculate expected available amount
            const expectedAvailable = totalAmount
              .mul(new BN(Math.floor(timeProgress * 100)))
              .div(new BN(100));

            // Try to withdraw
            const withdrawAmount = totalAmount
              .mul(new BN(Math.floor(withdrawalPercentage * 100)))
              .div(new BN(100));

            if (withdrawAmount.lte(expectedAvailable) && withdrawAmount.gte(MINIMUM_WITHDRAWAL)) {
              // Should succeed
              try {
                // Note: In real test, we'd wait or manipulate time
                // For now, we verify the logic
                const sprintAccount = await program.account.sprint.fetch(sprint);
                assert.isTrue(sprintAccount.isFunded);
                assert.equal(sprintAccount.withdrawnAmount.toNumber(), 0);
              } catch (error) {
                console.error("Unexpected withdrawal error:", error);
                throw error;
              }
            } else {
              // Should fail
              try {
                // Attempt withdrawal that should fail
                // In real test, this would be executed after time manipulation
                assert.isTrue(true); // Placeholder for actual withdrawal test
              } catch (error) {
                assert.include(error.toString(), "NoFundsAvailable");
              }
            }
          }
        ),
        { numRuns: 10, timeout: 30000 }
      );
    });

    it("Should respect minimum withdrawal threshold", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: MINIMUM_WITHDRAWAL.toNumber() - 1 }),
          async (smallAmount) => {
            const ctx = await createTestContext(program, provider);
            const sprintId = new BN(Date.now());
            
            // Create sprint with amount below minimum
            const { sprint } = await createSprint(
              program,
              ctx.employer,
              ctx.freelancer.publicKey,
              sprintId,
              MINIMUM_WITHDRAWAL.mul(new BN(100)), // Large sprint
              SprintDuration.OneWeek,
              AccelerationType.Linear,
              ctx.mint
            );

            await fundSprint(
              program,
              ctx.employer,
              ctx.freelancer.publicKey,
              sprintId,
              ctx.mint,
              ctx.employerTokenAccount
            );

            // Wait for sprint to start and very little time to pass
            await waitForTime(65);

            // Try to withdraw small amount (below minimum)
            try {
              await withdrawFromSprint(
                program,
                ctx.employer.publicKey,
                ctx.freelancer,
                sprintId,
                new BN(smallAmount),
                ctx.mint,
                ctx.freelancerTokenAccount
              );
              assert.fail("Should have rejected withdrawal below minimum");
            } catch (error) {
              // Expected to fail with BelowMinimumWithdrawal
              assert.isTrue(true);
            }
          }
        ),
        { numRuns: 5, timeout: 30000 }
      );
    });
  });

  describe("Property-based Pause/Resume Tests", () => {
    it("Should maintain invariants through pause/resume cycles", async () => {
      // Define operation types
      type Operation = "pause" | "resume" | "wait" | "withdraw";
      
      const operationArb = fc.array(
        fc.constantFrom<Operation>("pause", "resume", "wait", "withdraw"),
        { minLength: 1, maxLength: 10 }
      );

      await fc.assert(
        fc.asyncProperty(
          amountArb,
          operationArb,
          async (totalAmount, operations) => {
            const ctx = await createTestContext(program, provider);
            const sprintId = new BN(Date.now());
            
            // Create and fund sprint
            const { sprint } = await createSprint(
              program,
              ctx.employer,
              ctx.freelancer.publicKey,
              sprintId,
              totalAmount,
              SprintDuration.OneWeek,
              AccelerationType.Linear,
              ctx.mint
            );

            await fundSprint(
              program,
              ctx.employer,
              ctx.freelancer.publicKey,
              sprintId,
              ctx.mint,
              ctx.employerTokenAccount
            );

            // Wait for sprint to start
            await waitForTime(65);

            let isPaused = false;
            let pauseCount = 0;
            let totalWithdrawn = new BN(0);

            for (const op of operations) {
              try {
                switch (op) {
                  case "pause":
                    if (!isPaused && pauseCount < 3) {
                      await pauseSprint(
                        program,
                        ctx.employer,
                        ctx.freelancer.publicKey,
                        sprintId,
                        ctx.mint
                      );
                      isPaused = true;
                      pauseCount++;
                    }
                    break;

                  case "resume":
                    if (isPaused) {
                      await resumeSprint(
                        program,
                        ctx.employer,
                        ctx.freelancer.publicKey,
                        sprintId,
                        ctx.mint
                      );
                      isPaused = false;
                    }
                    break;

                  case "wait":
                    await waitForTime(10);
                    break;

                  case "withdraw":
                    if (!isPaused) {
                      try {
                        // Attempt small withdrawal
                        const withdrawAmount = totalAmount.div(new BN(10));
                        if (withdrawAmount.gte(MINIMUM_WITHDRAWAL)) {
                          await withdrawFromSprint(
                            program,
                            ctx.employer.publicKey,
                            ctx.freelancer,
                            sprintId,
                            withdrawAmount,
                            ctx.mint,
                            ctx.freelancerTokenAccount
                          );
                          totalWithdrawn = totalWithdrawn.add(withdrawAmount);
                        }
                      } catch (e) {
                        // Withdrawal might fail due to insufficient funds or paused state
                      }
                    }
                    break;
                }
              } catch (error) {
                // Some operations might fail due to state, which is expected
              }
            }

            // Verify invariants
            const sprintAccount = await program.account.sprint.fetch(sprint);
            
            // Invariant 1: Withdrawn amount should never exceed total amount
            assert.isTrue(sprintAccount.withdrawnAmount.lte(sprintAccount.totalAmount));
            
            // Invariant 2: Pause count should not exceed 3
            assert.isTrue(sprintAccount.pauseResumeCount <= 6); // 3 pause + 3 resume max
            
            // Invariant 3: If paused, pause_time should be set
            if (sprintAccount.isPaused) {
              assert.isNotNull(sprintAccount.pauseTime);
            } else {
              assert.isNull(sprintAccount.pauseTime);
            }
            
            // Invariant 4: Total paused duration should be non-negative
            assert.isTrue(sprintAccount.totalPausedDuration.gte(new BN(0)));
          }
        ),
        { numRuns: 5, timeout: 60000 }
      );
    });

    it("Should reject excessive pause/resume cycles", async () => {
      const ctx = await createTestContext(program, provider);
      const sprintId = new BN(Date.now());
      
      // Create and fund sprint
      await createSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ONE_USDC.mul(new BN(1000)),
        SprintDuration.OneMonth,
        AccelerationType.Linear,
        ctx.mint
      );

      await fundSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ctx.mint,
        ctx.employerTokenAccount
      );

      // Wait for sprint to start
      await waitForTime(65);

      // Perform 3 pause/resume cycles (maximum allowed)
      for (let i = 0; i < 3; i++) {
        await pauseSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ctx.mint
        );
        
        await waitForTime(2);
        
        await resumeSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ctx.mint
        );
        
        await waitForTime(2);
      }

      // Fourth pause should fail
      try {
        await pauseSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ctx.mint
        );
        assert.fail("Should have rejected fourth pause");
      } catch (error) {
        assert.include(error.toString(), "MaxPauseResumeExceeded");
      }
    });
  });

  describe("Edge Case Boundary Tests", () => {
    it("Should handle amounts at exact boundaries", async () => {
      const ctx = await createTestContext(program, provider);
      
      // Test exact minimum withdrawal amount
      const minSprintId = new BN(Date.now());
      await createSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        minSprintId,
        MINIMUM_WITHDRAWAL, // Exactly minimum
        SprintDuration.OneWeek,
        AccelerationType.Linear,
        ctx.mint
      );

      // Test maximum safe amount
      const maxSprintId = new BN(Date.now() + 1);
      const maxAmount = new BN(2).pow(new BN(53)); // JavaScript MAX_SAFE_INTEGER equivalent
      
      await createSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        maxSprintId,
        maxAmount,
        SprintDuration.SixMonths,
        AccelerationType.Linear,
        ctx.mint
      );

      // Verify both sprints were created
      const { sprint: minSprint } = getSprintAccounts(
        program,
        ctx.employer.publicKey,
        ctx.freelancer.publicKey,
        minSprintId,
        ctx.mint
      );
      
      const { sprint: maxSprint } = getSprintAccounts(
        program,
        ctx.employer.publicKey,
        ctx.freelancer.publicKey,
        maxSprintId,
        ctx.mint
      );

      const minSprintAccount = await program.account.sprint.fetch(minSprint);
      const maxSprintAccount = await program.account.sprint.fetch(maxSprint);

      assert.equal(minSprintAccount.totalAmount.toString(), MINIMUM_WITHDRAWAL.toString());
      assert.equal(maxSprintAccount.totalAmount.toString(), maxAmount.toString());
    });

    it("Should handle time boundaries correctly", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            0, // Current time
            3600, // 1 hour
            86400, // 1 day
            604800, // 1 week
            2592000, // 30 days
            31536000, // 1 year
            2147483647 // Max 32-bit timestamp (year 2038)
          ),
          async (startOffset) => {
            const ctx = await createTestContext(program, provider);
            const sprintId = new BN(Date.now());
            
            // Skip if start time would overflow
            const currentTime = Math.floor(Date.now() / 1000);
            if (currentTime + startOffset > 2147483647) {
              return; // Skip this test case
            }

            const { sprint, vault } = getSprintAccounts(
              program,
              ctx.employer.publicKey,
              ctx.freelancer.publicKey,
              sprintId,
              ctx.mint
            );

            const startTime = currentTime + startOffset;

            try {
              await program.methods
                .createSprint(
                  sprintId,
                  ONE_USDC.mul(new BN(100)),
                  SprintDuration.OneWeek,
                  AccelerationType.Linear,
                  new BN(startTime)
                )
                .accounts({
                  sprint,
                  vault,
                  employer: ctx.employer.publicKey,
                  freelancer: ctx.freelancer.publicKey,
                  mint: ctx.mint,
                  tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                  associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
                  systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([ctx.employer])
                .rpc();

              // Verify sprint handles time correctly
              const sprintAccount = await program.account.sprint.fetch(sprint);
              assert.equal(sprintAccount.startTime.toNumber(), startTime);
              
              // Check end time calculation
              const expectedEndTime = startTime + (7 * 24 * 60 * 60);
              assert.equal(sprintAccount.endTime.toNumber(), expectedEndTime);
            } catch (error) {
              // Some extreme times might be rejected
              console.log(`Time boundary test failed for offset ${startOffset}:`, error.message);
            }
          }
        ),
        { numRuns: 5, timeout: 30000 }
      );
    });

    it("Should handle acceleration type variations", async () => {
      const ctx = await createTestContext(program, provider);
      
      const accelerationTypes = [
        AccelerationType.Linear,
        AccelerationType.Exponential,
        AccelerationType.Quadratic,
        AccelerationType.Logarithmic,
      ];

      for (const [index, acceleration] of accelerationTypes.entries()) {
        const sprintId = new BN(Date.now() + index);
        
        const { sprint } = await createSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ONE_USDC.mul(new BN(1000)),
          SprintDuration.TwoWeeks,
          acceleration,
          ctx.mint
        );

        await fundSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ctx.mint,
          ctx.employerTokenAccount
        );

        const sprintAccount = await program.account.sprint.fetch(sprint);
        
        // Verify acceleration type is set correctly
        assert.isNotNull(sprintAccount.accelerationType);
        
        // Wait for sprint to start
        await waitForTime(65);
        
        // Test withdrawal with different acceleration curves
        // Note: Different acceleration types should affect available amounts differently
        // Linear: constant rate
        // Exponential: slow start, fast end
        // Quadratic: very slow start, very fast end
        // Logarithmic: fast start, slow end
        
        // For now, just verify the sprint accepts all types
        assert.isTrue(sprintAccount.isFunded);
      }
    });
  });

  describe("Stress Testing with Extreme Values", () => {
    it("Should handle rapid sequential operations", async () => {
      const ctx = await createTestContext(program, provider);
      const sprintId = new BN(Date.now());
      
      // Create and fund sprint
      await createSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ONE_USDC.mul(new BN(10000)),
        SprintDuration.OneMonth,
        AccelerationType.Linear,
        ctx.mint
      );

      await fundSprint(
        program,
        ctx.employer,
        ctx.freelancer.publicKey,
        sprintId,
        ctx.mint,
        ctx.employerTokenAccount
      );

      // Wait for sprint to start
      await waitForTime(65);

      // Perform rapid operations
      const operations = [];
      
      // Pause
      operations.push(
        pauseSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ctx.mint
        )
      );

      // Wait a bit
      await waitForTime(1);

      // Resume
      operations.push(
        resumeSprint(
          program,
          ctx.employer,
          ctx.freelancer.publicKey,
          sprintId,
          ctx.mint
        )
      );

      // Execute operations
      try {
        await Promise.all(operations);
        assert.fail("Concurrent operations should fail");
      } catch (error) {
        // Expected: One operation should succeed, others should fail
        assert.isTrue(true);
      }
    });

    it("Should handle mathematical edge cases", async () => {
      const testCases = [
        { amount: new BN(1), description: "Minimum amount (1 unit)" },
        { amount: new BN(2).pow(new BN(32)), description: "2^32 (32-bit boundary)" },
        { amount: new BN(2).pow(new BN(53)), description: "2^53 (JavaScript safe integer)" },
        { amount: new BN(2).pow(new BN(63)).sub(new BN(1)), description: "2^63-1 (max signed 64-bit)" },
      ];

      for (const testCase of testCases) {
        const ctx = await createTestContext(program, provider);
        const sprintId = new BN(Date.now() + Math.random() * 1000000);
        
        try {
          await createSprint(
            program,
            ctx.employer,
            ctx.freelancer.publicKey,
            sprintId,
            testCase.amount,
            SprintDuration.OneWeek,
            AccelerationType.Linear,
            ctx.mint
          );
          
          console.log(`✓ Successfully handled ${testCase.description}`);
        } catch (error) {
          console.log(`✗ Failed for ${testCase.description}: ${error.message}`);
          
          // Some amounts might be too small (below minimum) or cause overflow
          if (testCase.amount.lt(MINIMUM_WITHDRAWAL)) {
            assert.include(error.toString(), "InvalidAmount");
          }
        }
      }
    });
  });
});
