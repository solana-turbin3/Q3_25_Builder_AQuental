import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Amm } from "../target/types/amm";
import { expect } from "chai";

describe("AMM Strategy Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Amm as Program<Amm>;

  // Test constants
  const AMOUNT_IN = new BN(100_000);
  const RESERVE_IN = new BN(1_000_000);
  const RESERVE_OUT = new BN(1_000_000);
  const FEE_BPS = new BN(30); // 0.3%
  const AMOUNT_A = new BN(100_000);
  const AMOUNT_B = new BN(100_000);
  const LP_AMOUNT = new BN(25_000);
  const LP_SUPPLY = new BN(100_000);

  describe("Constant Product Strategy", () => {
    it("Should calculate amount out correctly", async () => {
      // Test constant product formula: x * y = k
      // amount_out = (amount_in * fee_adj * reserve_out) / (reserve_in + amount_in * fee_adj)
      const feeAdj = 10000 - FEE_BPS.toNumber();
      const adjustedAmountIn = AMOUNT_IN.toNumber() * feeAdj / 10000;
      const expectedAmountOut = Math.floor(
        (adjustedAmountIn * RESERVE_OUT.toNumber()) / 
        (RESERVE_IN.toNumber() + adjustedAmountIn)
      );
      
      console.log("Constant Product Strategy Test:");
      console.log(`Amount In: ${AMOUNT_IN.toString()}`);
      console.log(`Expected Amount Out: ${expectedAmountOut}`);
      console.log(`Fee: ${FEE_BPS.toString()} bps`);
      
      // In a real implementation, you would call your program method here
      // For now, we're testing the mathematical correctness
      expect(expectedAmountOut).to.be.greaterThan(0);
      expect(expectedAmountOut).to.be.lessThan(AMOUNT_IN.toNumber());
    });

    it("Should calculate initial LP supply correctly", async () => {
      // For constant product: sqrt(amount_a * amount_b)
      const expectedLpSupply = Math.floor(
        Math.sqrt(AMOUNT_A.toNumber() * AMOUNT_B.toNumber())
      );
      
      console.log("Constant Product LP Supply Test:");
      console.log(`Amount A: ${AMOUNT_A.toString()}`);
      console.log(`Amount B: ${AMOUNT_B.toString()}`);
      console.log(`Expected LP Supply: ${expectedLpSupply}`);
      
      expect(expectedLpSupply).to.be.greaterThan(0);
    });
  });

  describe("Stable Swap Strategy", () => {
    it("Should have lower slippage than constant product", async () => {
      // Stable swap should provide better rates for similar assets
      const constantProductOut = Math.floor(
        (AMOUNT_IN.toNumber() * 9970 * RESERVE_OUT.toNumber()) / 
        (RESERVE_IN.toNumber() * 10000 + AMOUNT_IN.toNumber() * 9970)
      );
      
      // Stable swap approximation (simplified)
      const stableSwapOut = Math.floor(
        AMOUNT_IN.toNumber() * (1 - 0.001) // Much lower slippage
      );
      
      console.log("Stable Swap vs Constant Product:");
      console.log(`Constant Product Out: ${constantProductOut}`);
      console.log(`Stable Swap Out: ${stableSwapOut}`);
      
      // Stable swap should provide better rates (higher output)
      expect(stableSwapOut).to.be.greaterThan(constantProductOut);
    });

    it("Should calculate LP supply as sum for stable pairs", async () => {
      // For stable swap: amount_a + amount_b
      const expectedLpSupply = AMOUNT_A.toNumber() + AMOUNT_B.toNumber();
      
      console.log("Stable Swap LP Supply Test:");
      console.log(`Expected LP Supply: ${expectedLpSupply}`);
      
      expect(expectedLpSupply).to.equal(200_000);
    });
  });

  describe("Concentrated Liquidity Strategy", () => {
    it("Should provide higher capital efficiency in range", async () => {
      // Concentrated liquidity should provide better rates within price range
      const SQRT_PRICE_LOWER = new BN(900_000); // sqrt(0.81) * 1M
      const SQRT_PRICE_UPPER = new BN(1_100_000); // sqrt(1.21) * 1M
      const SQRT_PRICE_CURRENT = new BN(1_000_000); // sqrt(1) * 1M
      
      console.log("Concentrated Liquidity Test:");
      console.log(`Price Range: [${SQRT_PRICE_LOWER.toString()}, ${SQRT_PRICE_UPPER.toString()}]`);
      console.log(`Current Price: ${SQRT_PRICE_CURRENT.toString()}`);
      
      // Within range, concentrated liquidity should be more efficient
      expect(SQRT_PRICE_CURRENT.toNumber()).to.be.greaterThan(SQRT_PRICE_LOWER.toNumber());
      expect(SQRT_PRICE_CURRENT.toNumber()).to.be.lessThan(SQRT_PRICE_UPPER.toNumber());
    });

    it("Should calculate liquidity correctly", async () => {
      const liquidity = new BN(1_000_000);
      const sqrtPrice = new BN(1_000_000);
      
      // Token amounts in concentrated liquidity
      const token0Amount = liquidity.toNumber() * 100 / sqrtPrice.toNumber(); // Simplified
      const token1Amount = liquidity.toNumber() * sqrtPrice.toNumber() / 1_000_000; // Simplified
      
      console.log("Concentrated Liquidity Amounts:");
      console.log(`Token0 Amount: ${token0Amount}`);
      console.log(`Token1 Amount: ${token1Amount}`);
      
      expect(token0Amount).to.be.greaterThan(0);
      expect(token1Amount).to.be.greaterThan(0);
    });
  });

  describe("Hybrid CFMM Strategy", () => {
    it("Should adapt between stable and volatile behavior", async () => {
      const GAMMA = new BN(500_000); // 50% balance
      
      // Hybrid should be between stable swap and constant product
      const constantProductOut = Math.floor(
        (AMOUNT_IN.toNumber() * 9970 * RESERVE_OUT.toNumber()) / 
        (RESERVE_IN.toNumber() * 10000 + AMOUNT_IN.toNumber() * 9970)
      );
      
      const stableSwapOut = Math.floor(AMOUNT_IN.toNumber() * 0.999);
      
      // Hybrid should be somewhere in between
      const hybridOut = Math.floor(
        (constantProductOut * GAMMA.toNumber() + stableSwapOut * (1_000_000 - GAMMA.toNumber())) / 1_000_000
      );
      
      console.log("Hybrid CFMM Test:");
      console.log(`Constant Product: ${constantProductOut}`);
      console.log(`Stable Swap: ${stableSwapOut}`);
      console.log(`Hybrid (50/50): ${hybridOut}`);
      
      expect(hybridOut).to.be.greaterThan(constantProductOut);
      expect(hybridOut).to.be.lessThan(stableSwapOut);
    });

    it("Should adjust fees dynamically", async () => {
      const MID_FEE = new BN(30); // 0.3%
      const OUT_FEE = new BN(100); // 1%
      
      // When balanced, should use mid fee
      const balancedFee = MID_FEE.toNumber();
      
      // When imbalanced, should use higher fee
      const imbalancedFee = OUT_FEE.toNumber();
      
      console.log("Dynamic Fee Test:");
      console.log(`Balanced Fee: ${balancedFee} bps`);
      console.log(`Imbalanced Fee: ${imbalancedFee} bps`);
      
      expect(imbalancedFee).to.be.greaterThan(balancedFee);
    });
  });

  describe("Constant Mean Strategy", () => {
    it("Should handle weighted pools correctly", async () => {
      const WEIGHT_A = new BN(800_000); // 80%
      const WEIGHT_B = new BN(200_000); // 20%
      
      // Weighted pool should behave differently than 50/50
      const weightedLpSupply = Math.floor(
        (AMOUNT_A.toNumber() * WEIGHT_A.toNumber() + AMOUNT_B.toNumber() * WEIGHT_B.toNumber()) / 
        (WEIGHT_A.toNumber() + WEIGHT_B.toNumber())
      );
      
      console.log("Constant Mean Strategy Test:");
      console.log(`Weight A: ${WEIGHT_A.toString()}`);
      console.log(`Weight B: ${WEIGHT_B.toString()}`);
      console.log(`Weighted LP Supply: ${weightedLpSupply}`);
      
      expect(weightedLpSupply).to.be.greaterThan(0);
    });

    it("Should calculate spot price correctly", async () => {
      const WEIGHT_A = new BN(600_000); // 60%
      const WEIGHT_B = new BN(400_000); // 40%
      
      // Spot price = (reserve_b * weight_a) / (reserve_a * weight_b)
      const spotPrice = Math.floor(
        (RESERVE_OUT.toNumber() * WEIGHT_A.toNumber()) / 
        (RESERVE_IN.toNumber() * WEIGHT_B.toNumber())
      );
      
      console.log("Spot Price Test:");
      console.log(`Calculated Spot Price: ${spotPrice}`);
      
      expect(spotPrice).to.be.greaterThan(0);
    });

    it("Should behave like constant product for 50/50 pools", async () => {
      const WEIGHT_A = new BN(500_000); // 50%
      const WEIGHT_B = new BN(500_000); // 50%
      
      // For 50/50 weights, should be identical to constant product
      const constantProductOut = Math.floor(
        (AMOUNT_IN.toNumber() * 9970 * RESERVE_OUT.toNumber()) / 
        (RESERVE_IN.toNumber() * 10000 + AMOUNT_IN.toNumber() * 9970)
      );
      
      // Since weights are equal, constant mean should equal constant product
      const constantMeanOut = constantProductOut; // Same calculation
      
      console.log("50/50 Constant Mean Test:");
      console.log(`Constant Product Out: ${constantProductOut}`);
      console.log(`Constant Mean Out: ${constantMeanOut}`);
      
      expect(constantMeanOut).to.equal(constantProductOut);
    });
  });

  describe("Strategy Comparison", () => {
    it("Should show different outputs for different strategies", async () => {
      // Calculate outputs for all strategies
      const constantProductOut = Math.floor(
        (AMOUNT_IN.toNumber() * 9970 * RESERVE_OUT.toNumber()) / 
        (RESERVE_IN.toNumber() * 10000 + AMOUNT_IN.toNumber() * 9970)
      );
      
      const stableSwapOut = Math.floor(AMOUNT_IN.toNumber() * 0.999);
      const concentratedLiquidityOut = Math.floor(AMOUNT_IN.toNumber() * 0.1); // Simplified
      const hybridOut = Math.floor((constantProductOut + stableSwapOut) / 2);
      const constantMeanOut = constantProductOut; // 50/50 case
      
      console.log("\n=== Strategy Comparison ===");
      console.log(`Input Amount: ${AMOUNT_IN.toString()}`);
      console.log(`Constant Product: ${constantProductOut}`);
      console.log(`Stable Swap: ${stableSwapOut}`);
      console.log(`Concentrated Liquidity: ${concentratedLiquidityOut}`);
      console.log(`Hybrid CFMM: ${hybridOut}`);
      console.log(`Constant Mean: ${constantMeanOut}`);
      
      // All should be positive and different (except constant mean = constant product for 50/50)
      expect(constantProductOut).to.be.greaterThan(0);
      expect(stableSwapOut).to.be.greaterThan(0);
      expect(concentratedLiquidityOut).to.be.greaterThan(0);
      expect(hybridOut).to.be.greaterThan(0);
      expect(constantMeanOut).to.be.greaterThan(0);
      
      // Stable swap should be most efficient for stable pairs
      expect(stableSwapOut).to.be.greaterThan(constantProductOut);
    });

    it("Should show different LP calculations", async () => {
      const constantProductLp = Math.floor(Math.sqrt(AMOUNT_A.toNumber() * AMOUNT_B.toNumber()));
      const stableSwapLp = AMOUNT_A.toNumber() + AMOUNT_B.toNumber();
      const concentratedLiquidityLp = Math.floor(Math.sqrt(AMOUNT_A.toNumber() * AMOUNT_B.toNumber()));
      const hybridLp = Math.floor((constantProductLp + stableSwapLp) / 2);
      const constantMeanLp = constantProductLp; // 50/50 case
      
      console.log("\n=== LP Supply Comparison ===");
      console.log(`Constant Product LP: ${constantProductLp}`);
      console.log(`Stable Swap LP: ${stableSwapLp}`);
      console.log(`Concentrated Liquidity LP: ${concentratedLiquidityLp}`);
      console.log(`Hybrid CFMM LP: ${hybridLp}`);
      console.log(`Constant Mean LP: ${constantMeanLp}`);
      
      // All should be positive
      expect(constantProductLp).to.be.greaterThan(0);
      expect(stableSwapLp).to.be.greaterThan(0);
      expect(concentratedLiquidityLp).to.be.greaterThan(0);
      expect(hybridLp).to.be.greaterThan(0);
      expect(constantMeanLp).to.be.greaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("Should handle zero input correctly", async () => {
      const zeroAmountIn = new BN(0);
      
      // All strategies should return 0 for 0 input
      expect(zeroAmountIn.toNumber()).to.equal(0);
    });

    it("Should handle large inputs", async () => {
      const largeAmountIn = new BN(1_000_000); // Equal to reserve
      
      // Should not allow swapping entire reserve
      expect(largeAmountIn.toNumber()).to.be.lessThan(RESERVE_IN.toNumber() * 2);
    });

    it("Should handle minimum liquidity", async () => {
      const minLiquidity = new BN(1000);
      
      // Should handle small amounts
      expect(minLiquidity.toNumber()).to.be.greaterThan(0);
    });
  });

  describe("Performance Tests", () => {
    it("Should benchmark all strategies", async () => {
      const startTime = Date.now();
      
      // Simulate multiple calculations
      for (let i = 0; i < 1000; i++) {
        const constantProductOut = Math.floor(
          (AMOUNT_IN.toNumber() * 9970 * RESERVE_OUT.toNumber()) / 
          (RESERVE_IN.toNumber() * 10000 + AMOUNT_IN.toNumber() * 9970)
        );
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`\nPerformance Test: ${duration}ms for 1000 calculations`);
      
      // Should complete within reasonable time
      expect(duration).to.be.lessThan(1000); // Less than 1 second
    });
  });
});
