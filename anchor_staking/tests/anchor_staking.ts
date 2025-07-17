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

describe("staking", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.staking as Program<Staking>;

  let rewardMint: anchor.web3.PublicKey;
  let rewardVault: anchor.web3.PublicKey;
  let userToken: anchor.web3.PublicKey;
  let pool: anchor.web3.PublicKey;
  let userStake: anchor.web3.PublicKey;

  before(async () => {
    // create reward token
    rewardMint = await createMint(provider.connection, provider.wallet.payer, provider.wallet.publicKey, null, 6);
    [pool] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("pool")], program.programId);
    [rewardVault] = await anchor.web3.PublicKey.findProgramAddress([Buffer.from("reward_vault")], program.programId);
    userToken = await createAccount(provider.connection, provider.wallet.payer, rewardMint, provider.wallet.publicKey);
    await mintTo(provider.connection, provider.wallet.payer, rewardMint, userToken, provider.wallet.payer, 100_000_000);
  });

  it("Initializes pool", async () => {
    await program.methods
      .initialize(
        new BN(1), // 1 lamport per token per second
        Buffer.from("pool"), // pool seed
        Buffer.from("reward_vault") // reward vault seed
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
  });

  it("Creates user stake account", async () => {
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

  it("Stakes tokens", async () => {
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
  });

  it("Claims rewards", async () => {
    await new Promise((r) => setTimeout(r, 2_000)); // wait 2 s
    const userTokenBefore = await getAccount(provider.connection, userToken);
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
    expect(userTokenAfter.amount > userTokenBefore.amount).true;
  });

  it("Unstakes everything", async () => {
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
    const poolAcc = await program.account.stakePool.fetch(pool);
    expect(poolAcc.totalStaked.toNumber()).eq(0);
  });
});
