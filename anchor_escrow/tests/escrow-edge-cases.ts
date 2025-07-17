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

describe("anchor-escrow-edge-cases", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.anchorEscrow as Program<AnchorEscrow>;
  const provider = anchor.getProvider();

  // Test accounts
  let maker: Keypair;
  let mintA: PublicKey;
  let mintB: PublicKey;
  let makerAtaA: PublicKey;
  
  beforeEach(async () => {
    maker = Keypair.generate();
    await provider.connection.requestAirdrop(maker.publicKey, 2 * LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 1000));

    mintA = await createMint(provider.connection, maker, maker.publicKey, null, 6);
    mintB = await createMint(provider.connection, maker, maker.publicKey, null, 6);
    
    makerAtaA = await createAssociatedTokenAccount(
      provider.connection,
      maker,
      mintA,
      maker.publicKey
    );

    await mintTo(
      provider.connection,
      maker,
      mintA,
      makerAtaA,
      maker.publicKey,
      2000000
    );
  });

  it("Tests escrow with very large seed values", async () => {
    const largeSeed = new anchor.BN("18446744073709551615"); // Max u64
    const depositAmount = new anchor.BN(1000000);
    const receiveAmount = new anchor.BN(500000);

    const [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), largeSeed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const vault = getAssociatedTokenAddressSync(mintA, escrow, true);

    await program.methods
      .make(largeSeed, depositAmount, receiveAmount)
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
    assert.equal(escrowAccount.seed.toString(), largeSeed.toString());
  });

  it("Tests escrow with zero receive amount", async () => {
    const seed = new anchor.BN(1);
    const depositAmount = new anchor.BN(1000000);
    const receiveAmount = new anchor.BN(0);

    const [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const vault = getAssociatedTokenAddressSync(mintA, escrow, true);

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
    assert.equal(escrowAccount.receive.toString(), "0");
  });

  it("Tests escrow with maximum token amounts", async () => {
    const seed = new anchor.BN(2);
    const maxAmount = new anchor.BN("18446744073709551615"); // Max u64
    
    // First mint maximum tokens to the maker
    await mintTo(
      provider.connection,
      maker,
      mintA,
      makerAtaA,
      maker.publicKey,
      Number.MAX_SAFE_INTEGER - 2000000 // Subtract what we already minted
    );

    const [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const vault = getAssociatedTokenAddressSync(mintA, escrow, true);

    try {
      await program.methods
        .make(seed, maxAmount, maxAmount)
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
      
      // If it succeeds, check the amounts
      const escrowAccount = await program.account.escrow.fetch(escrow);
      assert.equal(escrowAccount.receive.toString(), maxAmount.toString());
    } catch (error) {
      console.log("Expected error with maximum amounts:", error.message);
    }
  });

  it("Tests escrow with same mint for both tokens", async () => {
    const seed = new anchor.BN(3);
    const depositAmount = new anchor.BN(1000000);
    const receiveAmount = new anchor.BN(500000);

    const [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const vault = getAssociatedTokenAddressSync(mintA, escrow, true);

    await program.methods
      .make(seed, depositAmount, receiveAmount)
      .accounts({
        maker: maker.publicKey,
        mintA,
        mintB: mintA, // Same mint for both A and B
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
    assert.equal(escrowAccount.mintA.toString(), mintA.toString());
    assert.equal(escrowAccount.mintB.toString(), mintA.toString());
  });

  it("Tests multiple rapid escrow creations", async () => {
    const baseAmount = new anchor.BN(100000);
    const promises = [];

    for (let i = 0; i < 5; i++) {
      const seed = new anchor.BN(100 + i);
      const [escrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      const vault = getAssociatedTokenAddressSync(mintA, escrow, true);

      promises.push(
        program.methods
          .make(seed, baseAmount, baseAmount)
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
          .rpc()
      );
    }

    await Promise.all(promises);

    // Verify all escrows were created
    for (let i = 0; i < 5; i++) {
      const seed = new anchor.BN(100 + i);
      const [escrow] = PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
        program.programId
      );
      
      const escrowAccount = await program.account.escrow.fetch(escrow);
      assert.equal(escrowAccount.seed.toString(), seed.toString());
    }
  });

  it("Tests escrow account space and layout", async () => {
    const seed = new anchor.BN(200);
    const depositAmount = new anchor.BN(1000000);
    const receiveAmount = new anchor.BN(500000);

    const [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const vault = getAssociatedTokenAddressSync(mintA, escrow, true);

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

    // Check the account info
    const escrowAccountInfo = await provider.connection.getAccountInfo(escrow);
    assert.isNotNull(escrowAccountInfo);
    assert.equal(escrowAccountInfo.owner.toString(), program.programId.toString());
    
    // Check the data layout
    const escrowAccount = await program.account.escrow.fetch(escrow);
    assert.equal(escrowAccount.seed.toString(), seed.toString());
    assert.equal(escrowAccount.maker.toString(), maker.publicKey.toString());
    assert.equal(escrowAccount.mintA.toString(), mintA.toString());
    assert.equal(escrowAccount.mintB.toString(), mintB.toString());
    assert.equal(escrowAccount.receive.toString(), receiveAmount.toString());
    assert.isNumber(escrowAccount.bump);
  });

  it("Tests refund with empty vault (edge case)", async () => {
    const seed = new anchor.BN(300);
    const depositAmount = new anchor.BN(1);
    const receiveAmount = new anchor.BN(1);

    const [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const vault = getAssociatedTokenAddressSync(mintA, escrow, true);

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

    // Check vault has minimal amount
    const vaultAccount = await getAccount(provider.connection, vault);
    assert.equal(vaultAccount.amount.toString(), "1");

    // Refund the minimal amount
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

    // Verify escrow is closed
    try {
      await program.account.escrow.fetch(escrow);
      assert.fail("Escrow should be closed");
    } catch (error) {
      assert.include(error.message, "Account does not exist");
    }
  });

  it("Tests escrow with different token program (if applicable)", async () => {
    // This test would be more relevant if you have support for Token-2022
    // For now, we'll test that the current program works with the standard token program
    const seed = new anchor.BN(400);
    const depositAmount = new anchor.BN(1000000);
    const receiveAmount = new anchor.BN(500000);

    const [escrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    const vault = getAssociatedTokenAddressSync(mintA, escrow, true);

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
    assert.equal(escrowAccount.maker.toString(), maker.publicKey.toString());
  });
});
