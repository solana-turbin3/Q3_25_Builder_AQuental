import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

// Supported token mints - must match the program constants
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
export const USDC_MINT_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// Sprint Duration constants matching the Rust enum
export const SprintDuration = {
    OneWeek: 0,
    TwoWeeks: 1,
    ThreeWeeks: 2,
    FourWeeks: 3,
    SixWeeks: 4,
    EightWeeks: 5,
    TenWeeks: 6,
    TwelveWeeks: 7,
} as const;

// Acceleration Type constants matching the Rust enum
export const AccelerationType = {
    Linear: 0,
    Quadratic: 1,
    Cubic: 2,
} as const;

// Helper to convert duration enum to object for Anchor
export function toDurationObject(duration: number): any {
  const variants = [
    "oneWeek",
    "twoWeeks",
    "threeWeeks",
    "fourWeeks",
    "sixWeeks",
    "eightWeeks",
    "tenWeeks",
    "twelveWeeks",
  ];
  return { [variants[duration]]: {} };
}

// Helper to convert acceleration type enum to object for Anchor
export function toAccelerationObject(accel: number): any {
  const variants = ["linear", "quadratic", "cubic"];
  return { [variants[accel]]: {} };
}

// Helper to calculate sprint end time from start time and duration
export function calculateEndTime(startTime: number, duration: number): number {
  const durationSeconds = [
    7 * 24 * 60 * 60,      // 1 week
    14 * 24 * 60 * 60,     // 2 weeks
    21 * 24 * 60 * 60,     // 3 weeks
    28 * 24 * 60 * 60,     // 4 weeks
    42 * 24 * 60 * 60,     // 6 weeks
    56 * 24 * 60 * 60,     // 8 weeks
    70 * 24 * 60 * 60,     // 10 weeks
    84 * 24 * 60 * 60,     // 12 weeks
  ];
  return startTime + durationSeconds[duration];
}

// Helper for creating short test durations (for testing purposes)
export function createTestDuration(seconds: number): any {
  // For tests, we'll use OneWeek as the base and adjust timing separately
  return { oneWeek: {} };
}

// Calculate actual duration in seconds for a SprintDuration
export function getDurationSeconds(duration: number): number {
  const durationSeconds = [
    7 * 24 * 60 * 60,      // 1 week
    14 * 24 * 60 * 60,     // 2 weeks
    21 * 24 * 60 * 60,     // 3 weeks
    28 * 24 * 60 * 60,     // 4 weeks
    42 * 24 * 60 * 60,     // 6 weeks
    56 * 24 * 60 * 60,     // 8 weeks
    70 * 24 * 60 * 60,     // 10 weeks
    84 * 24 * 60 * 60,     // 12 weeks
  ];
  return durationSeconds[duration];
}
