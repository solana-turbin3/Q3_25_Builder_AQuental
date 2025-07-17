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

describe.skip("Advanced Staking Scenarios", () => {
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
    [pool] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("pool_advanced")], program.programId);
    [rewardVault] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("reward_vault_advanced")], program.programId);
    userToken = await createAccount(provider.connection, provider.wallet.payer, rewardMint, provider.wallet.publicKey);
    await mintTo(provider.connection, provider.wallet.payer, rewardMint, userToken, provider.wallet.payer, 100_000_000);

    // Initialize pool
    await program.methods
      .initialize(
        new BN(10), // Lower reward rate for testing
        Buffer.from("pool_advanced"),
        Buffer.from("reward_vault_advanced")
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
    await mintTo(provider.connection, provider.wallet.payer, rewardMint, rewardVault, provider.wallet.payer, 100_000_000_000);

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

  it("Tests multiple stake operations", async () => {
    // Initial stake
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

    let userStakeAcc = await program.account.userStake.fetch(userStake);
    expect(userStakeAcc.stakedAmount.toNumber()).eq(1_000_000);

    // Wait and stake more
    await new Promise((r) => setTimeout(r, 1_000));
    
    await program.methods
      .stake(new BN(500_000))
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

    userStakeAcc = await program.account.userStake.fetch(userStake);
    expect(userStakeAcc.stakedAmount.toNumber()).eq(1_500_000);

    // Verify pool state
    const poolAcc = await program.account.stakePool.fetch(pool);
    expect(poolAcc.totalStaked.toNumber()).eq(1_500_000);
  });

  it("Tests claim rewards multiple times", async () => {
    // Wait for rewards to accumulate
    await new Promise((r) => setTimeout(r, 2_000));

    const userTokenBefore = await getAccount(provider.connection, userToken);
    
    // First claim
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

    const userTokenAfter1 = await getAccount(provider.connection, userToken);
    const firstClaimRewards = userTokenAfter1.amount - userTokenBefore.amount;
    expect(firstClaimRewards).to.be.greaterThan(0n);

    // Wait and claim again
    await new Promise((r) => setTimeout(r, 1_000));
    
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

    const userTokenAfter2 = await getAccount(provider.connection, userToken);
    const secondClaimRewards = userTokenAfter2.amount - userTokenAfter1.amount;
    expect(secondClaimRewards).to.be.greaterThan(0n);
  });

  it("Tests long-term reward accrual", async () => {
    // Record initial state
    const userTokenBefore = await getAccount(provider.connection, userToken);
    
    // Wait for a longer period
    await new Promise((r) => setTimeout(r, 5_000));

    // Claim rewards
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

    const userTokenAfter = await getAccount(provider.connection, userToken);
    const longTermRewards = userTokenAfter.amount - userTokenBefore.amount;
    
    // Should have accumulated significant rewards over 5 seconds
    expect(longTermRewards).to.be.greaterThan(1000n);
  });

  it("Tests reward calculation accuracy", async () => {
    // Get current user stake info
    const userStakeAcc = await program.account.userStake.fetch(userStake);
    const poolAcc = await program.account.stakePool.fetch(pool);
    
    console.log("Staked amount:", userStakeAcc.stakedAmount.toString());
    console.log("Reward per second:", poolAcc.rewardPerSecond.toString());
    console.log("Last update:", userStakeAcc.lastUpdate.toString());
    
    // Record time and balance
    const beforeTime = Date.now();
    const userTokenBefore = await getAccount(provider.connection, userToken);
    
    // Wait exactly 1 second
    await new Promise((r) => setTimeout(r, 1_000));
    
    // Claim rewards
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
    
    const afterTime = Date.now();
    const userTokenAfter = await getAccount(provider.connection, userToken);
    const actualRewards = userTokenAfter.amount - userTokenBefore.amount;
    
    // Calculate expected rewards (staked_amount * reward_per_second * elapsed_time)
    const elapsedSeconds = (afterTime - beforeTime) / 1000;
    const expectedRewards = userStakeAcc.stakedAmount.toNumber() * poolAcc.rewardPerSecond.toNumber() * elapsedSeconds;
    
    console.log("Elapsed seconds:", elapsedSeconds);
    console.log("Expected rewards:", expectedRewards);
    console.log("Actual rewards:", actualRewards.toString());
    
    // Should be reasonably close (within 10% due to timing variations)
    expect(Number(actualRewards)).to.be.closeTo(expectedRewards, expectedRewards * 0.1);
  });

  it("Tests state consistency after operations", async () => {
    // Record initial state
    const initialUserStake = await program.account.userStake.fetch(userStake);
    const initialPool = await program.account.stakePool.fetch(pool);
    const initialUserToken = await getAccount(provider.connection, userToken);
    
    // Perform multiple operations
    await program.methods
      .stake(new BN(100_000))
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
    
    await new Promise((r) => setTimeout(r, 1_000));
    
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
    
    // Verify state consistency
    const finalUserStake = await program.account.userStake.fetch(userStake);
    const finalPool = await program.account.stakePool.fetch(pool);
    const finalUserToken = await getAccount(provider.connection, userToken);
    
    // User stake should have increased
    expect(finalUserStake.stakedAmount.toNumber()).to.be.greaterThan(initialUserStake.stakedAmount.toNumber());
    
    // Pool total should have increased
    expect(finalPool.totalStaked.toNumber()).to.be.greaterThan(initialPool.totalStaked.toNumber());
    
    // User should have received rewards
    expect(finalUserToken.amount).to.be.greaterThan(initialUserToken.amount);
    
    // User stake's reward debt should be 0 after claim
    expect(finalUserStake.rewardDebt.toNumber()).eq(0);
  });

  it("Tests complete cycle: stake -> claim -> unstake", async () => {
    // Record initial token balance
    const initialUserToken = await getAccount(provider.connection, userToken);
    const initialStakedAmount = 200_000;
    
    // Stake tokens
    await program.methods
      .stake(new BN(initialStakedAmount))
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
    
    // Wait for rewards
    await new Promise((r) => setTimeout(r, 2_000));
    
    // Claim rewards
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
    
    const afterClaimToken = await getAccount(provider.connection, userToken);
    
    // Wait for more rewards
    await new Promise((r) => setTimeout(r, 1_000));
    
    // Unstake everything
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
    
    const finalUserToken = await getAccount(provider.connection, userToken);
    const finalUserStake = await program.account.userStake.fetch(userStake);
    const finalPool = await program.account.stakePool.fetch(pool);
    
    // Should have more tokens than initially (principal + rewards)
    expect(finalUserToken.amount).to.be.greaterThan(initialUserToken.amount);
    
    // Should have received rewards from both claim and unstake
    expect(finalUserToken.amount).to.be.greaterThan(afterClaimToken.amount);
    
    // User stake should be empty
    expect(finalUserStake.stakedAmount.toNumber()).eq(0);
    expect(finalUserStake.rewardDebt.toNumber()).eq(0);
    
    // Pool total should be reduced
    expect(finalPool.totalStaked.toNumber()).to.be.lessThan(1_700_000); // Should be reduced by initialStakedAmount
  });
});
