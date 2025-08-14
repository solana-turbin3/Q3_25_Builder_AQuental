import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SprintVault } from "../target/types/sprint_vault";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { USDC_MINT_DEVNET, WSOL_MINT } from "./helpers";

export interface TestContext {
  provider: anchor.AnchorProvider;
  program: Program<SprintVault>;
  employer: anchor.web3.Keypair;
  freelancer: anchor.web3.Keypair;
  mint: anchor.web3.PublicKey;
  employerTokenAccount: anchor.web3.PublicKey;
  freelancerTokenAccount: anchor.web3.PublicKey;
  sprintPda: anchor.web3.PublicKey;
  sprintBump: number;
  vaultPda: anchor.web3.PublicKey;
}

/**
 * Creates a test context with either USDC_DEVNET or WSOL mint
 * @param useDevnetUsdc - If true, uses USDC_MINT_DEVNET; otherwise uses WSOL_MINT
 * @param sprintId - The sprint ID to use for PDA derivation
 * @returns A complete test context with all necessary accounts
 */
export async function createTestContext(
  useDevnetUsdc: boolean = true,
  sprintId: anchor.BN = new anchor.BN(1)
): Promise<TestContext> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SprintVault as Program<SprintVault>;

  // Create test wallets
  const employer = anchor.web3.Keypair.generate();
  const freelancer = anchor.web3.Keypair.generate();

  // Airdrop SOL to test wallets
  const airdropTx1 = await provider.connection.requestAirdrop(
    employer.publicKey,
    2 * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(airdropTx1);

  const airdropTx2 = await provider.connection.requestAirdrop(
    freelancer.publicKey,
    1 * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(airdropTx2);

  // Use appropriate mint based on test requirements
  const mint = useDevnetUsdc ? USDC_MINT_DEVNET : WSOL_MINT;

  // For USDC_MINT_DEVNET, we need to ensure the mint exists or create it
  // For WSOL_MINT, it's a native mint so it always exists
  let employerTokenAccount: anchor.web3.PublicKey;
  let freelancerTokenAccount: anchor.web3.PublicKey;

  if (useDevnetUsdc) {
    // Check if USDC_MINT_DEVNET exists, if not create a mock mint
    try {
      const mintInfo = await provider.connection.getAccountInfo(USDC_MINT_DEVNET);
      if (!mintInfo) {
        // Create a mock mint for testing (this would fail in production)
        console.log("Warning: USDC_MINT_DEVNET not found, using mock mint for testing");
        const mockMint = await createMint(
          provider.connection,
          employer,
          employer.publicKey,
          null,
          6 // USDC has 6 decimals
        );
        
        employerTokenAccount = await createAssociatedTokenAccount(
          provider.connection,
          employer,
          mockMint,
          employer.publicKey
        );
        
        freelancerTokenAccount = await createAssociatedTokenAccount(
          provider.connection,
          freelancer,
          mockMint,
          freelancer.publicKey
        );

        // Mint tokens to employer
        await mintTo(
          provider.connection,
          employer,
          mockMint,
          employerTokenAccount,
          employer,
          10000000000 // 10,000 USDC
        );
        
        // Update mint to use the mock
        const finalMint = mockMint;
        
        // Derive PDAs with the mock mint
        const [sprintPda, sprintBump] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("sprint"),
            employer.publicKey.toBuffer(),
            sprintId.toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );

        const vaultPda = anchor.utils.token.associatedAddress({
          mint: finalMint,
          owner: sprintPda,
        });

        return {
          provider,
          program,
          employer,
          freelancer,
          mint: finalMint,
          employerTokenAccount,
          freelancerTokenAccount,
          sprintPda,
          sprintBump,
          vaultPda,
        };
      } else {
        // USDC_MINT_DEVNET exists, use it
        employerTokenAccount = await getOrCreateAssociatedTokenAccount(
          provider.connection,
          employer,
          USDC_MINT_DEVNET,
          employer.publicKey
        ).then(account => account.address);
        
        freelancerTokenAccount = await getOrCreateAssociatedTokenAccount(
          provider.connection,
          freelancer,
          USDC_MINT_DEVNET,
          freelancer.publicKey
        ).then(account => account.address);

        // Note: In real devnet, you'd need to get USDC from a faucet
        // For testing, we'll assume accounts are funded
      }
    } catch (error) {
      console.log("Error checking USDC_MINT_DEVNET, creating mock mint");
      // Fall back to creating a mock mint
      const mockMint = await createMint(
        provider.connection,
        employer,
        employer.publicKey,
        null,
        6
      );
      
      employerTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        employer,
        mockMint,
        employer.publicKey
      );
      
      freelancerTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        freelancer,
        mockMint,
        freelancer.publicKey
      );

      await mintTo(
        provider.connection,
        employer,
        mockMint,
        employerTokenAccount,
        employer,
        10000000000
      );
      
      const [sprintPda, sprintBump] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const vaultPda = anchor.utils.token.associatedAddress({
        mint: mockMint,
        owner: sprintPda,
      });

      return {
        provider,
        program,
        employer,
        freelancer,
        mint: mockMint,
        employerTokenAccount,
        freelancerTokenAccount,
        sprintPda,
        sprintBump,
        vaultPda,
      };
    }
  } else {
    // Use WSOL_MINT
    employerTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      employer,
      WSOL_MINT,
      employer.publicKey
    ).then(account => account.address);
    
    freelancerTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      freelancer,
      WSOL_MINT,
      freelancer.publicKey
    ).then(account => account.address);

    // For WSOL, we need to wrap SOL
    // This would be done through a different instruction in production
  }

  // Derive PDAs
  const [sprintPda, sprintBump] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("sprint"),
      employer.publicKey.toBuffer(),
      sprintId.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );

  const vaultPda = anchor.utils.token.associatedAddress({
    mint,
    owner: sprintPda,
  });

  return {
    provider,
    program,
    employer,
    freelancer,
    mint,
    employerTokenAccount,
    freelancerTokenAccount,
    sprintPda,
    sprintBump,
    vaultPda,
  };
}

/**
 * Creates a mock mint for testing when supported mints are not available
 * @param provider - The Anchor provider
 * @param authority - The mint authority
 * @param decimals - Number of decimals for the mint
 * @returns The created mint public key
 */
export async function createMockMint(
  provider: anchor.AnchorProvider,
  authority: anchor.web3.Keypair,
  decimals: number = 6
): Promise<anchor.web3.PublicKey> {
  return await createMint(
    provider.connection,
    authority,
    authority.publicKey,
    null,
    decimals
  );
}
