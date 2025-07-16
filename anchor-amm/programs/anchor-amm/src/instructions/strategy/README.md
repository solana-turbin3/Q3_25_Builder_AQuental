# AMM Strategy Pattern Implementation

This directory contains the implementation of the Strategy pattern for different AMM (Automated Market Maker) algorithms.

## Architecture

The Strategy pattern allows the AMM to support multiple trading algorithms by abstracting the core mathematical operations behind a common interface.

### Core Components

1. **`AmmStrategy` Trait** (`mod.rs`)
   - Defines the interface that all AMM strategies must implement
   - Contains methods for swap calculations, LP token minting, and withdraw amounts

2. **`ConstantProductStrategy`** (`constant_product.rs`)
   - Implements the classic Uniswap V2 style constant product formula (x * y = k)
   - Used for general token pairs with variable pricing
   - Features geometric mean for initial LP supply calculation

3. **`StableSwapStrategy`** (`stable_swap.rs`)
   - Example implementation of a stable swap strategy
   - Designed for assets that should trade close to 1:1 ratio (like stablecoins)
   - Features reduced slippage compared to constant product

4. **`ConcentratedLiquidityStrategy`** (`concentrated_liquidity.rs`)
   - Implements Uniswap V3 style concentrated liquidity
   - Allows liquidity providers to specify price ranges for capital efficiency
   - Features sqrt(price) representation and tick-based pricing
   - Provides up to 4000x capital efficiency in narrow ranges

5. **`HybridCfmmStrategy`** (`hybrid_cfmm.rs`)
   - Implements Curve V2 style hybrid CFMM
   - Combines stable swap and constant product mechanics
   - Features dynamic parameter adjustment based on market conditions
   - Includes dynamic fee adjustment and gamma parameter control

6. **`ConstantMeanStrategy`** (`constant_mean.rs`)
   - Implements Balancer V1 style constant mean formula
   - Supports weighted token pools with customizable ratios
   - Features spot price calculation and weighted product invariant
   - Provides capital efficiency for non-50/50 token pairs

## Interface Methods

### `calculate_amount_out()`
Calculates the output amount for a given input amount in a swap operation.

**Parameters:**
- `amount_in`: Amount of input tokens
- `reserve_in`: Current reserve of input token
- `reserve_out`: Current reserve of output token  
- `fee_bps`: Fee in basis points (e.g., 30 = 0.3%)

**Returns:** Amount of output tokens

### `calculate_initial_lp_supply()`
Calculates the initial LP token supply for the first liquidity deposit.

**Parameters:**
- `amount_a`: Amount of token A being deposited
- `amount_b`: Amount of token B being deposited

**Returns:** Initial LP token supply

### `calculate_lp_tokens_to_mint()`
Calculates LP tokens to mint for subsequent liquidity deposits.

**Parameters:**
- `amount_a`: Amount of token A being deposited
- `reserve_a`: Current reserve of token A
- `lp_supply`: Current LP token supply

**Returns:** Amount of LP tokens to mint

### `calculate_withdraw_amounts()`
Calculates token amounts to return when withdrawing liquidity.

**Parameters:**
- `lp_amount`: Amount of LP tokens being burned
- `reserve_a`: Current reserve of token A
- `reserve_b`: Current reserve of token B
- `lp_supply`: Current LP token supply

**Returns:** Tuple of (amount_a, amount_b) to return

## Usage in Instructions

The strategies are used in the main instruction handlers:

```rust
// In swap instruction
let amount_out = ConstantProductStrategy::calculate_amount_out(
    amount_in,
    reserve_in,
    reserve_out,
    pool.fee,
)?;

// In deposit instruction
let lp_supply = ConstantProductStrategy::calculate_initial_lp_supply(max_a, max_b)?;
```

## Adding New Strategies

To add a new AMM strategy:

1. Create a new file in this directory (e.g., `my_strategy.rs`)
2. Implement the `AmmStrategy` trait for your struct
3. Add the module to `mod.rs`
4. Update the instruction handlers to use your new strategy

Example:

```rust
// my_strategy.rs
use super::AmmStrategy;

pub struct MyStrategy;

impl AmmStrategy for MyStrategy {
    fn calculate_amount_out(...) -> Result<u64> {
        // Your implementation here
    }
    
    // ... implement other required methods
}
```

## Strategy Details

### Concentrated Liquidity Strategy

**Formula**: `x * y = L^2` (within active price range)

**Key Features:**
- **Price Ranges**: Liquidity concentrated in specific price intervals [pa, pb]
- **Sqrt Price Representation**: Uses sqrt(price) for mathematical efficiency
- **Capital Efficiency**: Up to 4000x more efficient than V2 for narrow ranges
- **Position Management**: Each position has its own price range

**Mathematical Components:**

```rust
pub struct PriceRange {
    pub sqrt_price_lower: u64,  // sqrt(pa) - lower bound
    pub sqrt_price_upper: u64,  // sqrt(pb) - upper bound
    pub sqrt_price_current: u64, // sqrt(p) - current price
}
```

**Token Amount Calculations:**
- Token0 Amount: `x = L * (sqrt(pb) - sqrt(p)) / (sqrt(p) * sqrt(pb))`
- Token1 Amount: `y = L * (sqrt(p) - sqrt(pa))`

**Price Updates:**
- Token0 → Token1: `sqrt(p') = sqrt(p) / (1 + dx / L)`
- Token1 → Token0: `sqrt(p') = sqrt(p) + dy / L`

**Use Cases:**
- Active liquidity management
- Market makers with price predictions
- Pairs with expected price ranges
- Professional liquidity providers

### Hybrid CFMM Strategy

**Formula**: `D = (gamma * x * y) + ((1 - gamma) * stable_invariant)`

**Key Features:**
- **Gamma Parameter**: Controls balance between stable and volatile behavior
- **Dynamic Fee Adjustment**: Fees increase with pool imbalance
- **Automatic Rebalancing**: Adjusts behavior based on market conditions
- **Capital Efficiency**: Concentrated liquidity with broad range support

**Core Components:**

```rust
pub struct HybridParams {
    pub gamma: u64,           // Balance between stable and volatile (0-1000000)
    pub mid_fee: u64,         // Fee when balanced (basis points)
    pub out_fee: u64,         // Fee when imbalanced (basis points)
    pub allowed_extra_profit: u64, // Extra profit allowed for rebalancing
    pub fee_gamma: u64,       // Fee adjustment sensitivity
    pub adjustment_step: u64,  // Price adjustment step size
    pub ma_half_time: u64,    // Moving average half-time
}
```

**Behavioral Modes:**
- When gamma → 0: Behaves like stable swap (low slippage)
- When gamma → 1: Behaves like constant product (high range)
- When gamma ≈ 0.5: Balanced hybrid behavior

**Dynamic Features:**
- **Fee Calculation**: Adjusts based on pool imbalance
- **Gamma Updates**: Automatically adjusts based on market conditions
- **Price Calculation**: Weighted average of both mechanisms

**Use Cases:**
- Volatile stablecoin pairs
- Assets with changing correlation
- Pairs requiring adaptive strategies
- Professional market making

### Constant Mean Strategy

**Formula**: `∏(Ri^Wi) = K` (weighted product invariant)

**Key Features:**
- **Weighted Pools**: Supports arbitrary weight ratios (e.g., 80/20, 60/40)
- **Spot Price Calculation**: Price = (Rb/Wb) / (Ra/Wa)
- **Capital Efficiency**: Better for non-50/50 pools than constant product
- **Lower Slippage**: Reduced price impact for weighted assets

**Core Components:**

```rust
pub struct ConstantMeanStrategy {
    pub weight_a: u64,  // Weight for token A (e.g., 500000 for 50%)
    pub weight_b: u64,  // Weight for token B (e.g., 500000 for 50%)
}
```

**Mathematical Properties:**
- **Invariant**: Weighted product of reserves raised to their weights
- **Spot Price**: `price = (reserve_b * weight_a) / (reserve_a * weight_b)`
- **LP Supply**: Weighted average of token contributions
- **For 50/50 pools**: Behaves identically to constant product

**Weight Examples:**
- 50/50 Pool: weight_a = 500000, weight_b = 500000
- 80/20 Pool: weight_a = 800000, weight_b = 200000
- 60/40 Pool: weight_a = 600000, weight_b = 400000

**Use Cases:**
- Multi-asset portfolios
- Index fund tokens
- Governance token/stablecoin pairs
- Risk-adjusted liquidity provision

## Strategy Comparison

| Strategy | Best For | Slippage | LP Calculation | Capital Efficiency |
|----------|----------|----------|----------------|-------------------|
| Constant Product | General tokens | High for large trades | Geometric mean | Baseline |
| Stable Swap | Stablecoins/pegged assets | Low | Sum of amounts | High for stable pairs |
| Concentrated Liquidity | Active management | Variable by range | Liquidity-based | Up to 4000x |
| Hybrid CFMM | Adaptive pairs | Dynamic | Invariant-based | High with flexibility |
| Constant Mean | Weighted pools | Medium | Weighted average | High for weighted pairs |

## Performance Comparison

Based on test results for 100k input with 1M/1M reserves:

| Strategy | Output | Efficiency vs CP | Best Scenario |
|----------|--------|-----------------|---------------|
| Constant Product | 90,661 | Baseline (100%) | General trading |
| Stable Swap | ~99,000 | ~109% | Stable pairs |
| Concentrated Liquidity | 9,871 | Variable | Narrow ranges |
| Hybrid CFMM | 95,180 | ~105% | Adaptive trading |
| Constant Mean | ~90,661 | ~100% (50/50) | Weighted pools |

## Testing

Each strategy includes comprehensive unit tests demonstrating:
- Correct mathematical calculations
- Edge case handling
- Overflow protection
- Expected behavior differences

Run tests with:
```bash
cargo test strategy
```

## Future Enhancements

Potential improvements to the strategy system:

1. **Dynamic Strategy Selection**: Allow pools to choose strategies at runtime
2. **Hybrid Strategies**: Combine multiple strategies based on market conditions
3. **Custom Parameters**: Allow strategy-specific parameters (e.g., amplification factor)
4. **Fee Optimization**: Strategy-specific fee calculation methods
5. **Concentrated Liquidity**: Support for Uniswap V3 style concentrated liquidity positions
