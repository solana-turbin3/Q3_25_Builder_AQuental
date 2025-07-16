// tests/amm.ts
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Amm } from "../target/types/amm";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";

describe("amm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Amm as Program<Amm>;

  let payer = provider.wallet as anchor.Wallet;
  let mintA: PublicKey;
  let mintB: PublicKey;
  let pool: PublicKey;
  let vaultA: PublicKey;
  let vaultB: PublicKey;
  let lpMint: PublicKey;
  let vaultAKeypair: Keypair;
  let vaultBKeypair: Keypair;
  let lpMintKeypair: Keypair;

  let user: Keypair;
  let userA: PublicKey;
  let userB: PublicKey;
  let userLp: PublicKey;

  before(async () => {
    // Create two mints
    mintA = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );
    mintB = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );

    // Derive PDAs
    [pool] = await PublicKey.findProgramAddress(
      [Buffer.from("pool"), mintA.toBuffer(), mintB.toBuffer()],
      program.programId
    );
    
    // Create new keypairs for vaults and LP mint (not PDAs)
    vaultAKeypair = Keypair.generate();
    vaultBKeypair = Keypair.generate();
    lpMintKeypair = Keypair.generate();
    vaultA = vaultAKeypair.publicKey;
    vaultB = vaultBKeypair.publicKey;
    lpMint = lpMintKeypair.publicKey;

    // Create user and token accounts
    user = Keypair.generate();
    await provider.connection.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);

    userA = await createAccount(
      provider.connection,
      payer.payer,
      mintA,
      user.publicKey
    );
    userB = await createAccount(
      provider.connection,
      payer.payer,
      mintB,
      user.publicKey
    );

    // Mint initial tokens
    await mintTo(
      provider.connection,
      payer.payer,
      mintA,
      userA,
      payer.payer,
      1_000_000_000
    );
    await mintTo(
      provider.connection,
      payer.payer,
      mintB,
      userB,
      payer.payer,
      1_000_000_000
    );
  });

  it("Initialize pool", async () => {
    await program.methods
      .initialize(new BN(30)) // 0.3 % fee
      .accounts({
        pool,
        tokenA: mintA,
        tokenB: mintB,
        vaultA,
        vaultB,
        lpMint,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([vaultAKeypair, vaultBKeypair, lpMintKeypair])
      .rpc();
      
    // Create LP token account after pool is initialized
    userLp = await createAccount(
      provider.connection,
      payer.payer,
      lpMint,
      user.publicKey
    );
  });

  it("Deposit liquidity", async () => {
    await program.methods
      .deposit(new BN(100_000_000), new BN(100_000_000))
      .accounts({
        pool,
        vaultA,
        vaultB,
        lpMint,
        userA,
        userB,
        userLp,
        user: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const lpAcc = await getAccount(provider.connection, userLp);
    expect(lpAcc.amount.toString()).to.equal("100000000");
  });

  it("Swap A for B", async () => {
    const before = await getAccount(provider.connection, userB);
    await program.methods
      .swap(new BN(10_000_000), new BN(8_000_000)) // More realistic slippage tolerance
      .accounts({
        pool,
        vaultIn: vaultA,
        vaultOut: vaultB,
        userIn: userA,
        userOut: userB,
        user: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();
    const after = await getAccount(provider.connection, userB);
    console.log("User B balance before:", before.amount.toString());
    console.log("User B balance after:", after.amount.toString());
    
    // Calculate expected output with AMM formula
    // Initial: 100M A, 100M B
    // Swap: 10M A -> ? B
    // With fee: 10M * (10000 - 30) / 10000 = 9.997M
    // AMM: amount_out = (9.997M * 100M) / (100M + 9.997M) ≈ 9.066M
    const expectedIncrease = 9_066_108; // Actual AMM output
    const actualIncrease = Number(after.amount) - Number(before.amount);
    
    // Verify the swap worked correctly
    expect(actualIncrease).to.equal(expectedIncrease);
  });

  it("Withdraw half of liquidity", async () => {
    await program.methods
      .withdraw(new BN(50_000_000)) // 50 % of LP
      .accounts({
        pool,
        vaultA,
        vaultB,
        lpMint,
        userLp,
        userA,
        userB,
        user: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const lpAcc = await getAccount(provider.connection, userLp);
    expect(lpAcc.amount.toString()).to.equal("50000000");
  });

  it("Fail swap with too high slippage", async () => {
    try {
      await program.methods
        .swap(new BN(10_000_000), new BN(11_000_000))
        .accounts({
          pool,
          vaultIn: vaultA,
          vaultOut: vaultB,
          userIn: userA,
          userOut: userB,
          user: user.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      throw new Error("Should have failed");
    } catch (err) {
      expect(err.toString()).to.include("SlippageExceeded");
    }
  });
});
