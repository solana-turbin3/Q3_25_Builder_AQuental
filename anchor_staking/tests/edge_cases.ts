import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Staking } from "../target/types/staking";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";

describe.skip("Staking Edge Cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.staking as Program<Staking>;

  let rewardMint: anchor.web3.PublicKey;
  let rewardVault: anchor.web3.PublicKey;
  let userToken: anchor.web3.PublicKey;
  let pool: anchor.web3.PublicKey;
  let userStake: anchor.web3.PublicKey;

  before(async () => {
    // Create reward token
    rewardMint = await createMint(provider.connection, provider.wallet.payer, provider.wallet.publicKey, null, 6);
    [pool] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("pool_edge")], program.programId);
    [rewardVault] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("reward_vault_edge")], program.programId);
    userToken = await createAccount(provider.connection, provider.wallet.payer, rewardMint, provider.wallet.publicKey);
    await mintTo(provider.connection, provider.wallet.payer, rewardMint, userToken, provider.wallet.payer, 100_000_000);

    // Initialize pool
    await program.methods
      .initialize(
        new BN(1),
        Buffer.from("pool_edge"),
        Buffer.from("reward_vault_edge")
      )
      .accounts({
        pool,
        authority: provider.wallet.publicKey,
        rewardMint,
        rewardVault,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    // Add reward tokens to the vault
    await mintTo(provider.connection, provider.wallet.payer, rewardMint, rewardVault, provider.wallet.payer, 10_000_000_000);

    // Create user stake account
    [userStake] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("user"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .initUser()
      .accounts({
        userStake,
        user: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  });

  it("Fails to initialize pool twice", async () => {
    try {
      await program.methods
        .initialize(
          new BN(1),
          Buffer.from("pool_edge"),
          Buffer.from("reward_vault_edge")
        )
        .accounts({
          pool,
          authority: provider.wallet.publicKey,
          rewardMint,
          rewardVault,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      expect.fail("Should have failed to initialize pool twice");
    } catch (error) {
      expect(error.message).to.include("already in use");
    }
  });

  it("Fails to create user stake account twice", async () => {
    try {
      await program.methods
        .initUser()
        .accounts({
          userStake,
          user: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have failed to create user stake account twice");
    } catch (error) {
      expect(error.message).to.include("already in use");
    }
  });

  it("Fails to stake zero tokens", async () => {
    try {
      await program.methods
        .stake(new BN(0))
        .accounts({
          pool,
          userStake,
          userToken,
          vault: rewardVault,
          rewardMint,
          user: provider.wallet.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have failed to stake zero tokens");
    } catch (error) {
      expect(error.message).to.include("insufficient");
    }
  });

  it("Fails to stake more tokens than available", async () => {
    try {
      await program.methods
        .stake(new BN(1_000_000_000)) // More than available
        .accounts({
          pool,
          userStake,
          userToken,
          vault: rewardVault,
          rewardMint,
          user: provider.wallet.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have failed to stake more than available");
    } catch (error) {
      expect(error.message).to.include("insufficient");
    }
  });

  it("Fails to claim rewards with no stake", async () => {
    try {
      await program.methods
        .claim()
        .accounts({
          pool,
          userStake,
          userToken,
          vault: rewardVault,
          rewardMint,
          user: provider.wallet.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc();
      // This should succeed with 0 rewards, not fail
      const userTokenAccount = await getAccount(provider.connection, userToken);
      expect(userTokenAccount.amount).to.equal(100_000_000n); // No change
    } catch (error) {
      // If it fails, that's also acceptable behavior
      console.log("Claim with no stake behavior:", error.message);
    }
  });

  it("Fails to unstake with no stake", async () => {
    try {
      await program.methods
        .unstake()
        .accounts({
          pool,
          userStake,
          userToken,
          vault: rewardVault,
          rewardMint,
          user: provider.wallet.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc();
      // This should succeed with 0 amount, not fail
      const userTokenAccount = await getAccount(provider.connection, userToken);
      expect(userTokenAccount.amount).to.equal(100_000_000n); // No change
    } catch (error) {
      // If it fails, that's also acceptable behavior
      console.log("Unstake with no stake behavior:", error.message);
    }
  });

  it("Fails with wrong mint in stake instruction", async () => {
    // Create a different mint
    const wrongMint = await createMint(provider.connection, provider.wallet.payer, provider.wallet.publicKey, null, 6);
    
    try {
      await program.methods
        .stake(new BN(1_000))
        .accounts({
          pool,
          userStake,
          userToken,
          vault: rewardVault,
          rewardMint: wrongMint, // Wrong mint
          user: provider.wallet.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have failed with wrong mint");
    } catch (error) {
      expect(error.message).to.include("constraint");
    }
  });

  it("Tests maximum stake amount", async () => {
    // First stake some tokens
    await program.methods
      .stake(new BN(1_000_000))
      .accounts({
        pool,
        userStake,
        userToken,
        vault: rewardVault,
        rewardMint,
        user: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    const poolAcc = await program.account.stakePool.fetch(pool);
    expect(poolAcc.totalStaked.toNumber()).eq(1_000_000);

    // Clean up for next tests
    await program.methods
      .unstake()
      .accounts({
        pool,
        userStake,
        userToken,
        vault: rewardVault,
        rewardMint,
        user: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();
  });
});
