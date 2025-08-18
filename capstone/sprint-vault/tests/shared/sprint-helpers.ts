import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  createMint, 
  mintTo, 
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from "@solana/spl-token";
import { SprintVault } from "../../target/types/sprint_vault";
import { Bounty } from "../../target/types/bounty";
import { Vault } from "../../target/types/vault";
import { expect } from "chai";
import BN from "bn.js";

// ============================================
// Configuration and Setup Types
// ============================================

export interface SprintTestSetup {
  provider: anchor.AnchorProvider;
  sprintProgram: Program<SprintVault>;
  bountyProgram?: Program<Bounty>;
  vaultProgram?: Program<Vault>;
  employer: Keypair;
  freelancer: Keypair;
  mint: PublicKey;
  employerTokenAccount: PublicKey;
  freelancerTokenAccount: PublicKey;
}

export interface SprintAccounts {
  sprintPda: PublicKey;
  vaultPda: PublicKey;
  sprintId: BN;
}

export interface BountyAccounts {
  bountyPoolPda: PublicKey;
  bountyVaultPda: PublicKey;
  bountyId: BN;
}

// ============================================
// Sprint Duration Enums
// ============================================

export const SprintDurationVariants = {
  oneWeek: { oneWeek: {} },
  twoWeeks: { twoWeeks: {} },
  threeWeeks: { threeWeeks: {} },
  fourWeeks: { fourWeeks: {} },
  sixWeeks: { sixWeeks: {} },
  eightWeeks: { eightWeeks: {} },
  tenWeeks: { tenWeeks: {} },
  twelveWeeks: { twelveWeeks: {} }
};

export const AccelerationTypes = {
  linear: { linear: {} },
  quadratic: { quadratic: {} },
  cubic: { cubic: {} }
};

// ============================================
// PDA Derivation Functions
// ============================================

export function deriveSprintPda(
  programId: PublicKey,
  employer: PublicKey,
  sprintId: BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("sprint"),
      employer.toBuffer(),
      sprintId.toArrayLike(Buffer, "le", 8)
    ],
    programId
  );
}

export function deriveSprintVaultPda(
  sprintPda: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      sprintPda.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      mint.toBuffer()
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

export function deriveBountyPoolPda(
  programId: PublicKey,
  creator: PublicKey,
  bountyId: BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("bounty_pool"),
      creator.toBuffer(),
      bountyId.toArrayLike(Buffer, "le", 8)
    ],
    programId
  );
}

export function deriveBountyVaultPda(
  bountyPoolPda: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      bountyPoolPda.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      mint.toBuffer()
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

export function deriveEscrowVaultPda(
  programId: PublicKey,
  ownerProgram: PublicKey,
  vaultId: BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow_vault"),
      ownerProgram.toBuffer(),
      vaultId.toArrayLike(Buffer, "le", 8)
    ],
    programId
  );
}

// ============================================
// Account Setup Functions
// ============================================

export async function setupSprintTest(): Promise<SprintTestSetup> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const sprintProgram = anchor.workspace.SprintVault as Program<SprintVault>;
  const bountyProgram = anchor.workspace.Bounty as Program<Bounty>;
  const vaultProgram = anchor.workspace.Vault as Program<Vault>;
  
  const employer = Keypair.generate();
  const freelancer = Keypair.generate();
  
  // Fund accounts with SOL
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(employer.publicKey, 2 * LAMPORTS_PER_SOL)
  );
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(freelancer.publicKey, LAMPORTS_PER_SOL)
  );
  
  // Create mint with 6 decimals (USDC standard)
  const mint = await createMint(
    provider.connection,
    employer,
    employer.publicKey,
    null,
    6
  );
  
  // Create token accounts
  const employerATA = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    employer,
    mint,
    employer.publicKey
  );
  
  const freelancerATA = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    employer,
    mint,
    freelancer.publicKey
  );
  
  // Mint tokens to employer (1000 tokens with 6 decimals)
  await mintTo(
    provider.connection,
    employer,
    mint,
    employerATA.address,
    employer,
    1000_000_000 // 1000 tokens
  );
  
  return {
    provider,
    sprintProgram,
    bountyProgram,
    vaultProgram,
    employer,
    freelancer,
    mint,
    employerTokenAccount: employerATA.address,
    freelancerTokenAccount: freelancerATA.address
  };
}

// ============================================
// Sprint Transaction Helper Functions
// ============================================

export async function createSprint(
  setup: SprintTestSetup,
  sprintId: BN,
  startTime: BN,
  duration: any,
  totalAmount: BN,
  accelerationType?: any
): Promise<SprintAccounts> {
  const { sprintProgram, employer, freelancer, mint } = setup;
  
  const [sprintPda] = deriveSprintPda(sprintProgram.programId, employer.publicKey, sprintId);
  const [vaultPda] = deriveSprintVaultPda(sprintPda, mint);
  
  await sprintProgram.methods
    .createSprint(
      sprintId,
      startTime,
      duration,
      totalAmount,
      accelerationType || AccelerationTypes.quadratic
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
  
  return { sprintPda, vaultPda, sprintId };
}

export async function fundSprint(
  setup: SprintTestSetup,
  sprintAccounts: SprintAccounts,
  amount: BN
): Promise<void> {
  const { sprintProgram, employer, employerTokenAccount } = setup;
  const { sprintPda, vaultPda } = sprintAccounts;
  
  await sprintProgram.methods
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
}

export async function withdrawFromSprint(
  setup: SprintTestSetup,
  sprintAccounts: SprintAccounts
): Promise<void> {
  const { sprintProgram, freelancer, freelancerTokenAccount } = setup;
  const { sprintPda, vaultPda } = sprintAccounts;
  
  await sprintProgram.methods
    .withdrawStreamed()
    .accounts({
      sprint: sprintPda,
      vault: vaultPda,
      freelancerTokenAccount: freelancerTokenAccount,
      freelancer: freelancer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([freelancer])
    .rpc();
}

export async function pauseSprint(
  setup: SprintTestSetup,
  sprintAccounts: SprintAccounts
): Promise<void> {
  const { sprintProgram, employer } = setup;
  const { sprintPda } = sprintAccounts;
  
  await sprintProgram.methods
    .pauseStream()
    .accounts({
      sprint: sprintPda,
      employer: employer.publicKey,
    })
    .signers([employer])
    .rpc();
}

export async function resumeSprint(
  setup: SprintTestSetup,
  sprintAccounts: SprintAccounts
): Promise<void> {
  const { sprintProgram, employer } = setup;
  const { sprintPda } = sprintAccounts;
  
  await sprintProgram.methods
    .resumeStream()
    .accounts({
      sprint: sprintPda,
      employer: employer.publicKey,
    })
    .signers([employer])
    .rpc();
}

export async function closeSprint(
  setup: SprintTestSetup,
  sprintAccounts: SprintAccounts
): Promise<void> {
  const { sprintProgram, employer, employerTokenAccount } = setup;
  const { sprintPda, vaultPda } = sprintAccounts;
  
  await sprintProgram.methods
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
}

// ============================================
// Bounty Transaction Helper Functions
// ============================================

export async function createBountyPool(
  setup: SprintTestSetup,
  bountyId: BN,
  vaultId: BN,
  title: string,
  descriptionUrl: string,
  totalAmount: BN,
  milestones: any[],
  associatedSprint?: PublicKey,
  expiresAt?: BN,
  arbiter?: PublicKey
): Promise<BountyAccounts> {
  const { bountyProgram, employer, mint } = setup;
  
  const [bountyPoolPda] = deriveBountyPoolPda(bountyProgram.programId, employer.publicKey, bountyId);
  const [bountyVaultPda] = deriveBountyVaultPda(bountyPoolPda, mint);
  
  await bountyProgram.methods
    .createBountyPool(
      bountyId,
      vaultId,
      title,
      descriptionUrl,
      totalAmount,
      milestones,
      associatedSprint || null,
      expiresAt || null,
      arbiter || null
    )
    .accounts({
      bountyPool: bountyPoolPda,
      vault: bountyVaultPda,
      creator: employer.publicKey,
      mint: mint,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .signers([employer])
    .rpc();
  
  return { bountyPoolPda, bountyVaultPda, bountyId };
}

export async function fundBounty(
  setup: SprintTestSetup,
  bountyAccounts: BountyAccounts,
  amount: BN
): Promise<void> {
  const { bountyProgram, employer, employerTokenAccount } = setup;
  const { bountyPoolPda, bountyVaultPda } = bountyAccounts;
  
  await bountyProgram.methods
    .fundBounty(amount)
    .accounts({
      bountyPool: bountyPoolPda,
      vault: bountyVaultPda,
      funderTokenAccount: employerTokenAccount,
      funder: employer.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([employer])
    .rpc();
}

// ============================================
// Assertion Helper Functions
// ============================================

export async function assertSprintCreated(
  program: Program<SprintVault>,
  sprintPda: PublicKey,
  expectedEmployer: PublicKey,
  expectedFreelancer: PublicKey,
  expectedAmount: BN
): Promise<void> {
  const sprint = await program.account.sprint.fetch(sprintPda);
  
  expect(sprint.employer.toString()).to.equal(expectedEmployer.toString());
  expect(sprint.freelancer.toString()).to.equal(expectedFreelancer.toString());
  expect(sprint.totalAmount.toString()).to.equal(expectedAmount.toString());
  expect(sprint.isFunded).to.be.false;
  expect(sprint.isPaused).to.be.false;
}

export async function assertSprintFunded(
  program: Program<SprintVault>,
  sprintPda: PublicKey
): Promise<void> {
  const sprint = await program.account.sprint.fetch(sprintPda);
  expect(sprint.isFunded).to.be.true;
}

export async function assertSprintPaused(
  program: Program<SprintVault>,
  sprintPda: PublicKey
): Promise<void> {
  const sprint = await program.account.sprint.fetch(sprintPda);
  expect(sprint.isPaused).to.be.true;
  expect(sprint.pauseTime.toNumber()).to.be.greaterThan(0);
}

export async function assertSprintResumed(
  program: Program<SprintVault>,
  sprintPda: PublicKey
): Promise<void> {
  const sprint = await program.account.sprint.fetch(sprintPda);
  expect(sprint.isPaused).to.be.false;
  expect(sprint.totalPausedDuration.toNumber()).to.be.greaterThanOrEqual(0);
}

// ============================================
// Time Manipulation Helpers
// ============================================

export async function advanceTimeBy(
  provider: anchor.AnchorProvider,
  seconds: number
): Promise<void> {
  // In tests, we simulate time advancement
  // Using shorter delay for test performance (100ms per simulated second)
  // In a real environment, you'd wait or use clock manipulation
  await new Promise(resolve => setTimeout(resolve, Math.min(seconds * 100, 2000)));
  
  // Add small delay to avoid concurrent operation issues
  await new Promise(resolve => setTimeout(resolve, 100));
}

export async function advanceToSprintEnd(
  provider: anchor.AnchorProvider,
  program: Program<SprintVault>,
  sprintPda: PublicKey
): Promise<void> {
  const sprint = await program.account.sprint.fetch(sprintPda);
  const endTime = sprint.endTime.toNumber();
  const currentTime = Math.floor(Date.now() / 1000);
  const timeToWait = Math.max(0, endTime - currentTime + 1);
  
  await advanceTimeBy(provider, timeToWait);
}

// ============================================
// Error Expectation Helpers
// ============================================

export async function expectError(
  promise: Promise<any>,
  errorCode: string
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected error ${errorCode} but transaction succeeded`);
  } catch (error: any) {
    if (error.message.includes(`Expected error ${errorCode}`)) {
      throw error;
    }
    expect(error.toString()).to.include(errorCode);
  }
}

export async function expectCustomError(
  promise: Promise<any>,
  errorName: string
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected custom error ${errorName} but transaction succeeded`);
  } catch (error: any) {
    if (error.message.includes(`Expected custom error ${errorName}`)) {
      throw error;
    }
    // Check for Anchor error format
    if (error.error && error.error.errorCode && error.error.errorCode.code === errorName) {
      return;
    }
    // Check for string match
    expect(error.toString()).to.include(errorName);
  }
}

// ============================================
// Calculation Helpers
// ============================================

export function calculateStreamedAmount(
  totalAmount: BN,
  startTime: BN,
  endTime: BN,
  currentTime: BN,
  accelerationType: string = "quadratic"
): BN {
  const duration = endTime.sub(startTime);
  const elapsed = currentTime.sub(startTime);
  
  if (elapsed.gte(duration)) {
    return totalAmount;
  }
  
  if (elapsed.lte(new BN(0))) {
    return new BN(0);
  }
  
  const elapsedRatio = elapsed.mul(new BN(10000)).div(duration); // Basis points
  
  let earnedRatio: BN;
  switch (accelerationType) {
    case "linear":
      earnedRatio = elapsedRatio;
      break;
    case "quadratic":
      earnedRatio = elapsedRatio.mul(elapsedRatio).div(new BN(10000));
      break;
    case "cubic":
      earnedRatio = elapsedRatio.mul(elapsedRatio).mul(elapsedRatio).div(new BN(100000000));
      break;
    default:
      earnedRatio = elapsedRatio;
  }
  
  return totalAmount.mul(earnedRatio).div(new BN(10000));
}

// ============================================
// Export all for convenience
// ============================================

export default {
  // Setup functions
  setupSprintTest,
  
  // PDA derivation
  deriveSprintPda,
  deriveSprintVaultPda,
  deriveBountyPoolPda,
  deriveBountyVaultPda,
  deriveEscrowVaultPda,
  
  // Sprint operations
  createSprint,
  fundSprint,
  withdrawFromSprint,
  pauseSprint,
  resumeSprint,
  closeSprint,
  
  // Bounty operations
  createBountyPool,
  fundBounty,
  
  // Assertions
  assertSprintCreated,
  assertSprintFunded,
  assertSprintPaused,
  assertSprintResumed,
  
  // Time manipulation
  advanceTimeBy,
  advanceToSprintEnd,
  
  // Error handling
  expectError,
  expectCustomError,
  
  // Calculations
  calculateStreamedAmount,
  
  // Constants
  SprintDurationVariants,
  AccelerationTypes,
};
