import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  createMint, 
  mintTo, 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from "@solana/spl-token";
import { SprintVault } from "../../target/types/sprint_vault";
import { expect } from "chai";

// ============================================
// Configuration and Setup Types
// ============================================

export interface TestAccountSetup {
  provider: anchor.AnchorProvider;
  program: Program<SprintVault>;
  sprintAccountKeypair: Keypair;
  vaultStatePda: PublicKey;
  vaultAuthorityPda: PublicKey;
  memberPda: PublicKey;
  directivePda: PublicKey;
  mint: PublicKey;
  treasuryTokenAccount: PublicKey;
  secondUserMemberPda?: PublicKey;
  secondUserWallet?: Keypair;
  secondUserTokenAccount?: PublicKey;
}

export interface TestContext {
  provider: anchor.AnchorProvider;
  program: Program<SprintVault>;
  accounts: TestAccountSetup;
}

// ============================================
// PDA Derivation Functions
// ============================================

export function deriveVaultStatePda(
  programId: PublicKey,
  sprintAccountPubkey: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_state"), sprintAccountPubkey.toBuffer()],
    programId
  );
}

export function deriveVaultAuthorityPda(
  programId: PublicKey,
  vaultStatePubkey: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), vaultStatePubkey.toBuffer()],
    programId
  );
}

export function deriveMemberPda(
  programId: PublicKey,
  vaultStatePubkey: PublicKey,
  memberPubkey: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("member"), vaultStatePubkey.toBuffer(), memberPubkey.toBuffer()],
    programId
  );
}

export function deriveDirectivePda(
  programId: PublicKey,
  vaultStatePubkey: PublicKey,
  directiveId: number
): [PublicKey, number] {
  const directiveIdBuffer = Buffer.alloc(8);
  directiveIdBuffer.writeBigUInt64LE(BigInt(directiveId), 0);
  
  return PublicKey.findProgramAddressSync(
    [Buffer.from("directive"), vaultStatePubkey.toBuffer(), directiveIdBuffer],
    programId
  );
}

// ============================================
// Account Setup Functions
// ============================================

export async function setupMintAndTokenAccounts(
  provider: anchor.AnchorProvider,
  mintAuthority: Keypair,
  vaultAuthorityPda: PublicKey,
  userWallet: PublicKey
): Promise<{
  mint: PublicKey;
  treasuryTokenAccount: PublicKey;
  userTokenAccount: PublicKey;
}> {
  // Fund mint authority with SOL for transaction fees
  const mintAuthorityAirdrop = await provider.connection.requestAirdrop(
    mintAuthority.publicKey,
    2 * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(mintAuthorityAirdrop);

  // Create mint
  const mint = await createMint(
    provider.connection,
    mintAuthority,
    mintAuthority.publicKey,
    null,
    9
  );

  // Get associated token addresses
  const treasuryTokenAccount = await getAssociatedTokenAddress(
    mint,
    vaultAuthorityPda,
    true
  );

  const userTokenAccount = await getAssociatedTokenAddress(
    mint,
    userWallet
  );

  // Create user's token account
  const createUserTokenAccountIx = createAssociatedTokenAccountInstruction(
    provider.wallet.publicKey,
    userTokenAccount,
    userWallet,
    mint
  );

  const tx = new anchor.web3.Transaction().add(createUserTokenAccountIx);
  await provider.sendAndConfirm(tx);

  // Mint tokens to user
  await mintTo(
    provider.connection,
    mintAuthority,
    mint,
    userTokenAccount,
    mintAuthority,
    1000 * LAMPORTS_PER_SOL
  );

  return { mint, treasuryTokenAccount, userTokenAccount };
}

export async function createAdditionalUserWithTokens(
  provider: anchor.AnchorProvider,
  program: Program<SprintVault>,
  mint: PublicKey,
  mintAuthority: Keypair,
  vaultStatePda: PublicKey,
  amount: number = 500 * LAMPORTS_PER_SOL
): Promise<{
  userWallet: Keypair;
  userTokenAccount: PublicKey;
  memberPda: PublicKey;
}> {
  const userWallet = Keypair.generate();
  
  // Airdrop SOL
  const airdropTx = await provider.connection.requestAirdrop(
    userWallet.publicKey,
    2 * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(airdropTx);

  // Get token account addresses
  const userTokenAccount = await getAssociatedTokenAddress(
    mint,
    userWallet.publicKey
  );

  // Create token account
  const createTokenAccountIx = createAssociatedTokenAccountInstruction(
    provider.wallet.publicKey,
    userTokenAccount,
    userWallet.publicKey,
    mint
  );

  const tx = new anchor.web3.Transaction().add(createTokenAccountIx);
  await provider.sendAndConfirm(tx);

  // Mint tokens
  await mintTo(
    provider.connection,
    mintAuthority,
    mint,
    userTokenAccount,
    mintAuthority,
    amount
  );

  // Derive member PDA
  const [memberPda] = deriveMemberPda(
    program.programId,
    vaultStatePda,
    userWallet.publicKey
  );

  return { userWallet, userTokenAccount, memberPda };
}

// ============================================
// Test Setup Functions
// ============================================

export async function setupBasicTest(): Promise<TestAccountSetup> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const program = anchor.workspace.SprintVault as Program<SprintVault>;
  const sprintAccountKeypair = anchor.web3.Keypair.generate();
  
  // Fund the provider wallet with SOL if needed
  try {
    const balance = await provider.connection.getBalance(provider.wallet.publicKey);
    if (balance < LAMPORTS_PER_SOL) {
      const airdrop = await provider.connection.requestAirdrop(
        provider.wallet.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdrop);
    }
  } catch (error) {
    console.log("Airdrop failed, assuming wallet is already funded");
  }
  
  // Derive PDAs
  const [vaultStatePda] = deriveVaultStatePda(program.programId, sprintAccountKeypair.publicKey);
  const [vaultAuthorityPda] = deriveVaultAuthorityPda(program.programId, vaultStatePda);
  const [memberPda] = deriveMemberPda(program.programId, vaultStatePda, provider.wallet.publicKey);
  const [directivePda] = deriveDirectivePda(program.programId, vaultStatePda, 0);
  
  // Setup mint and token accounts
  const mintAuthority = Keypair.generate();
  const { mint, treasuryTokenAccount } = await setupMintAndTokenAccounts(
    provider,
    mintAuthority,
    vaultAuthorityPda,
    provider.wallet.publicKey
  );
  
  return {
    provider,
    program,
    sprintAccountKeypair,
    vaultStatePda,
    vaultAuthorityPda,
    memberPda,
    directivePda,
    mint,
    treasuryTokenAccount
  };
}

export async function setupTestWithSecondUser(): Promise<TestAccountSetup> {
  const baseSetup = await setupBasicTest();
  const mintAuthority = Keypair.generate();
  
  // Fund mint authority
  const airdrop = await baseSetup.provider.connection.requestAirdrop(
    mintAuthority.publicKey,
    2 * LAMPORTS_PER_SOL
  );
  await baseSetup.provider.connection.confirmTransaction(airdrop);
  
  const { userWallet, userTokenAccount, memberPda } = await createAdditionalUserWithTokens(
    baseSetup.provider,
    baseSetup.program,
    baseSetup.mint,
    mintAuthority,
    baseSetup.vaultStatePda
  );
  
  return {
    ...baseSetup,
    secondUserWallet: userWallet,
    secondUserTokenAccount: userTokenAccount,
    secondUserMemberPda: memberPda
  };
}

// ============================================
// Transaction Helper Functions
// ============================================

export async function initializeVault(
  context: TestContext,
  config: any
): Promise<void> {
  const { program, provider, accounts } = context;
  
  await program.methods
    .initializeVault(
      config.sprintDuration,
      config.cooldownPeriod,
      config.contributionAmounts,
      config.penaltyBrackets,
      config.operatorFeePercentage,
      config.maxVotingTime,
      config.minVotingTime,
      config.initialOperator
    )
    .accounts({
      vault: accounts.vaultStatePda,
      sprintAccount: accounts.sprintAccountKeypair.publicKey,
      initializer: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([accounts.sprintAccountKeypair])
    .rpc();
}

export async function joinVault(
  context: TestContext,
  tierIndex: number,
  userWallet?: Keypair
): Promise<void> {
  const { program, provider, accounts } = context;
  const wallet = userWallet || provider.wallet;
  
  const [memberPda] = deriveMemberPda(
    program.programId,
    accounts.vaultStatePda,
    wallet.publicKey
  );
  
  const userTokenAccount = await getAssociatedTokenAddress(
    accounts.mint,
    wallet.publicKey
  );
  
  await program.methods
    .joinVault(tierIndex)
    .accounts({
      vault: accounts.vaultStatePda,
      member: memberPda,
      user: wallet.publicKey,
      userTokenAccount,
      treasuryTokenAccount: accounts.treasuryTokenAccount,
      vaultAuthority: accounts.vaultAuthorityPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers(userWallet ? [userWallet] : [])
    .rpc();
}

export async function createDirective(
  context: TestContext,
  description: string,
  bountyAmount: anchor.BN,
  creatorWallet?: Keypair
): Promise<PublicKey> {
  const { program, provider, accounts } = context;
  const wallet = creatorWallet || provider.wallet;
  
  // Get next directive ID
  const vaultState = await program.account.vaultState.fetch(accounts.vaultStatePda);
  const directiveId = vaultState.directiveIdCounter;
  
  const [directivePda] = deriveDirectivePda(
    program.programId,
    accounts.vaultStatePda,
    directiveId
  );
  
  const [memberPda] = deriveMemberPda(
    program.programId,
    accounts.vaultStatePda,
    wallet.publicKey
  );
  
  await program.methods
    .createDirective(description, bountyAmount)
    .accounts({
      vault: accounts.vaultStatePda,
      directive: directivePda,
      creator: wallet.publicKey,
      member: memberPda,
      systemProgram: SystemProgram.programId,
    })
    .signers(creatorWallet ? [creatorWallet] : [])
    .rpc();
  
  return directivePda;
}

// ============================================
// Assertion Helper Functions
// ============================================

export async function assertVaultInitialized(
  program: Program<SprintVault>,
  vaultStatePda: PublicKey,
  expectedConfig: any
): Promise<void> {
  const vaultState = await program.account.vaultState.fetch(vaultStatePda);
  
  expect(vaultState.sprintDuration.toNumber()).to.equal(expectedConfig.sprintDuration);
  expect(vaultState.cooldownPeriod.toNumber()).to.equal(expectedConfig.cooldownPeriod);
  expect(vaultState.maxVotingTime.toNumber()).to.equal(expectedConfig.maxVotingTime);
  expect(vaultState.minVotingTime.toNumber()).to.equal(expectedConfig.minVotingTime);
  expect(vaultState.operatorFeePercentage).to.equal(expectedConfig.operatorFeePercentage);
  expect(vaultState.currentOperator.toString()).to.equal(expectedConfig.initialOperator.toString());
}

export async function assertMemberJoined(
  program: Program<SprintVault>,
  memberPda: PublicKey,
  expectedTier: number,
  expectedUser: PublicKey
): Promise<void> {
  const memberState = await program.account.member.fetch(memberPda);
  
  expect(memberState.tier).to.equal(expectedTier);
  expect(memberState.user.toString()).to.equal(expectedUser.toString());
  expect(memberState.isActive).to.be.true;
}

export async function assertDirectiveCreated(
  program: Program<SprintVault>,
  directivePda: PublicKey,
  expectedDescription: string,
  expectedBounty: anchor.BN,
  expectedCreator: PublicKey
): Promise<void> {
  const directiveState = await program.account.directive.fetch(directivePda);
  
  expect(directiveState.description).to.equal(expectedDescription);
  expect(directiveState.bountyAmount.toString()).to.equal(expectedBounty.toString());
  expect(directiveState.creator.toString()).to.equal(expectedCreator.toString());
  expect(directiveState.status.proposed).to.exist;
}

// ============================================
// Time Manipulation Helpers
// ============================================

export async function advanceTimeBy(
  provider: anchor.AnchorProvider,
  seconds: number
): Promise<void> {
  // This is a placeholder - actual implementation depends on test environment
  // For localnet, you might use clock syscall or test-specific time manipulation
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

export async function advanceToNextSprint(
  provider: anchor.AnchorProvider,
  program: Program<SprintVault>,
  vaultStatePda: PublicKey
): Promise<void> {
  const vaultState = await program.account.vaultState.fetch(vaultStatePda);
  const sprintDuration = vaultState.sprintDuration.toNumber();
  const cooldownPeriod = vaultState.cooldownPeriod.toNumber();
  
  await advanceTimeBy(provider, sprintDuration + cooldownPeriod + 1);
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
  } catch (error) {
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
  } catch (error) {
    if (error.message.includes(`Expected custom error ${errorName}`)) {
      throw error;
    }
    const customError = anchor.AnchorError.parse(error.logs);
    expect(customError?.error?.errorCode?.code).to.equal(errorName);
  }
}

// ============================================
// Batch Operation Helpers
// ============================================

export async function createMultipleDirectives(
  context: TestContext,
  count: number,
  baseDescription: string = "Test Directive",
  baseBounty: number = 100
): Promise<PublicKey[]> {
  const directivePdas: PublicKey[] = [];
  
  for (let i = 0; i < count; i++) {
    const description = `${baseDescription} ${i + 1}`;
    const bountyAmount = new anchor.BN(baseBounty * LAMPORTS_PER_SOL * (i + 1));
    
    const directivePda = await createDirective(
      context,
      description,
      bountyAmount
    );
    
    directivePdas.push(directivePda);
  }
  
  return directivePdas;
}

export async function addMultipleMembers(
  context: TestContext,
  count: number,
  tierIndex: number = 0
): Promise<Array<{ wallet: Keypair; memberPda: PublicKey; tokenAccount: PublicKey }>> {
  const members = [];
  const mintAuthority = Keypair.generate();
  
  // Fund mint authority once for all members
  const airdrop = await context.provider.connection.requestAirdrop(
    mintAuthority.publicKey,
    2 * LAMPORTS_PER_SOL
  );
  await context.provider.connection.confirmTransaction(airdrop);
  
  for (let i = 0; i < count; i++) {
    const { userWallet, userTokenAccount, memberPda } = await createAdditionalUserWithTokens(
      context.provider,
      context.program,
      context.accounts.mint,
      mintAuthority,
      context.accounts.vaultStatePda
    );
    
    await joinVault(context, tierIndex, userWallet);
    
    members.push({
      wallet: userWallet,
      memberPda,
      tokenAccount: userTokenAccount
    });
  }
  
  return members;
}

// ============================================
// State Query Helpers
// ============================================

export async function getActiveDirectives(
  program: Program<SprintVault>,
  vaultStatePda: PublicKey
): Promise<any[]> {
  const vaultState = await program.account.vaultState.fetch(vaultStatePda);
  const directives = [];
  
  for (let i = 0; i < vaultState.directiveIdCounter; i++) {
    const [directivePda] = deriveDirectivePda(program.programId, vaultStatePda, i);
    
    try {
      const directive = await program.account.directive.fetch(directivePda);
      if (directive.status.proposed || directive.status.active) {
        directives.push({ pda: directivePda, data: directive, id: i });
      }
    } catch {
      // Directive doesn't exist or was deleted
    }
  }
  
  return directives;
}

export async function getVaultMembers(
  program: Program<SprintVault>,
  vaultStatePda: PublicKey
): Promise<any[]> {
  // This would need to be implemented based on how you track members
  // Could use getProgramAccounts with filters
  const memberAccounts = await program.account.member.all([
    {
      memcmp: {
        offset: 8, // After discriminator
        bytes: vaultStatePda.toBase58(),
      },
    },
  ]);
  
  return memberAccounts.map(account => ({
    pda: account.publicKey,
    data: account.account
  }));
}

// ============================================
// Export all for convenience
// ============================================

export default {
  // Setup functions
  setupBasicTest,
  setupTestWithSecondUser,
  setupMintAndTokenAccounts,
  createAdditionalUserWithTokens,
  
  // PDA derivation
  deriveVaultStatePda,
  deriveVaultAuthorityPda,
  deriveMemberPda,
  deriveDirectivePda,
  
  // Transaction helpers
  initializeVault,
  joinVault,
  createDirective,
  
  // Assertion helpers
  assertVaultInitialized,
  assertMemberJoined,
  assertDirectiveCreated,
  
  // Time manipulation
  advanceTimeBy,
  advanceToNextSprint,
  
  // Error handling
  expectError,
  expectCustomError,
  
  // Batch operations
  createMultipleDirectives,
  addMultipleMembers,
  
  // State queries
  getActiveDirectives,
  getVaultMembers,
};
