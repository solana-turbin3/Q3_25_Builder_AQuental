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

describe.skip("Multi-User Staking", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.staking as Program<Staking>;

  let rewardMint: anchor.web3.PublicKey;
  let rewardVault: anchor.web3.PublicKey;
  let pool: anchor.web3.PublicKey;

  // User 1 (main wallet)
  let user1Token: anchor.web3.PublicKey;
  let user1Stake: anchor.web3.PublicKey;

  // User 2 (new keypair)
  let user2: anchor.web3.Keypair;
  let user2Token: anchor.web3.PublicKey;
  let user2Stake: anchor.web3.PublicKey;

  // User 3 (new keypair)
  let user3: anchor.web3.Keypair;
  let user3Token: anchor.web3.PublicKey;
  let user3Stake: anchor.web3.PublicKey;

  before(async () => {
    // Create additional users
    user2 = anchor.web3.Keypair.generate();
    user3 = anchor.web3.Keypair.generate();

    // Airdrop SOL to new users
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user2.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user3.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL)
    );

    // Create reward token
    rewardMint = await createMint(provider.connection, provider.wallet.payer, provider.wallet.publicKey, null, 6);
    [pool] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("pool_multi")], program.programId);
    [rewardVault] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("reward_vault_multi")], program.programId);

    // Create token accounts for all users
    user1Token = await createAccount(provider.connection, provider.wallet.payer, rewardMint, provider.wallet.publicKey);
    user2Token = await createAccount(provider.connection, provider.wallet.payer, rewardMint, user2.publicKey);
    user3Token = await createAccount(provider.connection, provider.wallet.payer, rewardMint, user3.publicKey);

    // Mint tokens to all users
    await mintTo(provider.connection, provider.wallet.payer, rewardMint, user1Token, provider.wallet.payer, 100_000_000);
    await mintTo(provider.connection, provider.wallet.payer, rewardMint, user2Token, provider.wallet.payer, 100_000_000);
    await mintTo(provider.connection, provider.wallet.payer, rewardMint, user3Token, provider.wallet.payer, 100_000_000);

    // Initialize pool
    await program.methods
      .initialize(
        new BN(1),
        Buffer.from("pool_multi"),
        Buffer.from("reward_vault_multi")
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
    await mintTo(provider.connection, provider.wallet.payer, rewardMint, rewardVault, provider.wallet.payer, 50_000_000_000);

    // Create user stake accounts
    [user1Stake] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("user"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
    [user2Stake] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("user"), user2.publicKey.toBuffer()],
      program.programId
    );
    [user3Stake] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("user"), user3.publicKey.toBuffer()],
      program.programId
    );
  });

  it("Initializes user stake accounts for all users", async () => {
    // User 1
    await program.methods
      .initUser()
      .accounts({
        userStake: user1Stake,
        user: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // User 2
    await program.methods
      .initUser()
      .accounts({
        userStake: user2Stake,
        user: user2.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    // User 3
    await program.methods
      .initUser()
      .accounts({
        userStake: user3Stake,
        user: user3.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user3])
      .rpc();

    // Verify all user stake accounts exist
    const user1StakeAcc = await program.account.userStake.fetch(user1Stake);
    const user2StakeAcc = await program.account.userStake.fetch(user2Stake);
    const user3StakeAcc = await program.account.userStake.fetch(user3Stake);

    expect(user1StakeAcc.stakedAmount.toNumber()).eq(0);
    expect(user2StakeAcc.stakedAmount.toNumber()).eq(0);
    expect(user3StakeAcc.stakedAmount.toNumber()).eq(0);
  });

  it("Multiple users stake different amounts", async () => {
    // User 1 stakes 1M tokens
    await program.methods
      .stake(new BN(1_000_000))
      .accounts({
        pool,
        userStake: user1Stake,
        userToken: user1Token,
        vault: rewardVault,
        rewardMint,
        user: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    // User 2 stakes 2M tokens
    await program.methods
      .stake(new BN(2_000_000))
      .accounts({
        pool,
        userStake: user2Stake,
        userToken: user2Token,
        vault: rewardVault,
        rewardMint,
        user: user2.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();

    // User 3 stakes 3M tokens
    await program.methods
      .stake(new BN(3_000_000))
      .accounts({
        pool,
        userStake: user3Stake,
        userToken: user3Token,
        vault: rewardVault,
        rewardMint,
        user: user3.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([user3])
      .rpc();

    // Verify pool state
    const poolAcc = await program.account.stakePool.fetch(pool);
    expect(poolAcc.totalStaked.toNumber()).eq(6_000_000); // 1M + 2M + 3M

    // Verify individual user stakes
    const user1StakeAcc = await program.account.userStake.fetch(user1Stake);
    const user2StakeAcc = await program.account.userStake.fetch(user2Stake);
    const user3StakeAcc = await program.account.userStake.fetch(user3Stake);

    expect(user1StakeAcc.stakedAmount.toNumber()).eq(1_000_000);
    expect(user2StakeAcc.stakedAmount.toNumber()).eq(2_000_000);
    expect(user3StakeAcc.stakedAmount.toNumber()).eq(3_000_000);
  });

  it("Multiple users claim rewards proportionally", async () => {
    // Wait for rewards to accrue
    await new Promise((r) => setTimeout(r, 3_000));

    // Get token balances before claiming
    const user1TokenBefore = await getAccount(provider.connection, user1Token);
    const user2TokenBefore = await getAccount(provider.connection, user2Token);
    const user3TokenBefore = await getAccount(provider.connection, user3Token);

    // All users claim rewards
    await program.methods
      .claim()
      .accounts({
        pool,
        userStake: user1Stake,
        userToken: user1Token,
        vault: rewardVault,
        rewardMint,
        user: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    await program.methods
      .claim()
      .accounts({
        pool,
        userStake: user2Stake,
        userToken: user2Token,
        vault: rewardVault,
        rewardMint,
        user: user2.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();

    await program.methods
      .claim()
      .accounts({
        pool,
        userStake: user3Stake,
        userToken: user3Token,
        vault: rewardVault,
        rewardMint,
        user: user3.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([user3])
      .rpc();

    // Get token balances after claiming
    const user1TokenAfter = await getAccount(provider.connection, user1Token);
    const user2TokenAfter = await getAccount(provider.connection, user2Token);
    const user3TokenAfter = await getAccount(provider.connection, user3Token);

    // Calculate rewards
    const user1Rewards = user1TokenAfter.amount - user1TokenBefore.amount;
    const user2Rewards = user2TokenAfter.amount - user2TokenBefore.amount;
    const user3Rewards = user3TokenAfter.amount - user3TokenBefore.amount;

    // Verify rewards are proportional to stake (user3 > user2 > user1)
    expect(user3Rewards).to.be.greaterThan(user2Rewards);
    expect(user2Rewards).to.be.greaterThan(user1Rewards);

    // Verify all users got some rewards
    expect(user1Rewards).to.be.greaterThan(0n);
    expect(user2Rewards).to.be.greaterThan(0n);
    expect(user3Rewards).to.be.greaterThan(0n);
  });

  it("One user unstakes while others remain", async () => {
    // User 2 unstakes
    await program.methods
      .unstake()
      .accounts({
        pool,
        userStake: user2Stake,
        userToken: user2Token,
        vault: rewardVault,
        rewardMint,
        user: user2.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([user2])
      .rpc();

    // Verify pool state
    const poolAcc = await program.account.stakePool.fetch(pool);
    expect(poolAcc.totalStaked.toNumber()).eq(4_000_000); // 6M - 2M

    // Verify user 2 has no stake
    const user2StakeAcc = await program.account.userStake.fetch(user2Stake);
    expect(user2StakeAcc.stakedAmount.toNumber()).eq(0);

    // Verify other users still have stake
    const user1StakeAcc = await program.account.userStake.fetch(user1Stake);
    const user3StakeAcc = await program.account.userStake.fetch(user3Stake);
    expect(user1StakeAcc.stakedAmount.toNumber()).eq(1_000_000);
    expect(user3StakeAcc.stakedAmount.toNumber()).eq(3_000_000);
  });

  it("Remaining users can still claim and unstake", async () => {
    // Wait for more rewards
    await new Promise((r) => setTimeout(r, 2_000));

    // User 1 and 3 claim rewards
    const user1TokenBefore = await getAccount(provider.connection, user1Token);
    const user3TokenBefore = await getAccount(provider.connection, user3Token);

    await program.methods
      .claim()
      .accounts({
        pool,
        userStake: user1Stake,
        userToken: user1Token,
        vault: rewardVault,
        rewardMint,
        user: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    await program.methods
      .claim()
      .accounts({
        pool,
        userStake: user3Stake,
        userToken: user3Token,
        vault: rewardVault,
        rewardMint,
        user: user3.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([user3])
      .rpc();

    const user1TokenAfter = await getAccount(provider.connection, user1Token);
    const user3TokenAfter = await getAccount(provider.connection, user3Token);

    // Verify rewards were claimed
    expect(user1TokenAfter.amount).to.be.greaterThan(user1TokenBefore.amount);
    expect(user3TokenAfter.amount).to.be.greaterThan(user3TokenBefore.amount);

    // Finally, remaining users unstake
    await program.methods
      .unstake()
      .accounts({
        pool,
        userStake: user1Stake,
        userToken: user1Token,
        vault: rewardVault,
        rewardMint,
        user: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    await program.methods
      .unstake()
      .accounts({
        pool,
        userStake: user3Stake,
        userToken: user3Token,
        vault: rewardVault,
        rewardMint,
        user: user3.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([user3])
      .rpc();

    // Verify pool is empty
    const poolAcc = await program.account.stakePool.fetch(pool);
    expect(poolAcc.totalStaked.toNumber()).eq(0);
  });
});
