# [AMM](./AMM.md) using Anchor

## Tests

- Initialize pool: Creates pool with correct parameters
- Deposit liquidity: Adds liquidity and mints LP tokens correctly
- Swap A for B: Executes swap with correct AMM formula and fee calculation
- Withdraw liquidity: Burns LP tokens and returns proportional reserves
- Slippage protection: Correctly rejects swaps exceeding slippage tolerance

## AMM Functionality

- Using _Strategy Pattern_ for each AMM formula
- [more here](./programs/anchor-amm/src/instructions/strategy/README.md)

## Common Invariants

| Name (curve)                                                                                                         | Formula(s)                                                       | Key Properties                                                              | Live Examples                                                |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **[Constant-Sum](./programs/anchor-amm/src/instructions/strategy/constant_product.rs)**                              | `x + y = k`                                                      | 1:1 price fixed; can be depleted; no slippage                               | Very early Balancer “stable” pools, some wrapped-asset pairs |
| **[Constant-Mean (Balancer)](./programs/anchor-amm/src/instructions/strategy/constant_mean.rs)**                     | `∏ (x_i / w_i) = k`                                              | Generalized multi-token constant product; weights ≠ 1                       | Balancer v1, Beethoven-x                                     |
| **[Stable-Swap (Curve)](./programs/anchor-amm/src/instructions/strategy/stable_swap.rs)**                            | `A · nⁿ · Σx_i + D = A · D · nⁿ + Dⁿ⁺¹ / (nⁿ · ∏x_i)`            | Flat in the middle (low slippage for like-priced assets), steep at extremes | Curve, Saber (Solana)                                        |
| **[Concentrated Liquidity (Uniswap v3)](./programs/anchor-amm/src/instructions/strategy/concentrated_liquidity.rs)** | `x · y = k` but **only inside chosen price bands**               | Liquidity can be supplied to tiny ranges → capital efficiency ↑ 4000×       | Uniswap v3, Orca Whirlpools                                  |
| **[Hybrid CFMM](./programs/anchor-amm/src/instructions/strategy/hybrid_cfmm.rs)**                                    | Piece-wise: constant-sum near peg, constant-product far from peg | Handles both stability and de-pegging                                       | Curve v2, Platypus                                           |
| **Dynamic-Fee / Logarithmic**                                                                                        | `k = f(x, y, t)`                                                 | Fees change with volatility or imbalance                                    | DODO v2, Clipper                                             |
| **Oracle-Weighted / Pegged**                                                                                         | Uses external price feeds to shift the curve                     | Reduces impermanent loss but introduces oracle risk                         | Bancor v2, Thorchain                                         |
| **Single-Sided (Virtual Math)**                                                                                      | virtual balances allow one-sided deposits                        | SushiSwap Trident, KyberDMM                                                 |                                                              |

### Which Formula to pick

| Goal / Use-case                             | Recommended Formula    |
| ------------------------------------------- | ---------------------- |
| General spot trading                        | Constant Product       |
| Stable-coin ↔ stable-coin (USD, staked ETH) | Stable-Swap            |
| Capital-efficient market making             | Concentrated Liquidity |
| Portfolio-like multi-token pools            | Constant-Mean          |
| Pegged assets with external oracle          | Oracle-Weighted        |
| Experimental / gaming tokens                | Dynamic-Fee            |

#### reference

[The AMM book](https://theammbook.org/)  
[The AMM Triangle](https://medium.com/@odtorson/liquidity-providers-options-and-amms-c5e4ca50819e)
[Stable Swap AMM](https://www.cyfrin.io/glossary/stable-swap-amm-solidity-code-example)  
[How Concentrated Liquidity in Uniswap V3 Works](https://rareskills.io/post/uniswap-v3-concentrated-liquidity)  
[Key formulas](https://theammbook.org/formulas/stableswap/)  
[Uniswap V2 Book](https://rareskills.io/uniswap-v2-book)  
[Constant Product Automated Market Maker](https://medium.com/@tomarpari90/constant-product-automated-market-maker-everything-you-need-to-know-5bfeb0251ef2)  
[Uniswap V3 Concentrated Liquidity](https://medium.com/@chaisomsri96/defi-math-uniswap-v3-concentrated-liquidity-bd87686b3ecf)
