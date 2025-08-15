const anchor = require("@coral-xyz/anchor");
const { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = require("@solana/web3.js");
const { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo
} = require("@solana/spl-token");
const BN = require("bn.js");

async function main() {
  console.log("🚀 Running Sprint Vault Tests...\n");
  
  // Setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  
  // Program ID
  const programId = new PublicKey("2XMnUCRiLzaqt3Egt9mfUUo3T9bs6BBnrcE6AQavpx1f");
  
  // Create test accounts
  const employer = Keypair.generate();
  const freelancer = Keypair.generate();
  
  console.log("📝 Setting up test accounts...");
  
  // Fund accounts
  await connection.confirmTransaction(
    await connection.requestAirdrop(employer.publicKey, 2 * LAMPORTS_PER_SOL)
  );
  await connection.confirmTransaction(
    await connection.requestAirdrop(freelancer.publicKey, LAMPORTS_PER_SOL)
  );
  
  console.log("✅ Accounts funded");
  console.log("  Employer:", employer.publicKey.toBase58());
  console.log("  Freelancer:", freelancer.publicKey.toBase58());
  
  // Create mint
  console.log("\n🪙 Creating test token mint...");
  const mint = await createMint(
    connection,
    employer,
    employer.publicKey,
    null,
    6
  );
  console.log("✅ Mint created:", mint.toBase58());
  
  // Create token accounts
  const employerATA = await getOrCreateAssociatedTokenAccount(
    connection,
    employer,
    mint,
    employer.publicKey
  );
  
  const freelancerATA = await getOrCreateAssociatedTokenAccount(
    connection,
    employer,
    mint,
    freelancer.publicKey
  );
  
  // Mint tokens to employer
  await mintTo(
    connection,
    employer,
    mint,
    employerATA.address,
    employer,
    1000000000 // 1000 tokens with 6 decimals
  );
  
  console.log("✅ Token accounts created and funded");
  
  // Calculate PDAs
  const sprintId = new BN(1);
  const [sprintPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("sprint"),
      employer.publicKey.toBuffer(),
      sprintId.toArrayLike(Buffer, "le", 8)
    ],
    programId
  );
  
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [
      sprintPda.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      mint.toBuffer()
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  
  console.log("\n📍 PDAs calculated:");
  console.log("  Sprint PDA:", sprintPda.toBase58());
  console.log("  Vault PDA:", vaultPda.toBase58());
  
  // Check if sprint exists
  const sprintAccount = await connection.getAccountInfo(sprintPda);
  if (sprintAccount) {
    console.log("\n✅ Sprint account exists!");
    console.log("  Owner:", sprintAccount.owner.toBase58());
    console.log("  Data length:", sprintAccount.data.length);
  } else {
    console.log("\n⚠️ Sprint account does not exist (would be created by createSprint instruction)");
  }
  
  // Check vault
  const vaultAccount = await connection.getAccountInfo(vaultPda);
  if (vaultAccount) {
    console.log("\n✅ Vault account exists!");
    console.log("  Owner:", vaultAccount.owner.toBase58());
  } else {
    console.log("\n⚠️ Vault account does not exist (would be created by createSprint instruction)");
  }
  
  console.log("\n✨ Test setup complete!");
  console.log("\nNote: Full test execution requires proper IDL generation.");
  console.log("The programs are deployed and ready, but the IDL needs to be built with the proper Solana toolchain.");
}

main().catch(console.error);
