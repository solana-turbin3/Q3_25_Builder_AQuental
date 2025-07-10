import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorEscrow } from "../target/types/anchor_escrow";
import { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";

describe("anchor-escrow", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.anchorEscrow as Program<AnchorEscrow>;
  const provider = anchor.getProvider();

  // Test accounts
  let maker: Keypair;
  let taker: Keypair;
  let mintA: PublicKey;
  let mintB: PublicKey;
  let makerAtaA: PublicKey;
  let makerAtaB: PublicKey;
  let takerAtaA: PublicKey;
  let takerAtaB: PublicKey;
  let escrow: PublicKey;
  let vault: PublicKey;
  const seed = new anchor.BN(42);
  const depositAmount = new anchor.BN(1000000); // 1 token with 6 decimals
  const receiveAmount = new anchor.BN(500000); // 0.5 tokens with 6 decimals

  beforeEach(async () => {
    // Create test keypairs
    maker = Keypair.generate();
    taker = Keypair.generate();

    // Airdrop SOL to test accounts
    await provider.connection.requestAirdrop(maker.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(taker.publicKey, 2 * LAMPORTS_PER_SOL);

    // Wait for airdrop confirmation
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create test tokens
    mintA = await createMint(
      provider.connection,
      maker,
      maker.publicKey,
      null,
      6
    );

    mintB = await createMint(
      provider.connection,
      taker,
      taker.publicKey,
      null,
      6
    );

    // Create associated token accounts
    makerAtaA = await createAssociatedTokenAccount(
      provider.connection,
      maker,
      mintA,
      maker.publicKey
    );

    makerAtaB = await createAssociatedTokenAccount(
      provider.connection,
      maker,
      mintB,
      maker.publicKey
    );

    takerAtaA = await createAssociatedTokenAccount(
      provider.connection,
      taker,
      mintA,
      taker.publicKey
    );

    takerAtaB = await createAssociatedTokenAccount(
      provider.connection,
      taker,
      mintB,
      taker.publicKey
    );

    // Mint tokens to accounts
    await mintTo(
      provider.connection,
      maker,
      mintA,
      makerAtaA,
      maker.publicKey,
      2000000 // 2 tokens
    );

    await mintTo(
      provider.connection,
      taker,
      mintB,
      takerAtaB,
      taker.publicKey,
      1000000 // 1 token
    );

    // Derive escrow and vault addresses
    [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    vault = getAssociatedTokenAddressSync(
      mintA,
      escrow,
      true
    );
  });

  it("Successfully creates an escrow", async () => {
    const tx = await program.methods
      .make(seed, depositAmount, receiveAmount)
      .accounts({
        maker: maker.publicKey,
        mintA,
        mintB,
        makerAtaA,
        escrow,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    console.log("Make transaction signature:", tx);

    // Check escrow account data
    const escrowAccount = await program.account.escrow.fetch(escrow);
    assert.equal(escrowAccount.maker.toString(), maker.publicKey.toString());
    assert.equal(escrowAccount.mintA.toString(), mintA.toString());
    assert.equal(escrowAccount.mintB.toString(), mintB.toString());
    assert.equal(escrowAccount.seed.toString(), seed.toString());
    assert.equal(escrowAccount.receive.toString(), receiveAmount.toString());

    // Check vault balance
    const vaultAccount = await getAccount(provider.connection, vault);
    assert.equal(vaultAccount.amount.toString(), depositAmount.toString());

    // Check maker's token balance decreased
    const makerAtaAAccount = await getAccount(provider.connection, makerAtaA);
    assert.equal(makerAtaAAccount.amount.toString(), (2000000 - depositAmount.toNumber()).toString());
  });

  it("Successfully refunds an escrow", async () => {
    // First create the escrow
    await program.methods
      .make(seed, depositAmount, receiveAmount)
      .accounts({
        maker: maker.publicKey,
        mintA,
        mintB,
        makerAtaA,
        escrow,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    // Check maker's initial balance
    const makerAtaABefore = await getAccount(provider.connection, makerAtaA);
    const initialBalance = makerAtaABefore.amount;

    // Refund the escrow
    const tx = await program.methods
      .refund()
      .accounts({
        maker: maker.publicKey,
        mintA,
        makerAtaA,
        escrow,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    console.log("Refund transaction signature:", tx);

    // Check maker's balance increased
    const makerAtaAAfter = await getAccount(provider.connection, makerAtaA);
    assert.equal(
      makerAtaAAfter.amount.toString(),
      (Number(initialBalance) + depositAmount.toNumber()).toString()
    );

    // Check that escrow account is closed
    try {
      await program.account.escrow.fetch(escrow);
      assert.fail("Escrow account should be closed");
    } catch (error) {
      assert.include(error.message, "Account does not exist");
    }
  });

  it("Fails to create escrow with zero deposit", async () => {
    try {
      await program.methods
        .make(seed, new anchor.BN(0), receiveAmount)
        .accounts({
          maker: maker.publicKey,
          mintA,
          mintB,
          makerAtaA,
          escrow,
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([maker])
        .rpc();
      
      assert.fail("Should have failed with zero deposit");
    } catch (error) {
      console.log("Expected error for zero deposit:", error.message);
    }
  });

  it("Fails to create escrow with insufficient funds", async () => {
    const largeAmount = new anchor.BN(10000000); // 10 tokens, more than available
    
    try {
      await program.methods
        .make(seed, largeAmount, receiveAmount)
        .accounts({
          maker: maker.publicKey,
          mintA,
          mintB,
          makerAtaA,
          escrow,
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([maker])
        .rpc();
      
      assert.fail("Should have failed with insufficient funds");
    } catch (error) {
      console.log("Expected error for insufficient funds:", error.message);
    }
  });

  it("Fails to refund escrow with wrong authority", async () => {
    // Create escrow first
    await program.methods
      .make(seed, depositAmount, receiveAmount)
      .accounts({
        maker: maker.publicKey,
        mintA,
        mintB,
        makerAtaA,
        escrow,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    // Try to refund with wrong authority (taker instead of maker)
    try {
      await program.methods
        .refund()
        .accounts({
          maker: taker.publicKey, // Wrong authority
          mintA,
          makerAtaA: takerAtaA,
          escrow,
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([taker])
        .rpc();
      
      assert.fail("Should have failed with wrong authority");
    } catch (error) {
      console.log("Expected error for wrong authority:", error.message);
    }
  });

  it("Fails to create duplicate escrow with same seed", async () => {
    // Create first escrow
    await program.methods
      .make(seed, depositAmount, receiveAmount)
      .accounts({
        maker: maker.publicKey,
        mintA,
        mintB,
        makerAtaA,
        escrow,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    // Try to create second escrow with same seed
    try {
      await program.methods
        .make(seed, depositAmount, receiveAmount)
        .accounts({
          maker: maker.publicKey,
          mintA,
          mintB,
          makerAtaA,
          escrow,
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([maker])
        .rpc();
      
      assert.fail("Should have failed with duplicate escrow");
    } catch (error) {
      console.log("Expected error for duplicate escrow:", error.message);
    }
  });

  it("Can create multiple escrows with different seeds", async () => {
    const seed2 = new anchor.BN(43);
    const [escrow2] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed2.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const vault2 = getAssociatedTokenAddressSync(mintA, escrow2, true);

    // Create first escrow
    await program.methods
      .make(seed, depositAmount, receiveAmount)
      .accounts({
        maker: maker.publicKey,
        mintA,
        mintB,
        makerAtaA,
        escrow,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    // Create second escrow with different seed
    await program.methods
      .make(seed2, depositAmount, receiveAmount)
      .accounts({
        maker: maker.publicKey,
        mintA,
        mintB,
        makerAtaA,
        escrow: escrow2,
        vault: vault2,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    // Check both escrows exist
    const escrowAccount1 = await program.account.escrow.fetch(escrow);
    const escrowAccount2 = await program.account.escrow.fetch(escrow2);
    
    assert.equal(escrowAccount1.seed.toString(), seed.toString());
    assert.equal(escrowAccount2.seed.toString(), seed2.toString());
  });

  it("Handles different token amounts correctly", async () => {
    const smallDeposit = new anchor.BN(100); // Very small amount
    const largeReceive = new anchor.BN(50000); // Large receive amount
    
    await program.methods
      .make(seed, smallDeposit, largeReceive)
      .accounts({
        maker: maker.publicKey,
        mintA,
        mintB,
        makerAtaA,
        escrow,
        vault,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    const escrowAccount = await program.account.escrow.fetch(escrow);
    assert.equal(escrowAccount.receive.toString(), largeReceive.toString());
    
    const vaultAccount = await getAccount(provider.connection, vault);
    assert.equal(vaultAccount.amount.toString(), smallDeposit.toString());
  });
});
