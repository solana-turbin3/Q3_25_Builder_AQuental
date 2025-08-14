import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SprintVault } from "../../target/types/sprint_vault";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { BN } from "bn.js";

// Constants
export const USDC_DECIMALS = 6;
export const ONE_USDC = new BN(10 ** USDC_DECIMALS);
export const MINIMUM_WITHDRAWAL = ONE_USDC.mul(new BN(10)); // 10 USDC minimum

// Sprint Duration enum values (matching Anchor-generated TypeScript types)
export const SprintDuration = {
  OneWeek: { oneWeek: {} },
  TwoWeeks: { twoWeeks: {} },
  ThreeWeeks: { threeWeeks: {} },
  FourWeeks: { fourWeeks: {} },
  SixWeeks: { sixWeeks: {} },
  EightWeeks: { eightWeeks: {} },
  TenWeeks: { tenWeeks: {} },
  TwelveWeeks: { twelveWeeks: {} },
};

// Acceleration Type enum values (matching Anchor-generated TypeScript types)
export const AccelerationType = {
  Linear: { linear: {} },
  Quadratic: { quadratic: {} },
  Cubic: { cubic: {} },
};

// Helper to convert duration to seconds
export function durationToSeconds(duration: any): number {
  if (duration.oneWeek) return 7 * 24 * 60 * 60;
  if (duration.twoWeeks) return 14 * 24 * 60 * 60;
  if (duration.threeWeeks) return 21 * 24 * 60 * 60;
  if (duration.fourWeeks) return 28 * 24 * 60 * 60;
  if (duration.sixWeeks) return 42 * 24 * 60 * 60;
  if (duration.eightWeeks) return 56 * 24 * 60 * 60;
  if (duration.tenWeeks) return 70 * 24 * 60 * 60;
  if (duration.twelveWeeks) return 84 * 24 * 60 * 60;
  throw new Error("Invalid duration");
}

// Get all required accounts for Sprint operations
export function getSprintAccounts(
  program: Program<SprintVault>,
  employer: PublicKey,
  freelancer: PublicKey,
  sprintId: BN,
  mint: PublicKey
) {
  const [sprint] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("sprint"),
      employer.toBuffer(),
      sprintId.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );

  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), sprint.toBuffer()],
    program.programId
  );

  return { sprint, vault };
}

// Create a test context with all necessary accounts
export async function createTestContext(
  program: Program<SprintVault>,
  provider: anchor.AnchorProvider
) {
  const employer = Keypair.generate();
  const freelancer = Keypair.generate();

  // Airdrop SOL
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(employer.publicKey, 2 * LAMPORTS_PER_SOL)
  );
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(freelancer.publicKey, LAMPORTS_PER_SOL)
  );

  // Create mint
  const mint = await createMint(
    provider.connection,
    employer,
    employer.publicKey,
    null,
    USDC_DECIMALS
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

  // Mint tokens to employer
  await mintTo(
    provider.connection,
    employer,
    mint,
    employerTokenAccount,
    employer,
    1000000 * 10 ** USDC_DECIMALS
  );

  return {
    employer,
    freelancer,
    mint,
    employerTokenAccount,
    freelancerTokenAccount,
  };
}

// Create sprint with proper accounts
export async function createSprint(
  program: Program<SprintVault>,
  employer: Keypair,
  freelancer: PublicKey,
  sprintId: BN,
  amount: BN,
  duration: any,
  accelerationType: any,
  mint: PublicKey
) {
  const { sprint, vault } = getSprintAccounts(
    program,
    employer.publicKey,
    freelancer,
    sprintId,
    mint
  );

  const startTime = Math.floor(Date.now() / 1000) + 60; // Start in 1 minute

  await program.methods
    .createSprint(
      sprintId,
      new BN(startTime),
      duration,
      amount,
      accelerationType
    )
    .accounts({
      sprint,
      vault,
      employer: employer.publicKey,
      freelancer,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([employer])
    .rpc();

  return { sprint, vault, startTime };
}

// Fund sprint with proper accounts
export async function fundSprint(
  program: Program<SprintVault>,
  employer: Keypair,
  freelancer: PublicKey,
  sprintId: BN,
  mint: PublicKey,
  employerTokenAccount: PublicKey,
  amount?: BN
) {
  const { sprint, vault } = getSprintAccounts(
    program,
    employer.publicKey,
    freelancer,
    sprintId,
    mint
  );

  // If amount not provided, fetch from sprint account
  let depositAmount = amount;
  if (!depositAmount) {
    const sprintAccount = await program.account.sprint.fetch(sprint);
    depositAmount = sprintAccount.totalAmount;
  }

  await program.methods
    .depositToEscrow(depositAmount)
    .accounts({
      sprint,
      vault,
      employer: employer.publicKey,
      employerTokenAccount,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([employer])
    .rpc();
}

// Withdraw from sprint with proper accounts
export async function withdrawFromSprint(
  program: Program<SprintVault>,
  employer: PublicKey,
  freelancer: Keypair,
  sprintId: BN,
  amount: BN | null,
  mint: PublicKey,
  freelancerTokenAccount: PublicKey
) {
  const { sprint, vault } = getSprintAccounts(
    program,
    employer,
    freelancer.publicKey,
    sprintId,
    mint
  );

  await program.methods
    .withdrawStreamed()
    .accounts({
      sprint,
      vault,
      freelancer: freelancer.publicKey,
      freelancerTokenAccount,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([freelancer])
    .rpc();
}

// Pause sprint with proper accounts
export async function pauseSprint(
  program: Program<SprintVault>,
  employer: Keypair,
  freelancer: PublicKey,
  sprintId: BN,
  mint: PublicKey
) {
  const { sprint, vault } = getSprintAccounts(
    program,
    employer.publicKey,
    freelancer,
    sprintId,
    mint
  );

  await program.methods
    .pauseStream()
    .accounts({
      sprint,
      employer: employer.publicKey,
    })
    .signers([employer])
    .rpc();
}

// Resume sprint with proper accounts
export async function resumeSprint(
  program: Program<SprintVault>,
  employer: Keypair,
  freelancer: PublicKey,
  sprintId: BN,
  mint: PublicKey
) {
  const { sprint, vault } = getSprintAccounts(
    program,
    employer.publicKey,
    freelancer,
    sprintId,
    mint
  );

  await program.methods
    .resumeStream()
    .accounts({
      sprint,
      employer: employer.publicKey,
    })
    .signers([employer])
    .rpc();
}

// Close sprint with proper accounts
export async function closeSprint(
  program: Program<SprintVault>,
  employer: Keypair,
  freelancer: PublicKey,
  sprintId: BN,
  mint: PublicKey,
  employerTokenAccount: PublicKey
) {
  const { sprint, vault } = getSprintAccounts(
    program,
    employer.publicKey,
    freelancer,
    sprintId,
    mint
  );

  await program.methods
    .closeSprint()
    .accounts({
      sprint,
      vault,
      employer: employer.publicKey,
      employerTokenAccount,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([employer])
    .rpc();
}

// Calculate available withdrawal amount
export function calculateAvailableAmount(
  totalAmount: BN,
  startTime: number,
  duration: any,
  currentTime: number,
  withdrawnAmount: BN,
  pauseTime: number | null,
  totalPausedDuration: BN
): BN {
  const durationSeconds = durationToSeconds(duration);
  const endTime = startTime + durationSeconds;

  // If not started yet
  if (currentTime < startTime) {
    return new BN(0);
  }

  // If paused, use pause time as effective current time
  const effectiveCurrentTime = pauseTime || currentTime;

  // If ended, all funds available
  if (effectiveCurrentTime >= endTime) {
    return totalAmount.sub(withdrawnAmount);
  }

  // Calculate elapsed time excluding pauses
  const elapsedTime = effectiveCurrentTime - startTime - totalPausedDuration.toNumber();
  
  if (elapsedTime <= 0) {
    return new BN(0);
  }

  // Linear calculation
  const availableAmount = totalAmount
    .mul(new BN(elapsedTime))
    .div(new BN(durationSeconds));

  // Return available minus already withdrawn
  const netAvailable = availableAmount.sub(withdrawnAmount);
  return netAvailable.isNeg() ? new BN(0) : netAvailable;
}

// Wait for time to pass
export async function waitForTime(seconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

// Get current blockchain time
export async function getCurrentTime(
  provider: anchor.AnchorProvider
): Promise<number> {
  const slot = await provider.connection.getSlot();
  const timestamp = await provider.connection.getBlockTime(slot);
  return timestamp || Math.floor(Date.now() / 1000);
}
