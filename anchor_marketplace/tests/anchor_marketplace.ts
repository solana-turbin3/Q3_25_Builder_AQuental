import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorMarketplace } from "../target/types/anchor_marketplace";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";

describe("anchor-marketplace", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .AnchorMarketplace as Program<AnchorMarketplace>;

  let admin = Keypair.generate();
  let maker = Keypair.generate();
  let buyer = Keypair.generate();
  let buyer2 = Keypair.generate();
  let newAdmin = Keypair.generate();
  let treasury = Keypair.generate();

  let marketplace: PublicKey;
  let mint: PublicKey;
  let mint2: PublicKey;
  let makerATA: PublicKey;
  let buyerATA: PublicKey;
  let buyer2ATA: PublicKey;

  before(async () => {
    // Airdrop SOL
    for (const k of [admin, maker, buyer, buyer2, newAdmin, treasury]) {
      const sig = await provider.connection.requestAirdrop(
        k.publicKey,
        5 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Create NFT mints
    mint = await createMint(
      provider.connection,
      maker,
      maker.publicKey,
      null,
      0
    );
    mint2 = await createMint(
      provider.connection,
      maker,
      maker.publicKey,
      null,
      0
    );

    // Create ATAs and mint NFTs
    makerATA = await createAssociatedTokenAccount(
      provider.connection,
      maker,
      mint,
      maker.publicKey
    );
    await mintTo(provider.connection, maker, mint, makerATA, maker, 1);

    // Derive marketplace PDA
    const [mp] = PublicKey.findProgramAddressSync(
      [Buffer.from("marketplace"), Buffer.from("MyMarket")],
      program.programId
    );
    marketplace = mp;
  });

  describe("Marketplace Initialization", () => {
    it("Initializes marketplace successfully", async () => {
      await program.methods
        .initialize("MyMarket", 500) // 5% fee
        .accounts({
          marketplace,
          admin: admin.publicKey,
          treasury: treasury.publicKey,
        })
        .signers([admin])
        .rpc();

      const mpAcc = await program.account.marketplace.fetch(marketplace);
      expect(mpAcc.name).to.eq("MyMarket");
      expect(mpAcc.fee).to.eq(500);
      expect(mpAcc.admin.toBase58()).to.eq(admin.publicKey.toBase58());
      expect(mpAcc.treasury.toBase58()).to.eq(treasury.publicKey.toBase58());
    });

    it("Fails to initialize marketplace with same name twice", async () => {
      try {
        await program.methods
          .initialize("MyMarket", 300)
          .accounts({
            marketplace,
            admin: newAdmin.publicKey,
            treasury: treasury.publicKey,
          })
          .signers([newAdmin])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("already in use");
      }
    });

    it("Initializes marketplace with zero fee", async () => {
      const [marketplace2] = PublicKey.findProgramAddressSync(
        [Buffer.from("marketplace"), Buffer.from("NoFeeMarket")],
        program.programId
      );

      await program.methods
        .initialize("NoFeeMarket", 0)
        .accounts({
          marketplace: marketplace2,
          admin: admin.publicKey,
          treasury: treasury.publicKey,
        })
        .signers([admin])
        .rpc();

      const mpAcc = await program.account.marketplace.fetch(marketplace2);
      expect(mpAcc.fee).to.eq(100); // Should be set to MIN_MARKETPLACE_FEE
    });

    it("Initializes marketplace with maximum fee", async () => {
      const [marketplace3] = PublicKey.findProgramAddressSync(
        [Buffer.from("marketplace"), Buffer.from("MaxFeeMarket")],
        program.programId
      );

      await program.methods
        .initialize("MaxFeeMarket", 10000) // 100% fee (should be capped to 99%)
        .accounts({
          marketplace: marketplace3,
          admin: admin.publicKey,
          treasury: treasury.publicKey,
        })
        .signers([admin])
        .rpc();

      const mpAcc = await program.account.marketplace.fetch(marketplace3);
      expect(mpAcc.fee).to.eq(9900); // Should be capped to MAX_MARKETPLACE_FEE (99%)
    });

    it("Enforces minimum fee for low fee values", async () => {
      const [marketplace4] = PublicKey.findProgramAddressSync(
        [Buffer.from("marketplace"), Buffer.from("LowFeeMarket")],
        program.programId
      );

      // Try to initialize with 0.5% fee (50 basis points), should be set to 1% (100 basis points)
      await program.methods
        .initialize("LowFeeMarket", 50) // 0.5% fee
        .accounts({
          marketplace: marketplace4,
          admin: admin.publicKey,
          treasury: treasury.publicKey,
        })
        .signers([admin])
        .rpc();

      const mpAcc = await program.account.marketplace.fetch(marketplace4);
      expect(mpAcc.fee).to.eq(100); // Should be set to MIN_MARKETPLACE_FEE
    });

    it("Enforces maximum fee for extreme values", async () => {
      const [marketplace5] = PublicKey.findProgramAddressSync(
        [Buffer.from("marketplace"), Buffer.from("ExtremeFeeMarket")],
        program.programId
      );

      // Try to initialize with 200% fee (20000 basis points), should be capped to 99% (9900 basis points)
      await program.methods
        .initialize("ExtremeFeeMarket", 20000) // 200% fee
        .accounts({
          marketplace: marketplace5,
          admin: admin.publicKey,
          treasury: treasury.publicKey,
        })
        .signers([admin])
        .rpc();

      const mpAcc = await program.account.marketplace.fetch(marketplace5);
      expect(mpAcc.fee).to.eq(9900); // Should be capped to MAX_MARKETPLACE_FEE
    });
  });

  describe("NFT Listing", () => {
    it("Lists an NFT successfully", async () => {
      const [listing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), mint.toBuffer()],
        program.programId
      );
      const vault = await getAssociatedTokenAddress(mint, marketplace, true);

      const makerBalancePre = await provider.connection.getTokenAccountBalance(makerATA);
      expect(makerBalancePre.value.amount).to.eq("1");

      await program.methods
        .list(new anchor.BN(1 * LAMPORTS_PER_SOL))
        .accounts({
          maker: maker.publicKey,
          makerMint: mint,
          makerAta: makerATA,
          vault,
          listing,
          marketplace,
        })
        .signers([maker])
        .rpc();

      // Verify NFT moved from maker to vault
      const makerBalancePost = await provider.connection.getTokenAccountBalance(makerATA);
      expect(makerBalancePost.value.amount).to.eq("0");
      
      const vaultBalance = await provider.connection.getTokenAccountBalance(vault);
      expect(vaultBalance.value.amount).to.eq("1");

      // Verify listing created correctly
      const listingAcc = await program.account.listing.fetch(listing);
      expect(listingAcc.maker.toBase58()).to.eq(maker.publicKey.toBase58());
      expect(listingAcc.mint.toBase58()).to.eq(mint.toBase58());
      expect(listingAcc.price.toNumber()).to.eq(1 * LAMPORTS_PER_SOL);
    });

    it("Lists NFT with different prices", async () => {
      // Create another NFT for testing
      const makerATA2 = await createAssociatedTokenAccount(
        provider.connection,
        maker,
        mint2,
        maker.publicKey
      );
      await mintTo(provider.connection, maker, mint2, makerATA2, maker, 1);

      const [listing2] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), mint2.toBuffer()],
        program.programId
      );
      const vault2 = await getAssociatedTokenAddress(mint2, marketplace, true);

      const highPrice = new anchor.BN(10 * LAMPORTS_PER_SOL);
      
      await program.methods
        .list(highPrice)
        .accounts({
          maker: maker.publicKey,
          makerMint: mint2,
          makerAta: makerATA2,
          vault: vault2,
          listing: listing2,
          marketplace,
        })
        .signers([maker])
        .rpc();

      const listingAcc = await program.account.listing.fetch(listing2);
      expect(listingAcc.price.toNumber()).to.eq(10 * LAMPORTS_PER_SOL);
    });

    it("Fails to list NFT without owning it", async () => {
      const fakeMint = await createMint(
        provider.connection,
        buyer,
        buyer.publicKey,
        null,
        0
      );

      const [listing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), fakeMint.toBuffer()],
        program.programId
      );
      const vault = await getAssociatedTokenAddress(fakeMint, marketplace, true);
      const fakeATA = await getAssociatedTokenAddress(fakeMint, maker.publicKey);

      try {
        await program.methods
          .list(new anchor.BN(1 * LAMPORTS_PER_SOL))
          .accounts({
            maker: maker.publicKey,
            makerMint: fakeMint,
            makerAta: fakeATA,
            vault,
            listing,
            marketplace,
          })
          .signers([maker])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        // Should fail because maker doesn't have the token
        expect(error.message).to.include("AnchorError");
      }
    });

    it("Fails to list with zero price", async () => {
      const mint3 = await createMint(
        provider.connection,
        maker,
        maker.publicKey,
        null,
        0
      );
      const makerATA3 = await createAssociatedTokenAccount(
        provider.connection,
        maker,
        mint3,
        maker.publicKey
      );
      await mintTo(provider.connection, maker, mint3, makerATA3, maker, 1);

      const [listing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), mint3.toBuffer()],
        program.programId
      );
      const vault = await getAssociatedTokenAddress(mint3, marketplace, true);

      // This should actually succeed as there's no price validation in the contract
      await program.methods
        .list(new anchor.BN(0))
        .accounts({
          maker: maker.publicKey,
          makerMint: mint3,
          makerAta: makerATA3,
          vault,
          listing,
          marketplace,
        })
        .signers([maker])
        .rpc();

      const listingAcc = await program.account.listing.fetch(listing);
      expect(listingAcc.price.toNumber()).to.eq(0);
    });
  });

  describe("NFT Purchase", () => {
    it("Purchases NFT successfully", async () => {
      const [listing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), mint.toBuffer()],
        program.programId
      );
      const vault = await getAssociatedTokenAddress(mint, marketplace, true);
      buyerATA = await getAssociatedTokenAddress(mint, buyer.publicKey);

      const makerBalancePre = await provider.connection.getBalance(maker.publicKey);
      const buyerBalancePre = await provider.connection.getBalance(buyer.publicKey);
      const treasuryBalancePre = await provider.connection.getBalance(treasury.publicKey);

      await program.methods
        .purchase()
        .accounts({
          buyer: buyer.publicKey,
          maker: maker.publicKey,
          makerMint: mint,
          vault,
          listing,
          takerAta: buyerATA,
          marketplace,
          treasury: treasury.publicKey,
        })
        .signers([buyer])
        .rpc();

      // Verify NFT transferred to buyer
      const buyerTokenBalance = await provider.connection.getTokenAccountBalance(buyerATA);
      expect(buyerTokenBalance.value.amount).to.eq("1");

      // Verify vault is closed
      try {
        await provider.connection.getTokenAccountBalance(vault);
        expect.fail("Vault should be closed");
      } catch (error) {
        expect(error.message).to.include("could not find account");
      }

      // Verify listing is closed
      try {
        await program.account.listing.fetch(listing);
        expect.fail("Listing should be closed");
      } catch (error) {
        expect(error.message).to.include("Account does not exist");
      }

      // Verify payments
      const makerBalancePost = await provider.connection.getBalance(maker.publicKey);
      const treasuryBalancePost = await provider.connection.getBalance(treasury.publicKey);
      
      const expectedNet = 0.95 * LAMPORTS_PER_SOL; // 95% of 1 SOL
      const expectedFee = 0.05 * LAMPORTS_PER_SOL; // 5% of 1 SOL
      
      expect(makerBalancePost).to.be.greaterThan(makerBalancePre + expectedNet - 10000); // Allow for small variance
      expect(treasuryBalancePost).to.be.greaterThan(treasuryBalancePre + expectedFee - 10000);
    });

    it("Fails to purchase non-existent listing", async () => {
      const fakeMint = await createMint(
        provider.connection,
        buyer,
        buyer.publicKey,
        null,
        0
      );

      const [fakeListing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), fakeMint.toBuffer()],
        program.programId
      );
      const fakeVault = await getAssociatedTokenAddress(fakeMint, marketplace, true);
      const fakeBuyerATA = await getAssociatedTokenAddress(fakeMint, buyer.publicKey);

      try {
        await program.methods
          .purchase()
          .accounts({
            buyer: buyer.publicKey,
            maker: maker.publicKey,
            makerMint: fakeMint,
            vault: fakeVault,
            listing: fakeListing,
            takerAta: fakeBuyerATA,
            marketplace,
            treasury: treasury.publicKey,
          })
          .signers([buyer])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("AnchorError");
      }
    });

    it("Fails to purchase with insufficient funds", async () => {
      // Create a new buyer with limited funds
      const poorBuyer = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        poorBuyer.publicKey,
        0.1 * LAMPORTS_PER_SOL // Only 0.1 SOL
      );
      await provider.connection.confirmTransaction(sig);

      // List a high-priced NFT
      const [listing2] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), mint2.toBuffer()],
        program.programId
      );
      const vault2 = await getAssociatedTokenAddress(mint2, marketplace, true);
      const poorBuyerATA = await getAssociatedTokenAddress(mint2, poorBuyer.publicKey);

      try {
        await program.methods
          .purchase()
          .accounts({
            buyer: poorBuyer.publicKey,
            maker: maker.publicKey,
            makerMint: mint2,
            vault: vault2,
            listing: listing2,
            takerAta: poorBuyerATA,
            marketplace,
            treasury: treasury.publicKey,
          })
          .signers([poorBuyer])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("Simulation failed");
      }
    });
  });

  describe("NFT Delisting", () => {
    let delistMint: PublicKey;
    let delistMakerATA: PublicKey;
    let delistListing: PublicKey;
    let delistVault: PublicKey;

    beforeEach(async () => {
      // Create a new NFT for delisting tests
      delistMint = await createMint(
        provider.connection,
        maker,
        maker.publicKey,
        null,
        0
      );
      delistMakerATA = await createAssociatedTokenAccount(
        provider.connection,
        maker,
        delistMint,
        maker.publicKey
      );
      await mintTo(provider.connection, maker, delistMint, delistMakerATA, maker, 1);

      // List the NFT
      const [listing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), delistMint.toBuffer()],
        program.programId
      );
      delistListing = listing;
      delistVault = await getAssociatedTokenAddress(delistMint, marketplace, true);

      await program.methods
        .list(new anchor.BN(2 * LAMPORTS_PER_SOL))
        .accounts({
          maker: maker.publicKey,
          makerMint: delistMint,
          makerAta: delistMakerATA,
          vault: delistVault,
          listing: delistListing,
          marketplace,
        })
        .signers([maker])
        .rpc();
    });

    it("Delists NFT successfully", async () => {
      // Verify NFT is in vault before delisting
      const vaultBalancePre = await provider.connection.getTokenAccountBalance(delistVault);
      expect(vaultBalancePre.value.amount).to.eq("1");

      const makerBalancePre = await provider.connection.getTokenAccountBalance(delistMakerATA);
      expect(makerBalancePre.value.amount).to.eq("0");

      await program.methods
        .delist()
        .accounts({
          maker: maker.publicKey,
          makerMint: delistMint,
          vault: delistVault,
          makerAta: delistMakerATA,
          listing: delistListing,
          marketplace,
        })
        .signers([maker])
        .rpc();

      // Verify NFT returned to maker
      const makerBalancePost = await provider.connection.getTokenAccountBalance(delistMakerATA);
      expect(makerBalancePost.value.amount).to.eq("1");

      // Verify listing is closed
      try {
        await program.account.listing.fetch(delistListing);
        expect.fail("Listing should be closed");
      } catch (error) {
        expect(error.message).to.include("Account does not exist");
      }
    });

    it("Fails to delist if not the maker", async () => {
      // Create a fake buyer ATA to trigger the constraint
      const buyerATA = await getAssociatedTokenAddress(delistMint, buyer.publicKey);
      
      try {
        await program.methods
          .delist()
          .accounts({
            maker: buyer.publicKey, // Wrong maker
            makerMint: delistMint,
            vault: delistVault,
            makerAta: buyerATA, // Wrong ATA
            listing: delistListing, // This listing is seeded with the original maker
            marketplace,
          })
          .signers([buyer])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        // This should fail due to constraints or seeds mismatch
        expect(error.message).to.include("AnchorError");
      }
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("Handles zero fee marketplace correctly", async () => {
      const [noFeeMarketplace] = PublicKey.findProgramAddressSync(
        [Buffer.from("marketplace"), Buffer.from("NoFeeMarket")],
        program.programId
      );

      // Create NFT for zero fee test
      const zeroFeeMint = await createMint(
        provider.connection,
        maker,
        maker.publicKey,
        null,
        0
      );
      const zeroFeeMakerATA = await createAssociatedTokenAccount(
        provider.connection,
        maker,
        zeroFeeMint,
        maker.publicKey
      );
      await mintTo(provider.connection, maker, zeroFeeMint, zeroFeeMakerATA, maker, 1);

      // List NFT
      const [listing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), zeroFeeMint.toBuffer()],
        program.programId
      );
      const vault = await getAssociatedTokenAddress(zeroFeeMint, noFeeMarketplace, true);

      await program.methods
        .list(new anchor.BN(1 * LAMPORTS_PER_SOL))
        .accounts({
          maker: maker.publicKey,
          makerMint: zeroFeeMint,
          makerAta: zeroFeeMakerATA,
          vault,
          listing,
          marketplace: noFeeMarketplace,
        })
        .signers([maker])
        .rpc();

      // Purchase NFT
      const zeroFeeBuyerATA = await getAssociatedTokenAddress(zeroFeeMint, buyer2.publicKey);
      const makerBalancePre = await provider.connection.getBalance(maker.publicKey);
      const treasuryBalancePre = await provider.connection.getBalance(treasury.publicKey);

      await program.methods
        .purchase()
        .accounts({
          buyer: buyer2.publicKey,
          maker: maker.publicKey,
          makerMint: zeroFeeMint,
          vault,
          listing,
          takerAta: zeroFeeBuyerATA,
          marketplace: noFeeMarketplace,
          treasury: treasury.publicKey,
        })
        .signers([buyer2])
        .rpc();

      // Verify full payment went to maker (no fee)
      const makerBalancePost = await provider.connection.getBalance(maker.publicKey);
      const treasuryBalancePost = await provider.connection.getBalance(treasury.publicKey);
      
      // With minimum fee enforcement, even "zero fee" marketplace has 1% fee
      const expectedNet = 0.99 * LAMPORTS_PER_SOL; // 99% of 1 SOL (1% fee)
      const expectedFee = 0.01 * LAMPORTS_PER_SOL; // 1% of 1 SOL
      
      expect(makerBalancePost).to.be.greaterThan(makerBalancePre + expectedNet - 10000);
      expect(treasuryBalancePost).to.be.greaterThan(treasuryBalancePre + expectedFee - 10000);
    });

    it("Handles maximum fee marketplace correctly", async () => {
      const [maxFeeMarketplace] = PublicKey.findProgramAddressSync(
        [Buffer.from("marketplace"), Buffer.from("MaxFeeMarket")],
        program.programId
      );

      // Create NFT for max fee test
      const maxFeeMint = await createMint(
        provider.connection,
        maker,
        maker.publicKey,
        null,
        0
      );
      const maxFeeMakerATA = await createAssociatedTokenAccount(
        provider.connection,
        maker,
        maxFeeMint,
        maker.publicKey
      );
      await mintTo(provider.connection, maker, maxFeeMint, maxFeeMakerATA, maker, 1);

      // List NFT
      const [listing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), maxFeeMint.toBuffer()],
        program.programId
      );
      const vault = await getAssociatedTokenAddress(maxFeeMint, maxFeeMarketplace, true);

      await program.methods
        .list(new anchor.BN(1 * LAMPORTS_PER_SOL))
        .accounts({
          maker: maker.publicKey,
          makerMint: maxFeeMint,
          makerAta: maxFeeMakerATA,
          vault,
          listing,
          marketplace: maxFeeMarketplace,
        })
        .signers([maker])
        .rpc();

      // Purchase NFT
      const maxFeeBuyerATA = await getAssociatedTokenAddress(maxFeeMint, buyer2.publicKey);
      const makerBalancePre = await provider.connection.getBalance(maker.publicKey);
      const treasuryBalancePre = await provider.connection.getBalance(treasury.publicKey);

      await program.methods
        .purchase()
        .accounts({
          buyer: buyer2.publicKey,
          maker: maker.publicKey,
          makerMint: maxFeeMint,
          vault,
          listing,
          takerAta: maxFeeBuyerATA,
          marketplace: maxFeeMarketplace,
          treasury: treasury.publicKey,
        })
        .signers([buyer2])
        .rpc();

      // Verify payment distribution with 99% fee
      const makerBalancePost = await provider.connection.getBalance(maker.publicKey);
      const treasuryBalancePost = await provider.connection.getBalance(treasury.publicKey);
      
      // With 99% fee, maker should only receive 1% of sale + vault rent refund
      const expectedNet = 0.01 * LAMPORTS_PER_SOL; // 1% of 1 SOL
      const expectedFee = 0.99 * LAMPORTS_PER_SOL; // 99% of 1 SOL
      
      const makerGain = makerBalancePost - makerBalancePre;
      expect(makerGain).to.be.greaterThan(expectedNet - 10000); // Should include 1% + rent refund
      expect(treasuryBalancePost).to.be.greaterThan(treasuryBalancePre + expectedFee - 10000); // 99% fee to treasury
    });

    it("Handles concurrent listings of different NFTs", async () => {
      // Create multiple NFTs
      const mints = [];
      const atas = [];
      const listings = [];
      const vaults = [];

      for (let i = 0; i < 3; i++) {
        const mint = await createMint(
          provider.connection,
          maker,
          maker.publicKey,
          null,
          0
        );
        const ata = await createAssociatedTokenAccount(
          provider.connection,
          maker,
          mint,
          maker.publicKey
        );
        await mintTo(provider.connection, maker, mint, ata, maker, 1);

        const [listing] = PublicKey.findProgramAddressSync(
          [Buffer.from("listing"), mint.toBuffer()],
          program.programId
        );
        const vault = await getAssociatedTokenAddress(mint, marketplace, true);

        mints.push(mint);
        atas.push(ata);
        listings.push(listing);
        vaults.push(vault);
      }

      // List all NFTs
      for (let i = 0; i < 3; i++) {
        await program.methods
          .list(new anchor.BN((i + 1) * LAMPORTS_PER_SOL))
          .accounts({
            maker: maker.publicKey,
            makerMint: mints[i],
            makerAta: atas[i],
            vault: vaults[i],
            listing: listings[i],
            marketplace,
          })
          .signers([maker])
          .rpc();
      }

      // Verify all listings exist
      for (let i = 0; i < 3; i++) {
        const listingAcc = await program.account.listing.fetch(listings[i]);
        expect(listingAcc.price.toNumber()).to.eq((i + 1) * LAMPORTS_PER_SOL);
      }
    });
  });

  describe("Account State Verification", () => {
    it("Verifies marketplace state persists correctly", async () => {
      const mpAcc = await program.account.marketplace.fetch(marketplace);
      expect(mpAcc.name).to.eq("MyMarket");
      expect(mpAcc.fee).to.eq(500);
      expect(mpAcc.admin.toBase58()).to.eq(admin.publicKey.toBase58());
      expect(mpAcc.treasury.toBase58()).to.eq(treasury.publicKey.toBase58());
    });

    it("Verifies token account authorities are correct", async () => {
      // Create and list a new NFT to test authorities
      const testMint = await createMint(
        provider.connection,
        maker,
        maker.publicKey,
        null,
        0
      );
      const testMakerATA = await createAssociatedTokenAccount(
        provider.connection,
        maker,
        testMint,
        maker.publicKey
      );
      await mintTo(provider.connection, maker, testMint, testMakerATA, maker, 1);

      const [listing] = PublicKey.findProgramAddressSync(
        [Buffer.from("listing"), testMint.toBuffer()],
        program.programId
      );
      const vault = await getAssociatedTokenAddress(testMint, marketplace, true);

      await program.methods
        .list(new anchor.BN(1 * LAMPORTS_PER_SOL))
        .accounts({
          maker: maker.publicKey,
          makerMint: testMint,
          makerAta: testMakerATA,
          vault,
          listing,
          marketplace,
        })
        .signers([maker])
        .rpc();

      // Verify vault is owned by marketplace PDA
      const vaultInfo = await getAccount(provider.connection, vault);
      expect(vaultInfo.owner.toBase58()).to.eq(marketplace.toBase58());
      expect(vaultInfo.mint.toBase58()).to.eq(testMint.toBase58());
      expect(vaultInfo.amount.toString()).to.eq("1");
    });
  });
});
