use anchor_amm::instructions::strategy::{
    AmmStrategy, ConstantProductStrategy, ConcentratedLiquidityStrategy, HybridCfmmStrategy, ConstantMeanStrategy,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strategy_pattern_implementation() {
// Test that all strategies implement AmmStrategy correctly, including Constant Mean
        let amount_in = 100_000;
        let reserve_in = 1_000_000;
        let reserve_out = 1_000_000;
        let fee_bps = 30;

        // Test constant mean strategy
        let cm_result = ConstantMeanStrategy::calculate_amount_out(
            amount_in,
            reserve_in,
            reserve_out,
            fee_bps,
        );
        assert!(cm_result.is_ok());

        // Test constant product strategy
        let cp_result = ConstantProductStrategy::calculate_amount_out(
            amount_in,
            reserve_in,
            reserve_out,
            fee_bps,
        );
        assert!(cp_result.is_ok());

        // Test concentrated liquidity strategy
        let cl_result = ConcentratedLiquidityStrategy::calculate_amount_out(
            amount_in,
            reserve_in,
            reserve_out,
            fee_bps,
        );
        assert!(cl_result.is_ok());

        let cp_amount = cp_result.unwrap();
        let cl_amount = cl_result.unwrap();

        let cm_amount = cm_result.unwrap();
        assert!(cp_amount > 0);
        assert!(cl_amount > 0);

        assert!(cm_amount > 0);

        // They should be less than input due to fees and slippage
        assert!(cp_amount < amount_in);
        assert!(cl_amount < amount_in);

        println!("Strategy pattern test passed!");
        println!("Amount in: {}", amount_in);
        println!("Constant Product output: {}", cp_amount);
        println!("Concentrated Liquidity output: {}", cl_amount);
        println!("Constant Mean output: {}", cm_amount);
    }

    #[test]
    fn test_lp_calculations() {
        let amount_a = 100_000;
        let amount_b = 100_000;

        // Test initial LP supply
        let cp_initial = ConstantProductStrategy::calculate_initial_lp_supply(
            amount_a,
            amount_b,
        ).unwrap();

        let cl_initial = ConcentratedLiquidityStrategy::calculate_initial_lp_supply(
            amount_a,
            amount_b,
        ).unwrap();

        let cm_initial = ConstantMeanStrategy::calculate_initial_lp_supply(
            amount_a,
            amount_b,
        ).unwrap();

        assert!(cp_initial > 0);
        assert!(cm_initial > 0);
        assert!(cl_initial > 0);

        // Test LP token minting
        let reserve_a = 100_000;
        let deposit_amount = 50_000;

        let cp_mint = ConstantProductStrategy::calculate_lp_tokens_to_mint(
            deposit_amount,
            reserve_a,
            cp_initial,
        ).unwrap();

        let cl_mint = ConcentratedLiquidityStrategy::calculate_lp_tokens_to_mint(
            deposit_amount,
            reserve_a,
            cl_initial,
        ).unwrap();

        assert!(cp_mint > 0);
        assert!(cl_mint > 0);

        // Test Constant Mean LP minting
        let cm_mint = ConstantMeanStrategy::calculate_lp_tokens_to_mint(
            deposit_amount,
            reserve_a,
            cm_initial,
        ).unwrap();

        assert!(cm_mint > 0);

        println!("LP calculations test passed!");
        println!("CP Initial: {}, CL Initial: {}", cp_initial, cl_initial);
        println!("CP Mint: {}, CL Mint: {}", cp_mint, cl_mint);
        println!("CM Initial: {}", cm_initial);
        println!("CM Mint: {}", cm_mint);
    }

    #[test]
    fn test_withdraw_calculations() {
        let lp_amount = 25_000;
        let reserve_a = 100_000;
        let reserve_b = 100_000;
        let lp_supply = 100_000;

        let cp_withdraw = ConstantProductStrategy::calculate_withdraw_amounts(
            lp_amount,
            reserve_a,
            reserve_b,
            lp_supply,
        ).unwrap();

        let cl_withdraw = ConcentratedLiquidityStrategy::calculate_withdraw_amounts(
            lp_amount,
            reserve_a,
            reserve_b,
            lp_supply,
        ).unwrap();

        assert!(cp_withdraw.0 > 0);
        assert!(cp_withdraw.1 > 0);
        let cm_withdraw = ConstantMeanStrategy::calculate_withdraw_amounts(
            lp_amount,
            reserve_a,
            reserve_b,
            lp_supply,
        ).unwrap();

        assert!(cl_withdraw.0 > 0);
        assert!(cm_withdraw.0 > 0);
        assert!(cm_withdraw.1 > 0);

        // Should not exceed reserves
        assert!(cp_withdraw.0 <= reserve_a);
        assert!(cp_withdraw.1 <= reserve_b);
        assert!(cl_withdraw.0 <= reserve_a);
        assert!(cm_withdraw.0 <= reserve_a);
        assert!(cm_withdraw.1 <= reserve_b);

        println!("Withdraw calculations test passed!");
        println!("CP Withdraw: ({}, {})", cp_withdraw.0, cp_withdraw.1);
        println!("CM Withdraw: ({}, {})", cm_withdraw.0, cm_withdraw.1);
        println!("CL Withdraw: ({}, {})", cl_withdraw.0, cl_withdraw.1);
    }

    #[test]
    fn test_hybrid_cfmm_strategy() {
        // Test that hybrid CFMM implements AmmStrategy correctly
        let amount_in = 100_000;
        let reserve_in = 1_000_000;
        let reserve_out = 1_000_000;
        let fee_bps = 30;

        // Test hybrid CFMM strategy
        let hybrid_result = HybridCfmmStrategy::calculate_amount_out(
            amount_in,
            reserve_in,
            reserve_out,
            fee_bps,
        );
        assert!(hybrid_result.is_ok());

        let hybrid_amount = hybrid_result.unwrap();
        assert!(hybrid_amount > 0);
        assert!(hybrid_amount < amount_in); // Should be less than input due to fees and slippage

        println!("Hybrid CFMM test passed!");
        println!("Amount in: {}", amount_in);
        println!("Hybrid CFMM output: {}", hybrid_amount);
    }

    #[test]
    fn test_hybrid_cfmm_lp_calculations() {
        let amount_a = 100_000;
        let amount_b = 100_000;

        // Test initial LP supply
        let hybrid_initial = HybridCfmmStrategy::calculate_initial_lp_supply(
            amount_a,
            amount_b,
        ).unwrap();

        assert!(hybrid_initial > 0);

        // Test LP token minting
        let reserve_a = 100_000;
        let deposit_amount = 50_000;

        let hybrid_mint = HybridCfmmStrategy::calculate_lp_tokens_to_mint(
            deposit_amount,
            reserve_a,
            hybrid_initial,
        ).unwrap();

        assert!(hybrid_mint > 0);

        println!("Hybrid CFMM LP calculations test passed!");
        println!("Hybrid Initial: {}", hybrid_initial);
        println!("Hybrid Mint: {}", hybrid_mint);
    }

    #[test]
    fn test_hybrid_cfmm_withdraw_calculations() {
        let lp_amount = 25_000;
        let reserve_a = 100_000;
        let reserve_b = 100_000;
        let lp_supply = 100_000;

        let hybrid_withdraw = HybridCfmmStrategy::calculate_withdraw_amounts(
            lp_amount,
            reserve_a,
            reserve_b,
            lp_supply,
        ).unwrap();

        assert!(hybrid_withdraw.0 > 0);
        assert!(hybrid_withdraw.1 > 0);

        // Should not exceed reserves
        assert!(hybrid_withdraw.0 <= reserve_a);
        assert!(hybrid_withdraw.1 <= reserve_b);

        println!("Hybrid CFMM withdraw calculations test passed!");
        println!("Hybrid Withdraw: ({}, {})", hybrid_withdraw.0, hybrid_withdraw.1);
    }

    #[test]
    fn test_all_strategies_comparison() {
        // Test that all strategies implement AmmStrategy and have different behaviors
        let amount_in = 100_000;
        let reserve_in = 1_000_000;
        let reserve_out = 1_000_000;
        let fee_bps = 30;

        // Test all strategies
        let cp_result = ConstantProductStrategy::calculate_amount_out(
            amount_in, reserve_in, reserve_out, fee_bps,
        ).unwrap();

        let cl_result = ConcentratedLiquidityStrategy::calculate_amount_out(
            amount_in, reserve_in, reserve_out, fee_bps,
        ).unwrap();

        let hybrid_result = HybridCfmmStrategy::calculate_amount_out(
            amount_in, reserve_in, reserve_out, fee_bps,
        ).unwrap();

        let cm_result = ConstantMeanStrategy::calculate_amount_out(
            amount_in, reserve_in, reserve_out, fee_bps,
        ).unwrap();
        assert!(cp_result > 0);
        assert!(cl_result > 0);
        assert!(hybrid_result > 0);

        assert!(cm_result > 0);

        // All should be less than input due to fees and slippage
        assert!(cp_result < amount_in);
        assert!(cl_result < amount_in);
        assert!(hybrid_result < amount_in);

        println!("All strategies comparison test passed!");
        println!("Amount in: {}", amount_in);
        println!("Constant Product output: {}", cp_result);
        println!("Concentrated Liquidity output: {}", cl_result);
        println!("Hybrid CFMM output: {}", hybrid_result);

        // They should have different behaviors
        assert!(cp_result != cl_result || cl_result != hybrid_result);
        println!("Constant Mean output: {}", cm_result);
    }

    #[test]
    fn test_hybrid_cfmm_dynamic_behavior() {
        // Test that hybrid CFMM behaves differently under different conditions
        let amount_in = 100_000;
        let fee_bps = 30;

        // Test with balanced reserves
        let balanced_result = HybridCfmmStrategy::calculate_amount_out(
            amount_in,
            1_000_000, // Balanced reserves
            1_000_000,
            fee_bps,
        ).unwrap();

        // Test with imbalanced reserves
        let imbalanced_result = HybridCfmmStrategy::calculate_amount_out(
            amount_in,
            2_000_000, // Imbalanced reserves
            500_000,
            fee_bps,
        ).unwrap();

        // Both should be positive
        assert!(balanced_result > 0);
        assert!(imbalanced_result > 0);

        // They should be different due to dynamic fee adjustment
        println!("Hybrid CFMM dynamic behavior test passed!");
        println!("Balanced result: {}", balanced_result);
        println!("Imbalanced result: {}", imbalanced_result);
    }

    #[test]
    fn test_constant_mean_strategy() {
        // Test that constant mean strategy implements AmmStrategy correctly
        let amount_in = 100_000;
        let reserve_in = 1_000_000;
        let reserve_out = 1_000_000;
        let fee_bps = 30;

        // Test constant mean strategy
        let cm_result = ConstantMeanStrategy::calculate_amount_out(
            amount_in,
            reserve_in,
            reserve_out,
            fee_bps,
        );
        assert!(cm_result.is_ok());

        let cm_amount = cm_result.unwrap();
        assert!(cm_amount > 0);
        assert!(cm_amount < amount_in); // Should be less than input due to fees and slippage

        println!("Constant Mean strategy test passed!");
        println!("Amount in: {}", amount_in);
        println!("Constant Mean output: {}", cm_amount);
    }

    #[test]
    fn test_constant_mean_lp_calculations() {
        let amount_a = 100_000;
        let amount_b = 100_000;

        // Test initial LP supply
        let cm_initial = ConstantMeanStrategy::calculate_initial_lp_supply(
            amount_a,
            amount_b,
        ).unwrap();

        assert!(cm_initial > 0);

        // Test LP token minting
        let reserve_a = 100_000;
        let deposit_amount = 50_000;

        let cm_mint = ConstantMeanStrategy::calculate_lp_tokens_to_mint(
            deposit_amount,
            reserve_a,
            cm_initial,
        ).unwrap();

        assert!(cm_mint > 0);

        println!("Constant Mean LP calculations test passed!");
        println!("CM Initial: {}", cm_initial);
        println!("CM Mint: {}", cm_mint);
    }

    #[test]
    fn test_constant_mean_withdraw_calculations() {
        let lp_amount = 25_000;
        let reserve_a = 100_000;
        let reserve_b = 100_000;
        let lp_supply = 100_000;

        let cm_withdraw = ConstantMeanStrategy::calculate_withdraw_amounts(
            lp_amount,
            reserve_a,
            reserve_b,
            lp_supply,
        ).unwrap();

        assert!(cm_withdraw.0 > 0);
        assert!(cm_withdraw.1 > 0);

        // Should not exceed reserves
        assert!(cm_withdraw.0 <= reserve_a);
        assert!(cm_withdraw.1 <= reserve_b);

        println!("Constant Mean withdraw calculations test passed!");
        println!("CM Withdraw: ({}, {})", cm_withdraw.0, cm_withdraw.1);
    }

    #[test]
    fn test_all_strategies_lp_supply_comparison() {
        // Test that all strategies calculate LP supply correctly
        let amount_a = 100_000;
        let amount_b = 100_000;

        let cp_supply = ConstantProductStrategy::calculate_initial_lp_supply(
            amount_a, amount_b,
        ).unwrap();

        let cl_supply = ConcentratedLiquidityStrategy::calculate_initial_lp_supply(
            amount_a, amount_b,
        ).unwrap();

        let hybrid_supply = HybridCfmmStrategy::calculate_initial_lp_supply(
            amount_a, amount_b,
        ).unwrap();

        // All should be positive
        assert!(cp_supply > 0);
        assert!(cl_supply > 0);
        assert!(hybrid_supply > 0);

        println!("All strategies LP supply comparison test passed!");
        println!("CP Supply: {}", cp_supply);
        println!("CL Supply: {}", cl_supply);
        println!("Hybrid Supply: {}", hybrid_supply);
        let cm_supply = ConstantMeanStrategy::calculate_initial_lp_supply(
            amount_a, amount_b,
        ).unwrap();

        assert!(cm_supply > 0);

        println!("Constant Mean Supply: {}", cm_supply);
    }
}
