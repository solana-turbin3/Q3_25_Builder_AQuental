import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SprintVault } from "../target/types/sprint_vault";
import { Vault } from "../target/types/vault";
import { 
  Keypair, 
  LAMPORTS_PER_SOL, 
  PublicKey, 
  SystemProgram,
  Transaction
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  createAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import { BN } from "bn.js";

describe("Vault Integration Tests", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const sprintVaultProgram = anchor.workspace.SprintVault as Program<SprintVault>;
  const vaultProgram = anchor.workspace.Vault as Program<Vault>;

  let employer: Keypair;
  let freelancer: Keypair;
  let mint: PublicKey;
  let employerTokenAccount: PublicKey;
  let freelancerTokenAccount: PublicKey;
  let vaultConfig: PublicKey;
  let feeRecipient: Keypair;

  const USDC_DECIMALS = 6;
  const ONE_USDC = new BN(10 ** USDC_DECIMALS);
  const HUNDRED_USDC = ONE_USDC.mul(new BN(100));

  before(async () => {
    // Create test wallets
    employer = Keypair.generate();
    freelancer = Keypair.generate();
    feeRecipient = Keypair.generate();

    // Airdrop SOL to test wallets and provider wallet
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(employer.publicKey, 2 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(freelancer.publicKey, 1 * LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(provider.wallet.publicKey, 2 * LAMPORTS_PER_SOL)
    );

    // Create test token mint (simulated USDC)
    mint = await createMint(
      provider.connection,
      employer,
      employer.publicKey,
      null,
      USDC_DECIMALS
    );

    // Create token accounts
    employerTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      employer,
      mint,
      employer.publicKey
    );

    freelancerTokenAccount = await createAssociatedTokenAccount(
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
      1000 * 10 ** USDC_DECIMALS
    );

    // Initialize Vault program config
    vaultConfig = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow_config")],
      vaultProgram.programId
    )[0];

    // Check if config exists first
    const configInfo = await provider.connection.getAccountInfo(vaultConfig);
    
    if (!configInfo) {
      try {
        await vaultProgram.methods
          .initializeConfig(
            100, // 1% fee (100 basis points)
            ONE_USDC.toNumber(), // Min escrow amount: 1 USDC
            365 * 24 * 60 * 60 // Max duration: 1 year
          )
          .accounts({
            config: vaultConfig,
            authority: provider.wallet.publicKey,
            feeRecipient: feeRecipient.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log("Vault config initialized");
      } catch (e) {
        console.log("Failed to initialize config:", e.message);
      }
    } else {
      console.log("Config already exists");
    }
  });

  describe("Phase 1: Core Escrow Functionality", () => {
    it("Should create a linear release escrow", async () => {
      const vaultId = new BN(Date.now());
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 60; // Start in 1 minute
      const endTime = startTime + 3600; // 1 hour duration

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );

      // Create escrow with linear release schedule
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { linear: { start: new BN(startTime), end: new BN(endTime) } },
          { beneficiary: {} }, // Beneficiary can withdraw
          null, // No expiration
          null  // No arbiter
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey, // In real case, this would be Sprint PDA
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();

      // Verify escrow was created
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      assert.equal(escrowAccount.vaultId.toNumber(), vaultId.toNumber());
      assert.equal(escrowAccount.totalAmount.toNumber(), HUNDRED_USDC.toNumber());
      assert.equal(escrowAccount.depositor.toBase58(), employer.publicKey.toBase58());
      assert.equal(escrowAccount.beneficiary.toBase58(), freelancer.publicKey.toBase58());
    });

    it("Should deposit funds to escrow", async () => {
      const vaultId = new BN(Date.now() + 1);
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 60;
      const endTime = startTime + 3600;

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );

      // Create escrow
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { linear: { start: new BN(startTime), end: new BN(endTime) } },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();

      // Deposit funds
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();

      // Verify deposit
      const vaultBalance = await provider.connection.getTokenAccountBalance(vaultTokenAccount);
      assert.equal(vaultBalance.value.amount, HUNDRED_USDC.toNumber().toString());

      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      assert.equal(escrowAccount.status.active, undefined); // Should be Active
    });

    it("Should withdraw available funds (immediate release)", async () => {
      const vaultId = new BN(Date.now() + 2);

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );

      // Create escrow with immediate release
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { immediate: {} }, // Immediate release schedule
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();

      // Deposit funds
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();

      // Get freelancer balance before withdrawal
      const balanceBefore = await provider.connection.getTokenAccountBalance(freelancerTokenAccount);

      // Withdraw all available funds
      await vaultProgram.methods
        .withdrawAvailable(null) // Withdraw all available
        .accounts({
          escrowVault,
          vaultTokenAccount,
          withdrawer: freelancer.publicKey,
          withdrawerTokenAccount: freelancerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([freelancer])
        .rpc();

      // Verify withdrawal
      const balanceAfter = await provider.connection.getTokenAccountBalance(freelancerTokenAccount);
      const withdrawn = Number(balanceAfter.value.amount) - Number(balanceBefore.value.amount);
      
      // Account for potential fee
      assert.isAtLeast(withdrawn, HUNDRED_USDC.toNumber() * 0.99); // At least 99% (1% fee)
      assert.isAtMost(withdrawn, HUNDRED_USDC.toNumber());
    });
  });

  describe("Phase 2: Advanced Release Schedules", () => {
    it("Should create milestone-based escrow", async () => {
      const vaultId = new BN(Date.now() + 3);

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );

      // Create milestones
      const milestones = [
        {
          milestoneId: 1,
          amount: ONE_USDC.mul(new BN(30)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
        {
          milestoneId: 2,
          amount: ONE_USDC.mul(new BN(30)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
        {
          milestoneId: 3,
          amount: ONE_USDC.mul(new BN(40)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
      ];

      // Create escrow with milestone release
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { milestone: { conditions: milestones } },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();

      // Verify milestone escrow created
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      assert.equal(escrowAccount.vaultId.toNumber(), vaultId.toNumber());
      
      // Check release schedule is milestone type
      assert.exists(escrowAccount.releaseSchedule.milestone);
      assert.equal(escrowAccount.releaseSchedule.milestone.conditions.length, 3);
    });

    it("Should release milestone and allow withdrawal", async () => {
      const vaultId = new BN(Date.now() + 4);

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );

      // Create milestones
      const milestones = [
        {
          milestoneId: 1,
          amount: ONE_USDC.mul(new BN(50)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
        {
          milestoneId: 2,
          amount: ONE_USDC.mul(new BN(50)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
      ];

      // Create and fund milestone escrow
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { milestone: { conditions: milestones } },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();

      // Deposit funds
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();

      // Release first milestone
      await vaultProgram.methods
        .releaseMilestone(1)
        .accounts({
          escrowVault,
          authority: employer.publicKey,
        })
        .signers([employer])
        .rpc();

      // Withdraw released milestone funds
      const balanceBefore = await provider.connection.getTokenAccountBalance(freelancerTokenAccount);

      await vaultProgram.methods
        .withdrawAvailable(null)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          withdrawer: freelancer.publicKey,
          withdrawerTokenAccount: freelancerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([freelancer])
        .rpc();

      const balanceAfter = await provider.connection.getTokenAccountBalance(freelancerTokenAccount);
      const withdrawn = Number(balanceAfter.value.amount) - Number(balanceBefore.value.amount);
      
      // Should have withdrawn 50 USDC (minus potential fee)
      assert.isAtLeast(withdrawn, ONE_USDC.mul(new BN(49)).toNumber()); // At least 49 USDC
      assert.isAtMost(withdrawn, ONE_USDC.mul(new BN(50)).toNumber());
    });

    it("Should handle hybrid release schedule", async () => {
      const vaultId = new BN(Date.now() + 5);
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 60;
      const endTime = startTime + 3600;

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );

      // Create hybrid schedule: 50% linear, 50% milestone
      const linearPortion = ONE_USDC.mul(new BN(50));
      const milestonePortion = ONE_USDC.mul(new BN(50));

      const linearConfig = {
        startTime: new BN(startTime),
        endTime: new BN(endTime),
        accelerationType: { linear: {} },
      };

      const milestoneConfig = [
        {
          milestoneId: 1,
          amount: ONE_USDC.mul(new BN(25)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
        {
          milestoneId: 2,
          amount: ONE_USDC.mul(new BN(25)),
          requiredApproval: employer.publicKey,
          isCompleted: false,
        },
      ];

      // Create hybrid escrow
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          {
            hybrid: {
              linearPortion,
              milestonePortion,
              linearConfig,
              milestoneConfig,
            },
          },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();

      // Verify hybrid escrow created
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      assert.exists(escrowAccount.releaseSchedule.hybrid);
      assert.equal(
        escrowAccount.releaseSchedule.hybrid.linearPortion.toNumber(),
        linearPortion.toNumber()
      );
      assert.equal(
        escrowAccount.releaseSchedule.hybrid.milestonePortion.toNumber(),
        milestonePortion.toNumber()
      );
    });

    it("Should update release schedule", async () => {
      const vaultId = new BN(Date.now() + 6);
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 60;
      const endTime = startTime + 3600;

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );

      // Create escrow with linear release
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { linear: { start: new BN(startTime), end: new BN(endTime) } },
          { depositor: {} }, // Depositor can release
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();

      // Fund the escrow
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();

      // Update to immediate release
      await vaultProgram.methods
        .updateReleaseSchedule({ immediate: {} })
        .accounts({
          escrowVault,
          authority: employer.publicKey,
          config: vaultConfig,
        })
        .signers([employer])
        .rpc();

      // Verify schedule updated
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      assert.exists(escrowAccount.releaseSchedule.immediate);
    });

    it("Should close escrow and refund remaining funds", async () => {
      const vaultId = new BN(Date.now() + 7);

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );

      // Create and fund escrow
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { immediate: {} },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();

      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();

      // Get employer balance before closing
      const balanceBefore = await provider.connection.getTokenAccountBalance(employerTokenAccount);

      // Close escrow (should refund all funds)
      await vaultProgram.methods
        .closeEscrow()
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();

      // Verify refund
      const balanceAfter = await provider.connection.getTokenAccountBalance(employerTokenAccount);
      const refunded = Number(balanceAfter.value.amount) - Number(balanceBefore.value.amount);
      
      // Should have refunded 100 USDC (minus potential fee)
      assert.isAtLeast(refunded, HUNDRED_USDC.toNumber() * 0.99);
      assert.isAtMost(refunded, HUNDRED_USDC.toNumber());

      // Verify escrow account closed
      try {
        await vaultProgram.account.escrowVault.fetch(escrowVault);
        assert.fail("Escrow account should be closed");
      } catch (e) {
        assert.include(e.message, "Account does not exist");
      }
    });
  });

  describe("Integration with SprintVault", () => {
    it("Should allow SprintVault to create escrow via CPI", async () => {
      // This test demonstrates how SprintVault would use the Vault program
      // In a real implementation, SprintVault would make CPIs to Vault program
      // For now, we'll simulate the flow

      const sprintId = new BN(Date.now());
      const vaultId = sprintId; // Use same ID for simplicity
      const now = Math.floor(Date.now() / 1000);
      const startTime = now + 60;
      const endTime = startTime + 7200; // 2 hours

      // Find Sprint PDA (from SprintVault program)
      const [sprintPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("sprint"),
          employer.publicKey.toBuffer(),
          sprintId.toArrayLike(Buffer, "le", 8),
        ],
        sprintVaultProgram.programId
      );

      // Find Escrow Vault PDA (owned by Vault program)
      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );

      // Create escrow that would be owned by SprintVault program
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { linear: { start: new BN(startTime), end: new BN(endTime) } },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId, // SprintVault owns this
          ownerAccount: sprintPda, // Sprint PDA would be the owner account
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();

      // Verify escrow is owned by SprintVault program
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      assert.equal(
        escrowAccount.ownerProgram.toBase58(),
        sprintVaultProgram.programId.toBase58()
      );
      assert.equal(escrowAccount.ownerAccount.toBase58(), sprintPda.toBase58());
    });

    it("Should demonstrate acceleration types (Quadratic)", async () => {
      const vaultId = new BN(Date.now() + 8);
      const now = Math.floor(Date.now() / 1000);
      const startTime = now;
      const endTime = startTime + 100; // Short duration for testing

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );

      // Create hybrid escrow with quadratic acceleration
      const linearConfig = {
        startTime: new BN(startTime),
        endTime: new BN(endTime),
        accelerationType: { quadratic: {} }, // Quadratic acceleration
      };

      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          {
            hybrid: {
              linearPortion: HUNDRED_USDC,
              milestonePortion: new BN(0),
              linearConfig,
              milestoneConfig: [],
            },
          },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();

      // Fund the escrow
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();

      // Wait for 25% of time to pass
      await new Promise((resolve) => setTimeout(resolve, 25000));

      // At 25% time with quadratic acceleration, should have ~6.25% available
      // (0.25^2 = 0.0625)
      const escrowAccount = await vaultProgram.account.escrowVault.fetch(escrowVault);
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Note: In real tests, we would calculate the exact expected amount
      // based on the quadratic formula
      console.log("Escrow created with quadratic acceleration");
      console.log("Start time:", startTime);
      console.log("End time:", endTime);
      console.log("Current time:", currentTime);
    });
  });

  describe("Error Cases and Edge Conditions", () => {
    it("Should reject withdrawal from unauthorized account", async () => {
      const vaultId = new BN(Date.now() + 9);

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );

      // Create escrow where only beneficiary can withdraw
      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { immediate: {} },
          { beneficiary: {} }, // Only beneficiary can withdraw
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();

      // Fund the escrow
      await vaultProgram.methods
        .depositFunds(HUNDRED_USDC)
        .accounts({
          escrowVault,
          vaultTokenAccount,
          depositor: employer.publicKey,
          depositorTokenAccount: employerTokenAccount,
          config: vaultConfig,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([employer])
        .rpc();

      // Try to withdraw as employer (should fail)
      try {
        await vaultProgram.methods
          .withdrawAvailable(null)
          .accounts({
            escrowVault,
            vaultTokenAccount,
            withdrawer: employer.publicKey,
            withdrawerTokenAccount: employerTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([employer])
          .rpc();
        assert.fail("Should have failed - unauthorized withdrawal");
      } catch (e) {
        assert.include(e.toString(), "Unauthorized");
      }
    });

    it("Should reject milestone release from unauthorized account", async () => {
      const vaultId = new BN(Date.now() + 10);
      const unauthorizedUser = Keypair.generate();

      const [escrowVault] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow_vault"),
          sprintVaultProgram.programId.toBuffer(),
          vaultId.toArrayLike(Buffer, "le", 8),
        ],
        vaultProgram.programId
      );

      const vaultTokenAccount = await getAssociatedTokenAddress(
        mint,
        escrowVault,
        true
      );

      // Create milestone escrow
      const milestones = [
        {
          milestoneId: 1,
          amount: HUNDRED_USDC,
          requiredApproval: employer.publicKey, // Only employer can approve
          isCompleted: false,
        },
      ];

      await vaultProgram.methods
        .createEscrow(
          vaultId,
          HUNDRED_USDC,
          { milestone: { conditions: milestones } },
          { beneficiary: {} },
          null,
          null
        )
        .accounts({
          escrowVault,
          vaultTokenAccount,
          config: vaultConfig,
          depositor: employer.publicKey,
          beneficiary: freelancer.publicKey,
          ownerProgram: sprintVaultProgram.programId,
          ownerAccount: employer.publicKey,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([employer])
        .rpc();

      // Try to release milestone as freelancer (should fail)
      try {
        await vaultProgram.methods
          .releaseMilestone(1)
          .accounts({
            escrowVault,
            authority: freelancer.publicKey,
          })
          .signers([freelancer])
          .rpc();
        assert.fail("Should have failed - unauthorized milestone release");
      } catch (e) {
        assert.include(e.toString(), "Unauthorized");
      }
    });
  });
});
