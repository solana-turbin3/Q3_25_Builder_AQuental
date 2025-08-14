import * as anchor from "@coral-xyz/anchor";
import { SprintDuration, AccelerationType, toDurationObject, toAccelerationObject } from "./helpers";
import { Program, BN } from "@coral-xyz/anchor";
import { SprintVault } from "../target/types/sprint_vault";
import { 
    Keypair, 
    SystemProgram, 
    PublicKey,
    LAMPORTS_PER_SOL 
} from "@solana/web3.js";
import {
    createMint,
    createAccount,
    mintTo,
    getAccount,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
} from "@solana/spl-token";
import { expect } from "chai";

describe("Sprint Vault - New Directives Tests", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.SprintVault as Program<SprintVault>;
    
    let employer: Keypair;
    let freelancer: Keypair;
    let mint: PublicKey;
    let employerTokenAccount: PublicKey;
    let freelancerTokenAccount: PublicKey;
    
    const DECIMALS = 6;
    const USDC_AMOUNT = (amount: number) => new BN(amount * Math.pow(10, DECIMALS));
    const MIN_WITHDRAWAL = USDC_AMOUNT(10); // 10 USDC minimum
    const MAX_PAUSE_RESUME_COUNT = 3;
    
    beforeEach(async () => {
        employer = Keypair.generate();
        freelancer = Keypair.generate();
        
        // Airdrop SOL
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(employer.publicKey, 10 * LAMPORTS_PER_SOL)
        );
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(freelancer.publicKey, 10 * LAMPORTS_PER_SOL)
        );
        
        // Create mint and token accounts
        mint = await createMint(
            provider.connection,
            employer,
            employer.publicKey,
            null,
            DECIMALS
        );
        
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
            employer,
            mint,
            employerTokenAccount,
            employer,
            1000 * Math.pow(10, DECIMALS)
        );
    });
    
    describe("Pause/Resume Limit Tests", () => {
        it("Should allow up to 3 pause/resume cycles", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 5);
            const endTime = new BN(currentTime + 100);
            const totalAmount = USDC_AMOUNT(100);
            
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            const vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            
            // Create and fund sprint
            await program.methods
                .createSprint(sprintId, startTime, endTime, totalAmount, null)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employer: employer.publicKey,
                    freelancer: freelancer.publicKey,
                    mint,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            await program.methods
                .fundSprint()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            // Wait for sprint to start
            await new Promise(resolve => setTimeout(resolve, 6000));
            
            // Perform 3 pause/resume cycles
            for (let i = 0; i < MAX_PAUSE_RESUME_COUNT; i++) {
                // Pause
                await program.methods
                    .pauseStream()
                    .accounts({
                        sprint: sprintPda,
                        employer: employer.publicKey,
                    })
                    .signers([employer])
                    .rpc();
                
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Resume
                await program.methods
                    .resumeStream()
                    .accounts({
                        sprint: sprintPda,
                        employer: employer.publicKey,
                    })
                    .signers([employer])
                    .rpc();
                
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Fourth pause should fail
            try {
                await program.methods
                    .pauseStream()
                    .accounts({
                        sprint: sprintPda,
                        employer: employer.publicKey,
                    })
                    .signers([employer])
                    .rpc();
                expect.fail("Should have failed with MaxPauseResumeExceeded");
            } catch (error) {
                expect(error.toString()).to.include("MaxPauseResumeExceeded");
            }
        });
    });
    
    describe("Auto-Close Tests", () => {
        it("Should auto-close sprint if pause duration exceeds sprint duration", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 2);
            const endTime = new BN(currentTime + 10); // 8 second sprint
            const totalAmount = USDC_AMOUNT(100);
            
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            const vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            
            // Create and fund sprint
            await program.methods
                .createSprint(sprintId, startTime, endTime, totalAmount, null)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employer: employer.publicKey,
                    freelancer: freelancer.publicKey,
                    mint,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            await program.methods
                .fundSprint()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            // Wait for sprint to start
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Pause sprint
            await program.methods
                .pauseStream()
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                })
                .signers([employer])
                .rpc();
            
            // Wait longer than sprint duration (9 seconds > 8 second sprint)
            await new Promise(resolve => setTimeout(resolve, 9000));
            
            // Try to resume - should fail with auto-close error
            try {
                await program.methods
                    .resumeStream()
                    .accounts({
                        sprint: sprintPda,
                        employer: employer.publicKey,
                    })
                    .signers([employer])
                    .rpc();
                expect.fail("Should have failed with SprintAutoClosedDueToExcessivePause");
            } catch (error) {
                expect(error.toString()).to.include("SprintAutoClosedDueToExcessivePause");
            }
            
            // Freelancer should be able to withdraw all available funds
            await program.methods
                .withdrawStreamed().accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
          mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
        });
    });
    
    describe("Minimum Withdrawal Special Cases", () => {
        it("Should allow withdrawal of small sprint total at the end", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 2);
            const endTime = new BN(currentTime + 5);
            const totalAmount = USDC_AMOUNT(5); // Less than 10 USDC minimum
            
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            const vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            
            // Create and fund sprint
            await program.methods
                .createSprint(sprintId, startTime, endTime, totalAmount, null)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employer: employer.publicKey,
                    freelancer: freelancer.publicKey,
                    mint,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            await program.methods
                .fundSprint()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            // Wait until sprint is halfway
            await new Promise(resolve => setTimeout(resolve, 3500));
            
            // Try to withdraw before end - should fail
            try {
                await program.methods
                    .withdrawStreamed().accounts({
                        sprint: sprintPda,
                        vault: vaultTokenAccount,
                        freelancerTokenAccount,
                        freelancer: freelancer.publicKey,
          mint: mint,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([freelancer])
                    .rpc();
                expect.fail("Should have failed - small sprint can only withdraw at end");
            } catch (error) {
                expect(error.toString()).to.include("BelowMinimumWithdrawal");
            }
            
            // Wait for sprint to end
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Now withdrawal should succeed
            await program.methods
                .withdrawStreamed().accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
          mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            
            const freelancerAccount = await getAccount(
                provider.connection,
                freelancerTokenAccount
            );
            expect(Number(freelancerAccount.amount)).to.equal(totalAmount.toNumber());
        });
        
        it("Should allow final withdrawal regardless of minimum", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 2);
            const endTime = new BN(currentTime + 10);
            const totalAmount = USDC_AMOUNT(15); // 15 USDC, so final withdrawal might be < 10
            
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            const vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            
            // Create and fund sprint
            await program.methods
                .createSprint(sprintId, startTime, endTime, totalAmount, null)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employer: employer.publicKey,
                    freelancer: freelancer.publicKey,
                    mint,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            await program.methods
                .fundSprint()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            // Wait until we can withdraw more than minimum
            await new Promise(resolve => setTimeout(resolve, 7000));
            
            // First withdrawal (should be >= 10 USDC)
            await program.methods
                .withdrawStreamed().accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
          mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            
            // Wait for sprint to end
            await new Promise(resolve => setTimeout(resolve, 4000));
            
            // Final withdrawal (might be < 10 USDC, but should succeed)
            await program.methods
                .withdrawStreamed().accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
          mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
            
            const freelancerAccount = await getAccount(
                provider.connection,
                freelancerTokenAccount
            );
            
            // Should have withdrawn all funds
            expect(Number(freelancerAccount.amount)).to.equal(totalAmount.toNumber());
        });
    });
    
    describe("Edge Case: Pause at Sprint End", () => {
        it("Should handle pause attempt exactly at sprint end time", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 2);
            const endTime = new BN(currentTime + 5);
            const totalAmount = USDC_AMOUNT(100);
            
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            const vaultTokenAccount = await getAssociatedTokenAddress(
                mint,
                sprintPda,
                true
            );
            
            // Create and fund sprint
            await program.methods
                .createSprint(sprintId, startTime, endTime, totalAmount, null)
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employer: employer.publicKey,
                    freelancer: freelancer.publicKey,
                    mint,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            await program.methods
                .fundSprint()
                .accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    employerTokenAccount,
                    employer: employer.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([employer])
                .rpc();
            
            // Wait exactly until sprint end time
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Attempt to pause at end time - should succeed as sprint is technically still active
            await program.methods
                .pauseStream()
                .accounts({
                    sprint: sprintPda,
                    employer: employer.publicKey,
                })
                .signers([employer])
                .rpc();
            
            // But freelancer should still be able to withdraw all funds
            await program.methods
                .withdrawStreamed().accounts({
                    sprint: sprintPda,
                    vault: vaultTokenAccount,
                    freelancerTokenAccount,
                    freelancer: freelancer.publicKey,
          mint: mint,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([freelancer])
                .rpc();
        });
    });
});
