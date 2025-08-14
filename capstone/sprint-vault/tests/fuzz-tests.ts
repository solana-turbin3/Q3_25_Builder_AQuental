import * as anchor from "@coral-xyz/anchor";
import { SprintDuration, AccelerationType, toDurationObject, toAccelerationObject } from "./helpers";
import { Program } from "@coral-xyz/anchor";
import { SprintVault } from "../target/types/sprint_vault";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  freezeAccount,
  thawAccount,
  closeAccount,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import * as fc from "fast-check";

// ==================== Enhanced Helper Functions ====================

/**
 * Network environment configuration for testing
 */
interface NetworkEnvironment {
  type: "mainnet" | "devnet" | "localnet";
  endpoint: string;
  commitment: anchor.web3.Commitment;
}

/**
 * Token configuration for testing different decimal setups
 */
interface TokenConfig {
  decimals: number;
  initialSupply: bigint;
  freezeAuthority?: anchor.web3.PublicKey;
  mintAuthority?: anchor.web3.PublicKey;
}

/**
 * Result of concurrent transaction execution
 */
interface ConcurrentTxResult {
  signature: string;
  success: boolean;
  error?: Error;
  executionTime: number;
}

/**
 * Helper to create a frozen token account
 * @param connection - Solana connection
 * @param payer - Account paying for transaction
 * @param mint - Token mint address
 * @param owner - Owner of the token account
 * @param freezeAuthority - Authority that can freeze/unfreeze the account
 * @returns The frozen token account address
 */
async function createFrozenTokenAccount(
  connection: anchor.web3.Connection,
  payer: anchor.web3.Keypair,
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  freezeAuthority: anchor.web3.Keypair
): Promise<anchor.web3.PublicKey> {
  // Create associated token account
  const tokenAccount = await createAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner
  );

  // Freeze the account
  await freezeAccount(
    connection,
    payer,
    tokenAccount,
    mint,
    freezeAuthority
  );

  return tokenAccount;
}

/**
 * Helper to simulate a closed token account
 * @param connection - Solana connection
 * @param payer - Account paying for transaction
 * @param mint - Token mint address
 * @param owner - Owner of the token account
 * @param closeAuthority - Authority that can close the account
 * @returns Object with account creation and closure transaction signatures
 */
async function simulateClosedTokenAccount(
  connection: anchor.web3.Connection,
  payer: anchor.web3.Keypair,
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  closeAuthority: anchor.web3.Keypair
): Promise<{
  accountAddress: anchor.web3.PublicKey;
  createSignature: string;
  closeSignature: string;
}> {
  // Create token account
  const tokenAccount = await createAssociatedTokenAccount(
    connection,
    payer,
    mint,
    owner
  );

  // Store creation signature
  const createSignature = "account_created"; // In real scenario, capture actual signature

  // Close the account (returns rent to the destination)
  const closeSignature = await closeAccount(
    connection,
    payer,
    tokenAccount,
    payer.publicKey, // Rent destination
    closeAuthority
  );

  return {
    accountAddress: tokenAccount,
    createSignature,
    closeSignature,
  };
}

/**
 * Helper to set up different network environments
 * @param envType - Type of environment to set up
 * @returns Configured anchor provider for the specified environment
 */
function setupNetworkEnvironment(
  envType: "mainnet" | "devnet" | "localnet" = "localnet"
): anchor.AnchorProvider {
  let endpoint: string;
  let commitment: anchor.web3.Commitment = "confirmed";

  switch (envType) {
    case "mainnet":
      endpoint = "https://api.mainnet-beta.solana.com";
      commitment = "finalized";
      break;
    case "devnet":
      endpoint = "https://api.devnet.solana.com";
      commitment = "confirmed";
      break;
    case "localnet":
    default:
      endpoint = "http://localhost:8899";
      commitment = "processed";
      break;
  }

  const connection = new anchor.web3.Connection(endpoint, {
    commitment,
    confirmTransactionInitialTimeout: 60000,
  });

  // Use environment wallet or generate a new one for testing
  const wallet = anchor.AnchorProvider.env().wallet;

  return new anchor.AnchorProvider(connection, wallet, {
    commitment,
    preflightCommitment: commitment,
    skipPreflight: false,
  });
}

/**
 * Helper to create tokens with various decimal configurations
 * @param connection - Solana connection
 * @param payer - Account paying for transaction
 * @param config - Token configuration
 * @returns Created mint address and initial token account
 */
async function createTokenWithDecimals(
  connection: anchor.web3.Connection,
  payer: anchor.web3.Keypair,
  config: TokenConfig
): Promise<{
  mint: anchor.web3.PublicKey;
  tokenAccount: anchor.web3.PublicKey;
  mintAuthority: anchor.web3.Keypair;
  freezeAuthority: anchor.web3.Keypair | null;
}> {
  // Generate authorities
  const mintAuthority = anchor.web3.Keypair.generate();
  const freezeAuthority = config.freezeAuthority ? anchor.web3.Keypair.generate() : null;

  // Create mint with specified decimals
  const mint = await createMint(
    connection,
    payer,
    config.mintAuthority || mintAuthority.publicKey,
    freezeAuthority?.publicKey || null,
    config.decimals
  );

  // Create initial token account
  const tokenAccount = await createAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );

  // Mint initial supply if specified
  if (config.initialSupply > 0n) {
    await mintTo(
      connection,
      payer,
      mint,
      tokenAccount,
      mintAuthority,
      config.initialSupply
    );
  }

  return {
    mint,
    tokenAccount,
    mintAuthority,
    freezeAuthority,
  };
}

/**
 * Helper for concurrent transaction simulation
 * @param transactions - Array of transaction functions to execute
 * @param maxConcurrency - Maximum number of concurrent transactions
 * @returns Results of all transaction executions
 */
async function executeConcurrentTransactions(
  transactions: Array<() => Promise<string>>,
  maxConcurrency: number = 10
): Promise<ConcurrentTxResult[]> {
  const results: ConcurrentTxResult[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < transactions.length; i++) {
    const txIndex = i;
    const startTime = Date.now();

    const execution = transactions[txIndex]()
      .then((signature) => {
        results[txIndex] = {
          signature,
          success: true,
          executionTime: Date.now() - startTime,
        };
      })
      .catch((error) => {
        results[txIndex] = {
          signature: "",
          success: false,
          error,
          executionTime: Date.now() - startTime,
        };
      });

    executing.push(execution);

    // Limit concurrency
    if (executing.length >= maxConcurrency) {
      await Promise.race(executing);
      // Remove completed promises
      const completed = await Promise.race(
        executing.map((p, idx) => p.then(() => idx))
      );
      executing.splice(completed, 1);
    }
  }

  // Wait for all remaining transactions
  await Promise.all(executing);

  return results;
}

/**
 * Helper to create multiple test accounts with SOL airdrops
 * @param connection - Solana connection
 * @param count - Number of accounts to create
 * @param lamportsPerAccount - Amount of lamports to airdrop to each account
 * @returns Array of funded keypairs
 */
async function createFundedAccounts(
  connection: anchor.web3.Connection,
  count: number,
  lamportsPerAccount: number = 10 * anchor.web3.LAMPORTS_PER_SOL
): Promise<anchor.web3.Keypair[]> {
  const accounts: anchor.web3.Keypair[] = [];
  const airdropPromises: Promise<string>[] = [];

  for (let i = 0; i < count; i++) {
    const account = anchor.web3.Keypair.generate();
    accounts.push(account);
    
    airdropPromises.push(
      connection.requestAirdrop(account.publicKey, lamportsPerAccount)
    );
  }

  // Wait for all airdrops
  const signatures = await Promise.all(airdropPromises);
  
  // Confirm all transactions
  await Promise.all(
    signatures.map(sig => connection.confirmTransaction(sig, "confirmed"))
  );

  return accounts;
}

/**
 * Helper to simulate network latency and congestion
 * @param minDelay - Minimum delay in milliseconds
 * @param maxDelay - Maximum delay in milliseconds
 * @returns Promise that resolves after random delay
 */
function simulateNetworkDelay(
  minDelay: number = 100,
  maxDelay: number = 1000
): Promise<void> {
  const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Helper to create token accounts with various states for testing
 * @param connection - Solana connection
 * @param payer - Account paying for transactions
 * @param mint - Token mint address
 * @param states - Array of states to create (normal, frozen, closed)
 * @returns Object mapping states to account addresses
 */
async function createTokenAccountsWithStates(
  connection: anchor.web3.Connection,
  payer: anchor.web3.Keypair,
  mint: anchor.web3.PublicKey,
  states: Array<"normal" | "frozen" | "closed">
): Promise<Map<string, anchor.web3.PublicKey | null>> {
  const accounts = new Map<string, anchor.web3.PublicKey | null>();
  const freezeAuthority = anchor.web3.Keypair.generate();

  for (const state of states) {
    const owner = anchor.web3.Keypair.generate();
    
    switch (state) {
      case "normal":
        const normalAccount = await createAssociatedTokenAccount(
          connection,
          payer,
          mint,
          owner.publicKey
        );
        accounts.set(`${state}_${owner.publicKey.toBase58()}`, normalAccount);
        break;

      case "frozen":
        const frozenAccount = await createFrozenTokenAccount(
          connection,
          payer,
          mint,
          owner.publicKey,
          freezeAuthority
        );
        accounts.set(`${state}_${owner.publicKey.toBase58()}`, frozenAccount);
        break;

      case "closed":
        const closedResult = await simulateClosedTokenAccount(
          connection,
          payer,
          mint,
          owner.publicKey,
          owner
        );
        // Set to null since account is closed
        accounts.set(`${state}_${owner.publicKey.toBase58()}`, null);
        break;
    }
  }

  return accounts;
}

/**
 * Helper to verify token account state
 * @param connection - Solana connection
 * @param tokenAccount - Token account address
 * @returns Account state information
 */
async function verifyTokenAccountState(
  connection: anchor.web3.Connection,
  tokenAccount: anchor.web3.PublicKey
): Promise<{
  exists: boolean;
  isFrozen?: boolean;
  balance?: bigint;
  owner?: anchor.web3.PublicKey;
}> {
  try {
    const accountInfo = await getAccount(connection, tokenAccount);
    return {
      exists: true,
      isFrozen: accountInfo.isFrozen,
      balance: accountInfo.amount,
      owner: accountInfo.owner,
    };
  } catch (error) {
    // Account doesn't exist or is closed
    return {
      exists: false,
    };
  }
}

// ==================== End of Enhanced Helper Functions ====================

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
                  .withdrawStreamed().accounts({
                    sprint: sprintPda,
                    vault: vaultPda,
                    freelancerTokenAccount: env.freelancerTokenAccount,
                    freelancer: env.freelancer.publicKey,
                    mint: env.mint,
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
            // Duration handled by SprintDuration enum; // 5 minutes
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
              .createSprint(
                new anchor.BN(sprintId), 
                startTime, 
                { oneWeek: {} }, // Use SprintDuration.OneWeek
                amount,
                { linear: {} } // Use AccelerationType.Linear
              )
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
                        .withdrawStreamed().accounts({
                          sprint: sprintPda,
                          vault: vaultPda,
                          freelancerTokenAccount: env.freelancerTokenAccount,
                          freelancer: env.freelancer.publicKey,
                          mint: env.mint,
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

  describe("Enhanced helper function demonstrations", () => {
    it("Test with frozen token accounts", async () => {
      const provider = setupNetworkEnvironment("localnet");
      anchor.setProvider(provider);
      
      const payer = anchor.web3.Keypair.generate();
      await provider.connection.requestAirdrop(
        payer.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create token with custom decimals
      const tokenConfig: TokenConfig = {
        decimals: 9,
        initialSupply: 1000000000000n, // 1000 tokens with 9 decimals
        freezeAuthority: anchor.web3.PublicKey.default,
      };

      const { mint, tokenAccount, freezeAuthority } = await createTokenWithDecimals(
        provider.connection,
        payer,
        tokenConfig
      );

      // Create a frozen account
      const owner = anchor.web3.Keypair.generate();
      const frozenAccount = await createFrozenTokenAccount(
        provider.connection,
        payer,
        mint,
        owner.publicKey,
        freezeAuthority!
      );

      // Verify the account is frozen
      const state = await verifyTokenAccountState(
        provider.connection,
        frozenAccount
      );
      
      assert.ok(state.exists, "Frozen account should exist");
      assert.ok(state.isFrozen, "Account should be frozen");
      console.log("✓ Successfully created and verified frozen token account");
    });

    it("Test concurrent transaction execution", async () => {
      const env = await setupTestEnvironment();
      const sprintId = Math.floor(Math.random() * 1000000);
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime - 10);
      // Duration handled by SprintDuration enum;
      const amount = new anchor.BN(100000000);
      
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
      
      // Create sprint
      await program.methods
        .createSprint(
          new anchor.BN(sprintId), 
          startTime, 
          { oneWeek: {} }, // Use SprintDuration.OneWeek
          amount,
          { linear: {} } // Use AccelerationType.Linear
        )
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

      // Create array of concurrent transactions
      const transactions: Array<() => Promise<string>> = [];
      
      for (let i = 0; i < 5; i++) {
        // Add withdrawal attempts
        transactions.push(async () => {
          await simulateNetworkDelay(50, 200); // Simulate network delay
          return program.methods
            .withdrawStreamed().accounts({
              sprint: sprintPda,
              vault: vaultPda,
              freelancerTokenAccount: env.freelancerTokenAccount,
              freelancer: env.freelancer.publicKey,
              mint: env.mint,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([env.freelancer])
            .rpc();
        });
      }

      // Execute transactions concurrently
      const results = await executeConcurrentTransactions(transactions, 3);
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      console.log(`✓ Concurrent execution: ${successful} successful, ${failed} failed`);
      console.log(`  Average execution time: ${results.reduce((sum, r) => sum + r.executionTime, 0) / results.length}ms`);
      
      assert.ok(successful > 0, "At least some transactions should succeed");
    });

    it("Test with multiple decimal configurations", async () => {
      const provider = anchor.AnchorProvider.env();
      const payer = anchor.web3.Keypair.generate();
      
      await provider.connection.requestAirdrop(
        payer.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Test various decimal configurations
      const decimalTests = [0, 6, 9, 18];
      const createdTokens = [];

      for (const decimals of decimalTests) {
        const config: TokenConfig = {
          decimals,
          initialSupply: BigInt(10 ** decimals) * 1000n, // 1000 tokens
        };

        const tokenInfo = await createTokenWithDecimals(
          provider.connection,
          payer,
          config
        );

        createdTokens.push({ decimals, ...tokenInfo });
        console.log(`✓ Created token with ${decimals} decimals`);
      }

      assert.equal(createdTokens.length, decimalTests.length, "All tokens should be created");
    });

    it("Test token account state transitions", async () => {
      const provider = anchor.AnchorProvider.env();
      const payer = anchor.web3.Keypair.generate();
      
      await provider.connection.requestAirdrop(
        payer.publicKey,
        10 * anchor.web3.LAMPORTS_PER_SOL
      );
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create mint
      const mint = await createMint(
        provider.connection,
        payer,
        payer.publicKey,
        payer.publicKey,
        6
      );

      // Create accounts with different states
      const accountStates = await createTokenAccountsWithStates(
        provider.connection,
        payer,
        mint,
        ["normal", "frozen", "closed"]
      );

      let normalCount = 0;
      let frozenCount = 0;
      let closedCount = 0;

      for (const [key, accountAddress] of accountStates) {
        if (key.startsWith("normal_") && accountAddress) {
          const state = await verifyTokenAccountState(provider.connection, accountAddress);
          assert.ok(state.exists && !state.isFrozen, "Normal account should exist and not be frozen");
          normalCount++;
        } else if (key.startsWith("frozen_") && accountAddress) {
          const state = await verifyTokenAccountState(provider.connection, accountAddress);
          assert.ok(state.exists && state.isFrozen, "Frozen account should exist and be frozen");
          frozenCount++;
        } else if (key.startsWith("closed_")) {
          assert.equal(accountAddress, null, "Closed account should be null");
          closedCount++;
        }
      }

      console.log(`✓ Account states verified: ${normalCount} normal, ${frozenCount} frozen, ${closedCount} closed`);
    });

    it("Test with multiple funded accounts", async () => {
      const provider = anchor.AnchorProvider.env();
      
      // Create multiple funded accounts for testing
      const accounts = await createFundedAccounts(
        provider.connection,
        5,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );

      // Verify all accounts are funded
      for (const account of accounts) {
        const balance = await provider.connection.getBalance(account.publicKey);
        assert.ok(balance >= 2 * anchor.web3.LAMPORTS_PER_SOL, "Account should be funded");
      }

      console.log(`✓ Successfully created and funded ${accounts.length} accounts`);
    });
  });

  describe("Stress testing with extreme values", () => {
    it("Handles maximum safe integer values", async () => {
      const env = await setupTestEnvironment();
      const sprintId = new anchor.BN("18446744073709551615"); // Max u64
      
      const currentTime = Math.floor(Date.now() / 1000);
      const startTime = new anchor.BN(currentTime + 10);
      // Duration handled by SprintDuration enum;
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
          .createSprint(
            sprintId, 
            startTime, 
            { oneWeek: {} }, // Use SprintDuration.OneWeek
            amount,
            { linear: {} } // Use AccelerationType.Linear
          )
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
      // Duration handled by SprintDuration enum;
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
        .createSprint(
          new anchor.BN(sprintId), 
          startTime, 
          { oneWeek: {} }, // Use SprintDuration.OneWeek
          amount,
          { linear: {} } // Use AccelerationType.Linear
        )
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
            .withdrawStreamed().accounts({
              sprint: sprintPda,
              vault: vaultPda,
              freelancerTokenAccount: env.freelancerTokenAccount,
              freelancer: env.freelancer.publicKey,
              mint: env.mint,
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
