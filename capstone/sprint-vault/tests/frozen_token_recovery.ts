import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SprintVault } from "../target/types/sprint_vault";
import { 
    Keypair, 
    SystemProgram, 
    PublicKey,
    LAMPORTS_PER_SOL,
    Transaction,
    sendAndConfirmTransaction
} from "@solana/web3.js";
import {
    createMint,
    createAccount,
    mintTo,
    getAccount,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    freezeAccount,
    thawAccount,
    closeAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { 
    setupTest, 
    SUPPORTED_MINTS,
    createTestMint,
    fundAccount 
} from "./test-helpers";

describe("Frozen Token Account Recovery Tests", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.SprintVault as Program<SprintVault>;
    
    let employer: Keypair;
    let freelancer: Keypair;
    let mint: PublicKey;
    let mintAuthority: Keypair;
    let freezeAuthority: Keypair;
    let employerTokenAccount: PublicKey;
    let freelancerTokenAccount: PublicKey;
    let sprintPda: PublicKey;
    let vaultTokenAccount: PublicKey;
    
    const DECIMALS = 6;
    const USDC_AMOUNT = (amount: number) => new BN(amount * Math.pow(10, DECIMALS));
    
    beforeEach(async () => {
        employer = Keypair.generate();
        freelancer = Keypair.generate();
        mintAuthority = Keypair.generate();
        freezeAuthority = Keypair.generate();
        
        // Airdrop SOL for transaction fees
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(employer.publicKey, 10 * LAMPORTS_PER_SOL)
        );
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(freelancer.publicKey, 10 * LAMPORTS_PER_SOL)
        );
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(freezeAuthority.publicKey, 2 * LAMPORTS_PER_SOL)
        );
        
        // Create a test mint with freeze authority
        mint = await createMint(
            provider.connection,
            employer,
            mintAuthority.publicKey,
            freezeAuthority.publicKey, // Freeze authority
            DECIMALS
        );
        
        // Create token accounts
        employerTokenAccount = await createAccount(
            provider.connection,
            employer,
            mint,
            employer.publicKey
        );
        
        freelancerTokenAccount = await createAccount(
            provider.connection,
            freelancer,
            mint,
            freelancer.publicKey
        );
        
        // Mint tokens to employer
        await mintTo(
            provider.connection,
            mintAuthority,
            mint,
            employerTokenAccount,
            mintAuthority,
            1000 * Math.pow(10, DECIMALS)
        );
    });
    
    describe("Frozen Account Detection", () => {
        it("Should reject withdrawal to a frozen freelancer account", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime - 100); // Started 100 seconds ago
            const totalAmount = USDC_AMOUNT(100);
            
            // Calculate sprint duration (7 days)
            const duration = { oneWeek: {} };
            
            // Find PDA
            [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            
            // Create sprint
            await program.methods
                .createSprint(
                    sprintId,
                    freelancer.publicKey,
                    startTime,
                    duration,
                    totalAmount,
                    { linear: {} } // Acceleration type
                )
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                    vault: vaultTokenAccount,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([employer])
                .rpc();
            
            // Fund the sprint
            await program.methods
                .depositToEscrow(totalAmount)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount: employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            // FREEZE the freelancer's token account
            await freezeAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            
            // Verify the account is frozen
            const accountInfo = await getAccount(provider.connection, freelancerTokenAccount);
            expect(accountInfo.isFrozen).to.be.true;
            
            // Attempt to withdraw - should fail with FrozenTokenAccount error
            try {
                await program.methods
                    .withdrawStreamed()
                    .accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        freelancerTokenAccount: freelancerTokenAccount,
                        freelancer: freelancer.publicKey,
                        mint: mint,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([freelancer])
                    .rpc();
                
                expect.fail("Should have thrown FrozenTokenAccount error");
            } catch (error) {
                expect(error.toString()).to.include("FrozenTokenAccount");
            }
        });
        
        it("Should allow withdrawal after account is thawed", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime - 100); // Started 100 seconds ago
            const totalAmount = USDC_AMOUNT(100);
            
            // Calculate sprint duration (7 days)
            const duration = { oneWeek: {} };
            
            // Find PDA
            [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            
            // Create sprint
            await program.methods
                .createSprint(
                    sprintId,
                    freelancer.publicKey,
                    startTime,
                    duration,
                    totalAmount,
                    { linear: {} }
                )
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                    vault: vaultTokenAccount,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([employer])
                .rpc();
            
            // Fund the sprint
            await program.methods
                .depositToEscrow(totalAmount)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount: employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            // FREEZE the freelancer's token account
            await freezeAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            
            // Verify frozen
            let accountInfo = await getAccount(provider.connection, freelancerTokenAccount);
            expect(accountInfo.isFrozen).to.be.true;
            
            // Attempt withdrawal while frozen - should fail
            try {
                await program.methods
                    .withdrawStreamed()
                    .accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        freelancerTokenAccount: freelancerTokenAccount,
                        freelancer: freelancer.publicKey,
                        mint: mint,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([freelancer])
                    .rpc();
                
                expect.fail("Should have thrown FrozenTokenAccount error");
            } catch (error) {
                expect(error.toString()).to.include("FrozenTokenAccount");
            }
            
            // THAW the account
            await thawAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            
            // Verify thawed
            accountInfo = await getAccount(provider.connection, freelancerTokenAccount);
            expect(accountInfo.isFrozen).to.be.false;
            
            // Now withdrawal should succeed
            const balanceBefore = accountInfo.amount;
            
            await program.methods
                .withdrawStreamed()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount: freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            
            // Verify tokens were received
            const accountAfter = await getAccount(provider.connection, freelancerTokenAccount);
            expect(Number(accountAfter.amount)).to.be.greaterThan(Number(balanceBefore));
        });
        
        it("Should detect frozen vault account and prevent deposits", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 100); // Starts in 100 seconds
            const totalAmount = USDC_AMOUNT(100);
            
            // Calculate sprint duration (7 days)
            const duration = { oneWeek: {} };
            
            // Find PDA
            [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            
            // Create sprint
            await program.methods
                .createSprint(
                    sprintId,
                    freelancer.publicKey,
                    startTime,
                    duration,
                    totalAmount,
                    { linear: {} }
                )
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                    vault: vaultTokenAccount,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([employer])
                .rpc();
            
            // Somehow freeze the vault account (in reality this shouldn't happen)
            // This tests our defensive programming
            await freezeAccount(
                provider.connection,
                freezeAuthority,
                vaultTokenAccount,
                mint,
                freezeAuthority
            );
            
            // Attempt to deposit - should fail with FrozenTokenAccount error
            try {
                await program.methods
                    .depositToEscrow(totalAmount)
                    .accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        employerTokenAccount: employerTokenAccount,
                        employer: employer.publicKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([employer])
                    .rpc();
                
                expect.fail("Should have thrown FrozenTokenAccount error");
            } catch (error) {
                expect(error.toString()).to.include("FrozenTokenAccount");
            }
        });
    });
    
    describe("Recovery Scenarios", () => {
        it("Should preserve funds in vault when freelancer account is frozen", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime - 100);
            const totalAmount = USDC_AMOUNT(100);
            
            const duration = { oneWeek: {} };
            
            [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            
            // Create and fund sprint
            await program.methods
                .createSprint(
                    sprintId,
                    freelancer.publicKey,
                    startTime,
                    duration,
                    totalAmount,
                    { linear: {} }
                )
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                    vault: vaultTokenAccount,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([employer])
                .rpc();
            
            await program.methods
                .depositToEscrow(totalAmount)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount: employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            // Check vault balance
            const vaultBefore = await getAccount(provider.connection, vaultTokenAccount);
            expect(Number(vaultBefore.amount)).to.equal(100 * Math.pow(10, DECIMALS));
            
            // Freeze freelancer account
            await freezeAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            
            // Try to withdraw (should fail)
            try {
                await program.methods
                    .withdrawStreamed()
                    .accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        freelancerTokenAccount: freelancerTokenAccount,
                        freelancer: freelancer.publicKey,
                        mint: mint,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([freelancer])
                    .rpc();
            } catch (error) {
                // Expected to fail
            }
            
            // Verify funds are still in vault
            const vaultAfter = await getAccount(provider.connection, vaultTokenAccount);
            expect(Number(vaultAfter.amount)).to.equal(Number(vaultBefore.amount));
            
            // Thaw and verify funds can be withdrawn
            await thawAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            
            // Now withdraw should work
            await program.methods
                .withdrawStreamed()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount: freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            
            // Verify withdrawal succeeded
            const freelancerAccount = await getAccount(provider.connection, freelancerTokenAccount);
            expect(Number(freelancerAccount.amount)).to.be.greaterThan(0);
        });
        
        it("Should handle multiple freeze/thaw cycles correctly", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime - 100);
            const totalAmount = USDC_AMOUNT(100);
            
            const duration = { oneWeek: {} };
            
            [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            
            // Create and fund sprint
            await program.methods
                .createSprint(
                    sprintId,
                    freelancer.publicKey,
                    startTime,
                    duration,
                    totalAmount,
                    { linear: {} }
                )
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                    vault: vaultTokenAccount,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([employer])
                .rpc();
            
            await program.methods
                .depositToEscrow(totalAmount)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount: employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            let totalWithdrawn = 0;
            
            // Cycle 1: Thawed → Withdraw
            await program.methods
                .withdrawStreamed()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount: freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            
            let account = await getAccount(provider.connection, freelancerTokenAccount);
            totalWithdrawn = Number(account.amount);
            expect(totalWithdrawn).to.be.greaterThan(0);
            
            // Cycle 2: Freeze → Fail → Thaw → Succeed
            await freezeAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            
            // Should fail while frozen
            try {
                await program.methods
                    .withdrawStreamed()
                    .accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        freelancerTokenAccount: freelancerTokenAccount,
                        freelancer: freelancer.publicKey,
                        mint: mint,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([freelancer])
                    .rpc();
                expect.fail("Should have failed");
            } catch (error) {
                expect(error.toString()).to.include("FrozenTokenAccount");
            }
            
            // Thaw
            await thawAccount(
                provider.connection,
                freezeAuthority,
                freelancerTokenAccount,
                mint,
                freezeAuthority
            );
            
            // Wait a bit to accumulate more funds
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Should succeed after thaw
            await program.methods
                .withdrawStreamed()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount: freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            
            account = await getAccount(provider.connection, freelancerTokenAccount);
            expect(Number(account.amount)).to.be.greaterThan(totalWithdrawn);
        });
    });
    
    describe("Edge Cases", () => {
        it("Should handle frozen employer account correctly during deposit", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 100);
            const totalAmount = USDC_AMOUNT(100);
            
            const duration = { oneWeek: {} };
            
            [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            
            // Create sprint
            await program.methods
                .createSprint(
                    sprintId,
                    freelancer.publicKey,
                    startTime,
                    duration,
                    totalAmount,
                    { linear: {} }
                )
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                    vault: vaultTokenAccount,
                    mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([employer])
                .rpc();
            
            // Freeze employer's token account
            await freezeAccount(
                provider.connection,
                freezeAuthority,
                employerTokenAccount,
                mint,
                freezeAuthority
            );
            
            // Attempt to deposit - should fail
            try {
                await program.methods
                    .depositToEscrow(totalAmount)
                    .accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        employerTokenAccount: employerTokenAccount,
                        employer: employer.publicKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([employer])
                    .rpc();
                
                expect.fail("Should have thrown FrozenTokenAccount error");
            } catch (error) {
                expect(error.toString()).to.include("FrozenTokenAccount");
            }
        });
    });
});
