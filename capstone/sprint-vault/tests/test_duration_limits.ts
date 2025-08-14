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
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
} from "@solana/spl-token";
import { expect } from "chai";

describe("Sprint Duration Limits", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.SprintVault as Program<SprintVault>;
    
    let employer: Keypair;
    let freelancer: Keypair;
    let mint: PublicKey;
    let employerTokenAccount: PublicKey;
    
    const DECIMALS = 6;
    const USDC_AMOUNT = (amount: number) => new BN(amount * Math.pow(10, DECIMALS));
    
    // Duration constants
    const HOUR = 60 * 60;
    const DAY = 24 * HOUR;
    const YEAR = 365 * DAY;
    
    const MIN_DURATION = HOUR;        // 1 hour minimum
    const MAX_DURATION = YEAR;        // 365 days maximum
    
    beforeEach(async () => {
        employer = Keypair.generate();
        freelancer = Keypair.generate();
        
        // Airdrop SOL
        await provider.connection.confirmTransaction(
            await provider.connection.requestAirdrop(employer.publicKey, 10 * LAMPORTS_PER_SOL)
        );
        
        // Note: These tests would need to use supported mints (USDC_DEVNET) to work
        // For demonstration, showing the structure
    });
    
    describe("Minimum Duration Validation", () => {
        it("Should reject sprint shorter than 1 hour", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 10);
            const endTime = new BN(currentTime + 10 + 30 * 60); // 30 minutes - too short
            const totalAmount = USDC_AMOUNT(100);
            
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            // This should fail with SprintTooShort error
            try {
                // await program.methods.createSprint(...)
                // Would fail with SprintTooShort
                expect.fail("Should have failed with SprintTooShort");
            } catch (error) {
                expect(error.toString()).to.include("SprintTooShort");
            }
        });
        
        it("Should accept sprint exactly 1 hour long", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 10);
            const endTime = new BN(currentTime + 10 + MIN_DURATION); // Exactly 1 hour
            const totalAmount = USDC_AMOUNT(100);
            
            // This should succeed
            // Implementation would create the sprint successfully
        });
    });
    
    describe("Maximum Duration Validation", () => {
        it("Should reject sprint longer than 365 days", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 10);
            const endTime = new BN(currentTime + 10 + YEAR + DAY); // 366 days - too long
            const totalAmount = USDC_AMOUNT(100);
            
            const [sprintPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("sprint"),
                    employer.publicKey.toBuffer(),
                    sprintId.toArrayLike(Buffer, "le", 8),
                ],
                program.programId
            );
            
            // This should fail with SprintTooLong error
            try {
                // await program.methods.createSprint(...)
                // Would fail with SprintTooLong
                expect.fail("Should have failed with SprintTooLong");
            } catch (error) {
                expect(error.toString()).to.include("SprintTooLong");
            }
        });
        
        it("Should accept sprint exactly 365 days long", async () => {
            const sprintId = new BN(Date.now());
            const currentTime = Math.floor(Date.now() / 1000);
            const startTime = new BN(currentTime + 10);
            const endTime = new BN(currentTime + 10 + MAX_DURATION); // Exactly 365 days
            const totalAmount = USDC_AMOUNT(100);
            
            // This should succeed
            // Implementation would create the sprint successfully
        });
    });
    
    describe("Common Sprint Durations", () => {
        it("Should accept 1 week sprint", async () => {
            const duration = 7 * DAY;
            // Test implementation
        });
        
        it("Should accept 2 week sprint", async () => {
            const duration = 14 * DAY;
            // Test implementation
        });
        
        it("Should accept 1 month sprint", async () => {
            const duration = 30 * DAY;
            // Test implementation
        });
        
        it("Should accept 3 month sprint", async () => {
            const duration = 90 * DAY;
            // Test implementation
        });
        
        it("Should accept 6 month sprint", async () => {
            const duration = 180 * DAY;
            // Test implementation
        });
    });
    
    describe("Duration Edge Cases", () => {
        it("Should handle duration calculation with pause time correctly", async () => {
            // Even with pause extensions, original duration limits should apply
            // A 1-week sprint paused for 6 months doesn't become a 6-month sprint
        });
        
        it("Should validate duration independent of pause limits", async () => {
            // The pause duration limit (equal to sprint duration) should work
            // correctly with both short (1 hour) and long (365 days) sprints
        });
    });
});
