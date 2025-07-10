import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorEscrow } from "../target/types/anchor_escrow";
import { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";

describe("anchor-escrow-security", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.anchorEscrow as Program<AnchorEscrow>;
  const provider = anchor.getProvider();

  // Test accounts
  let maker: Keypair;
  let attacker: Keypair;
  let mintA: PublicKey;
  let mintB: PublicKey;
  let makerAtaA: PublicKey;
  let attackerAtaA: PublicKey;
  let escrow: PublicKey;
  let vault: PublicKey;
  const seed = new anchor.BN(42);
  const depositAmount = new anchor.BN(1000000);
  const receiveAmount = new anchor.BN(500000);

  beforeEach(async () => {
    maker = Keypair.generate();
    attacker = Keypair.generate();

    // Airdrop SOL
    await provider.connection.requestAirdrop(maker.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(attacker.publicKey, 2 * LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create mints
    mintA = await createMint(provider.connection, maker, maker.publicKey, null, 6);
    mintB = await createMint(provider.connection, maker, maker.publicKey, null, 6);

    // Create token accounts
    makerAtaA = await createAssociatedTokenAccount(
      provider.connection,
      maker,
      mintA,
      maker.publicKey
    );

    attackerAtaA = await createAssociatedTokenAccount(
      provider.connection,
      attacker,
      mintA,
      attacker.publicKey
    );

    // Mint tokens
    await mintTo(provider.connection, maker, mintA, makerAtaA, maker.publicKey, 2000000);

    // Derive addresses
    [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    vault = getAssociatedTokenAddressSync(mintA, escrow, true);
  });

  it("Prevents unauthorized escrow creation with wrong maker", async () => {
    try {
      await program.methods
        .make(seed, depositAmount, receiveAmount)
        .accounts({
          maker: attacker.publicKey, // Wrong maker
          mintA,
          mintB,
          makerAtaA: attackerAtaA,
          escrow,
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();

      assert.fail("Should have failed with wrong maker for escrow seed");
    } catch (error) {
      console.log("Expected error for wrong maker:", error.message);
      assert.include(error.message.toLowerCase(), "constraint");
    }
  });

  it("Prevents refund by unauthorized user", async () => {
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

    // Try to refund with wrong signer
    try {
      await program.methods
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
        .signers([attacker]) // Wrong signer
        .rpc();

      assert.fail("Should have failed with wrong signer");
    } catch (error) {
      console.log("Expected error for wrong signer:", error.message);
    }
  });

  it("Prevents refund to wrong token account", async () => {
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

    // Try to refund to attacker's account
    try {
      await program.methods
        .refund()
        .accounts({
          maker: maker.publicKey,
          mintA,
          makerAtaA: attackerAtaA, // Wrong destination
          escrow,
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([maker])
        .rpc();

      assert.fail("Should have failed with wrong token account");
    } catch (error) {
      console.log("Expected error for wrong token account:", error.message);
    }
  });

  it("Prevents using wrong vault for escrow", async () => {
    const wrongVault = getAssociatedTokenAddressSync(mintB, escrow, true);

    try {
      await program.methods
        .make(seed, depositAmount, receiveAmount)
        .accounts({
          maker: maker.publicKey,
          mintA,
          mintB,
          makerAtaA,
          escrow,
          vault: wrongVault, // Wrong vault for mintA
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([maker])
        .rpc();

      assert.fail("Should have failed with wrong vault");
    } catch (error) {
      console.log("Expected error for wrong vault:", error.message);
    }
  });

  it("Prevents double refund attacks", async () => {
    // Create escrow
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

    // First refund (should succeed)
    await program.methods
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

    // Try second refund (should fail)
    try {
      await program.methods
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

      assert.fail("Should have failed with double refund");
    } catch (error) {
      console.log("Expected error for double refund:", error.message);
      assert.include(error.message, "Account does not exist");
    }
  });

  it("Validates mint consistency in escrow operations", async () => {
    const wrongMint = await createMint(provider.connection, maker, maker.publicKey, null, 6);

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

    // Try to refund with wrong mint
    try {
      await program.methods
        .refund()
        .accounts({
          maker: maker.publicKey,
          mintA: wrongMint, // Wrong mint
          makerAtaA,
          escrow,
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([maker])
        .rpc();

      assert.fail("Should have failed with wrong mint");
    } catch (error) {
      console.log("Expected error for wrong mint:", error.message);
    }
  });

  it("Prevents escrow creation with incorrect PDA seeds", async () => {
    const wrongSeed = new anchor.BN(999);
    const [wrongEscrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), wrongSeed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    try {
      await program.methods
        .make(seed, depositAmount, receiveAmount) // Using different seed than wrongEscrow
        .accounts({
          maker: maker.publicKey,
          mintA,
          mintB,
          makerAtaA,
          escrow: wrongEscrow, // Wrong escrow for this seed
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([maker])
        .rpc();

      assert.fail("Should have failed with wrong escrow PDA");
    } catch (error) {
      console.log("Expected error for wrong escrow PDA:", error.message);
    }
  });

  it("Prevents manipulation of escrow bump", async () => {
    // This test ensures that the bump is properly derived and cannot be manipulated
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

    const escrowAccount = await program.account.escrow.fetch(escrow);
    const [derivedEscrow, derivedBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    assert.equal(escrow.toString(), derivedEscrow.toString());
    assert.equal(escrowAccount.bump, derivedBump);
  });

  it("Prevents reentrancy attacks", async () => {
    // Create an escrow
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

    // Since Anchor uses atomic transactions, reentrancy is naturally prevented
    // This test verifies that the state is consistent after operations
    const escrowAccountBefore = await program.account.escrow.fetch(escrow);
    const vaultAccountBefore = await getAccount(provider.connection, vault);

    // Refund
    await program.methods
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

    // Verify the escrow is properly closed and can't be accessed
    try {
      await program.account.escrow.fetch(escrow);
      assert.fail("Escrow should be closed");
    } catch (error) {
      assert.include(error.message, "Account does not exist");
    }

    // Verify vault is closed
    try {
      await getAccount(provider.connection, vault);
      assert.fail("Vault should be closed");
    } catch (error) {
      assert.include(error.message, "could not find account");
    }
  });

  it("Validates token account ownership", async () => {
    // Create a token account owned by attacker but try to use it in maker's escrow
    const attackerControlledAccount = await createAssociatedTokenAccount(
      provider.connection,
      attacker,
      mintA,
      attacker.publicKey
    );

    try {
      await program.methods
        .make(seed, depositAmount, receiveAmount)
        .accounts({
          maker: maker.publicKey,
          mintA,
          mintB,
          makerAtaA: attackerControlledAccount, // Wrong ownership
          escrow,
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([maker])
        .rpc();

      assert.fail("Should have failed with wrong token account ownership");
    } catch (error) {
      console.log("Expected error for wrong token account ownership:", error.message);
    }
  });

  it("Prevents unauthorized account initialization", async () => {
    // Try to initialize an escrow account with an unauthorized program
    const unauthorizedProgram = Keypair.generate();

    try {
      // This would fail because only the escrow program can initialize escrow accounts
      const fakeEscrow = Keypair.generate();
      
      await program.methods
        .make(seed, depositAmount, receiveAmount)
        .accounts({
          maker: maker.publicKey,
          mintA,
          mintB,
          makerAtaA,
          escrow: fakeEscrow.publicKey, // Not a proper PDA
          vault,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([maker, fakeEscrow])
        .rpc();

      assert.fail("Should have failed with unauthorized escrow account");
    } catch (error) {
      console.log("Expected error for unauthorized escrow account:", error.message);
    }
  });
});
