import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SprintVault } from "../../target/types/sprint_vault";
import { expect } from "chai";
import {
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  PublicKey
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount
} from "@solana/spl-token";
import BN from "bn.js";

describe("sprint-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SprintVault as Program<SprintVault>;
  
  let employer: Keypair;
  let freelancer: Keypair;
  let mint: PublicKey;
  let employerTokenAccount: PublicKey;
  let freelancerTokenAccount: PublicKey;

  before(async () => {
    employer = Keypair.generate();
    freelancer = Keypair.generate();

    // Fund the accounts
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(employer.publicKey, 2 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(freelancer.publicKey, LAMPORTS_PER_SOL)
    );

    // Create mint
    mint = await createMint(
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
    employerTokenAccount = employerATA.address;

    const freelancerATA = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      employer,
      mint,
      freelancer.publicKey
    );
    freelancerTokenAccount = freelancerATA.address;

    // Mint tokens to employer
    await mintTo(
      provider.connection,
      employer,
      mint,
      employerTokenAccount,
      employer,
      1000000000 // 1000 tokens with 6 decimals
    );
  });

  describe("Sprint Creation", () => {
    it("Creates a sprint successfully", async () => {
      const sprintId = new BN(1);
      const startTime = new BN(Math.floor(Date.now() / 1000) + 10); // Start in 10 seconds
      const totalAmount = new BN(100000000); // 100 tokens
      
      // Calculate PDAs
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [
          sprintPda.toBuffer(),
          TOKEN_PROGRAM_ID.toBuffer(),
          mint.toBuffer()
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Create sprint
      await program.methods
        .createSprint(
          sprintId,
          startTime,
          { twoWeeks: {} }, // SprintDuration enum
          totalAmount,
          { quadratic: {} } // AccelerationType enum (optional)
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

      // Verify sprint was created
      const sprintAccount = await program.account.sprint.fetch(sprintPda);
      expect(sprintAccount.sprintId.toString()).to.equal(sprintId.toString());
      expect(sprintAccount.employer.toString()).to.equal(employer.publicKey.toString());
      expect(sprintAccount.freelancer.toString()).to.equal(freelancer.publicKey.toString());
      expect(sprintAccount.totalAmount.toString()).to.equal(totalAmount.toString());
      expect(sprintAccount.isFunded).to.be.false;
    });

    it("Funds a sprint", async () => {
      const sprintId = new BN(1);
      const amount = new BN(100000000); // 100 tokens
      
      // Calculate PDAs
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [
          sprintPda.toBuffer(),
          TOKEN_PROGRAM_ID.toBuffer(),
          mint.toBuffer()
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Fund the sprint
      await program.methods
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

      // Verify sprint is funded
      const sprintAccount = await program.account.sprint.fetch(sprintPda);
      expect(sprintAccount.isFunded).to.be.true;

      // Verify vault has tokens
      const vaultAccount = await getAccount(provider.connection, vaultPda);
      expect(vaultAccount.amount.toString()).to.equal(amount.toString());
    });

    it("Withdraws streamed payment", async () => {
      const sprintId = new BN(1);
      
      // Calculate PDAs
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [
          sprintPda.toBuffer(),
          TOKEN_PROGRAM_ID.toBuffer(),
          mint.toBuffer()
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Wait a bit to accumulate some withdrawable amount
      await new Promise(resolve => setTimeout(resolve, 12000));

      // Get initial balance
      const initialBalance = await getAccount(provider.connection, freelancerTokenAccount);

      // Withdraw streamed payment
      await program.methods
        .withdrawStreamed()
        .accounts({
          sprint: sprintPda,
          vault: vaultPda,
          freelancerTokenAccount: freelancerTokenAccount,
          freelancer: freelancer.publicKey,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([freelancer])
        .rpc();

      // Verify withdrawal
      const finalBalance = await getAccount(provider.connection, freelancerTokenAccount);
      expect(Number(finalBalance.amount)).to.be.greaterThan(Number(initialBalance.amount));

      // Verify sprint updated
      const sprintAccount = await program.account.sprint.fetch(sprintPda);
      expect(Number(sprintAccount.withdrawnAmount)).to.be.greaterThan(0);
    });
  });

  describe("Sprint Controls", () => {
    it("Pauses a sprint", async () => {
      const sprintId = new BN(1);
      
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      await program.methods
        .pauseStream()
        .accounts({
          sprint: sprintPda,
          employer: employer.publicKey,
        })
        .signers([employer])
        .rpc();

      const sprintAccount = await program.account.sprint.fetch(sprintPda);
      expect(sprintAccount.isPaused).to.be.true;
    });

    it("Resumes a sprint", async () => {
      const sprintId = new BN(1);
      
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8)
        ],
        program.programId
      );

      await program.methods
        .resumeStream()
        .accounts({
          sprint: sprintPda,
          employer: employer.publicKey,
        })
        .signers([employer])
        .rpc();

      const sprintAccount = await program.account.sprint.fetch(sprintPda);
      expect(sprintAccount.isPaused).to.be.false;
    });
  });
});
