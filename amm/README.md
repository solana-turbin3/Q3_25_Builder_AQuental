# AMMs - Automated Market Maker

An **Automated Market Maker (AMM)** is a decentralized protocol that enables trustless token swaps using liquidity pools (instead of traditional order books). It relies on mathematical formulas (e.g., the **Constant Product Formula** [wiki](https://en.wikipedia.org/wiki/Constant_function_market_maker)) to set prices algorithmically, allowing users to trade assets without needing a counterparty.

---

### **How AMMs Work**

1. **Liquidity Pools**:

   - Users (liquidity providers, or LPs) deposit pairs of tokens (e.g., SOL/USDC) into a shared pool.
   - These pools act as reserves for traders to swap between tokens.

2. **Algorithmic Pricing**:

   - Solana AMMs use formulas like **`x * y = k`** (Constant Product Market Maker) to determine prices.
     - `x` and `y` are the quantities of two tokens in the pool.
     - `k` is a constant, ensuring the product of reserves stays the same before/after trades.
   - Prices adjust automatically based on supply/demand in the pool.

3. **Fees for LPs**:

   - Traders pay a small fee (e.g., 0.3% per swap), which is distributed to liquidity providers as rewards.

4. **No Order Books**:
   - Unlike centralized exchanges (e.g., Binance), AMMs don’t need buyers/sellers to match orders. Swaps happen instantly against the pool.

---

### **Key Features of AMMs**

- **Speed & Low Cost**: Solana’s high throughput (~2,000+ TPS) and low fees make AMM trades fast and cheap.
- **Permissionless**: Anyone can add liquidity or create new pools.
- **Composability**: AMMs integrate with other DeFi apps (e.g., lending, yield farming).

---

### **Popular AMMs on Solana**

1. **[Raydium](https://raydium.io)**
   - Combines AMM with Serum’s order book for deeper liquidity.
2. **[Orca](https://www.orca.so/)**
   - User-friendly, low-slippage swaps with "Whirlpools" (concentrated liquidity).
3. **[Saber](https://saberdao.so/)**
   - Optimized for stablecoin swaps (like [Curve](https://www.curve.finance) on Ethereum).

---

### **Example Swap on AMM**

1. Alice swaps **10 SOL for USDC** on Raydium:

   - The AMM calculates the price based on SOL/USDC pool reserves.
   - If the pool has 1,000 SOL and 100,000 USDC (`k = 100,000,000`), she receives ~1,000 USDC (minus fees).
   - The new pool balance might be 1,010 SOL and 99,000 USDC (`k` remains constant).

2. **Liquidity Providers Earn Fees**:
   - The 0.3% fee (3 USDC) is split among LPs proportional to their share of the pool.

---

### **AMM vs. Order Book ([Serum](https://serum-dex.vercel.app) DEX)**

| Feature       | AMM (e.g., Raydium)   | Order Book (e.g., Serum)        |
| ------------- | --------------------- | ------------------------------- |
| **Liquidity** | Pool-based            | Buyer/Seller orders             |
| **Pricing**   | Algorithmic (`x*y=k`) | Market-driven (bids/asks)       |
| **Speed**     | Instant               | Requires order matching         |
| **Use Case**  | Simple swaps          | Advanced trading (limit orders) |

---

### **Advanced AMM Concepts on Solana**

- **Concentrated Liquidity** (e.g., Orca Whirlpools): LPs allocate funds to specific price ranges for higher capital efficiency.
- **Dynamic Fees**: Adjusts fees based on market volatility.
- **Flash Loans**: Borrow from pools without collateral (if repaid in one transaction).

---

### [AMM in Anchor](./ANCHOR_AMM.md)
