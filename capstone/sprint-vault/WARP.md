# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Development Commands

### Building
```bash
# Build all Anchor programs (sprint-vault, bounty, vault)
anchor build

# Clean build artifacts
anchor clean

# Build and test in one command
npm run test:build
```

### Testing
```bash
# Run all tests with local validator
anchor test

# Run tests without rebuilding (faster iteration)
anchor test --skip-build

# Run specific test suites
npm run test:unit       # Unit tests for sprint-vault
npm run test:integration # Integration tests
npm run test:all        # All test files

# Run improved test suite with validation
./run-improved-tests.sh

# Generate test summary report
./run-test-summary.sh
```

### Deployment
```bash
# Deploy to configured cluster (localnet by default)
anchor deploy

# Deploy to specific cluster
anchor deploy --provider.cluster devnet
```

### Code Quality
```bash
# Format code
npm run lint:fix

# Check formatting
npm run lint
```

## Architecture Overview

This codebase implements a **three-program system** for decentralized payments on Solana:

### 1. Sprint Vault Program (`2XMnUCRiLzaqt3Egt9mfUUo3T9bs6BBnrcE6AQavpx1f`)
Time-streamed payments with configurable acceleration curves. Designed for ongoing work relationships where payment unlocks progressively over a sprint duration.

### 2. Bounty Program (`8qvnjVHuK27Wbzhe5HCuXybDLRN41t5LAZ9BgNKpiymh`)
Milestone-based bounty pools for discrete deliverables. Supports multiple milestones with reviewer approval gates.

### 3. Vault Program (`5Q5YAzz8Hb2F37qQ3ztmyhEqCQyRswUagUPYJK6bWP4y`)
Generic escrow infrastructure with flexible release schedules. Can serve as the underlying escrow mechanism for both Sprint and Bounty programs.

**Why Three Programs?** 
- **Modularity**: Each program handles distinct payment patterns
- **Composability**: Programs can reference each other (e.g., Bounty can link to Sprint via `associated_sprint`)
- **Upgrade Isolation**: Changes to one payment model don't affect others
- **Gas Optimization**: Users only pay for the complexity they need

## Sprint Vault Specifics

### Payment Acceleration Strategies
The Sprint Vault implements three payment curves via `ExponentialStreamingStrategy`:
- **Linear**: `earned = total × (elapsed_time / duration)`
- **Quadratic**: `earned = total × (elapsed_time / duration)²` - Slow start, accelerates toward end
- **Cubic**: `earned = total × (elapsed_time / duration)³` - Very slow start, rapid acceleration at end

Acceleration type is set at sprint creation and cannot be changed.

### Sprint Lifecycle
1. **Create Sprint**: Employer defines terms with `SprintDuration` enum (OneWeek through TwelveWeeks)
2. **Fund Sprint**: Deposit full amount to escrow, sets `is_funded = true`
3. **Payment Streaming**: Freelancer withdraws earned amount based on elapsed time
4. **Pause/Resume**: Employer can pause for disputes; duration extends by paused time
5. **Close Sprint**: Refund unearned funds, reclaim rent

### PDA Structure
```rust
// Sprint account PDA
seeds = [b"sprint", employer.key(), sprint_id.to_le_bytes()]

// Vault token account (Associated Token Account)
seeds = [sprint_pda, TOKEN_PROGRAM_ID, mint]
```

### Critical State Fields
- `total_paused_duration`: Accumulated pause time affecting sprint end
- `last_operation_slot`: Concurrency protection against double operations
- `accumulated_dust`: Tracks rounding errors for final withdrawal
- `pause_resume_count`: Limits pause/resume cycles

## Key Design Patterns

### Sprint Duration Enums
Instead of arbitrary timestamps, sprints use predefined durations:
```rust
SprintDuration::TwoWeeks // Most common
SprintDuration::OneMonth  // For larger projects
```

### Pause Mechanism
- Pausing records `pause_time` and sets `is_paused = true`
- Resuming adds elapsed pause to `total_paused_duration`
- Withdrawals blocked while paused
- Auto-closes if pause exceeds original sprint duration

### Withdrawal Calculations
```rust
effective_end_time = end_time + total_paused_duration
earned = streaming_strategy.calculate(current_time)
withdrawable = earned - withdrawn_amount
```

## Testing Strategy

### Test Categories
1. **Unit Tests** (`tests/core/`): Individual instruction validation
2. **Integration Tests** (`tests/integration/`): Full sprint lifecycles
3. **Edge Cases** (`tests/edge-cases/`): Boundary conditions, overflows, pause limits
4. **Fuzz Tests** (`tests/fuzz-tests-improved.ts`): Random parameter generation
5. **Directive Tests** (`tests/directives/`): Business rule compliance

### Test Helpers
Located in `tests/shared/helpers.ts`:
- `createAndFundSprint()`: Setup sprint with funding
- `advanceTimeBy()`: Simulate time progression
- `setupTokenAccounts()`: Initialize SPL token infrastructure

### Running Tests
Tests require a local validator with all three programs deployed. The test scripts handle this automatically:
```bash
# Starts validator, deploys programs, runs tests
npm run test:build
```

## Common Pitfalls

### Account Validation
All instructions require careful account ordering:
```typescript
.accounts({
  sprint: sprintPda,        // Must be first
  vault: vaultPda,          // Token account
  employer: employer.key,    // Signer
  freelancer: freelancer.key,
  // ... token program accounts
})
```

### Time Calculations
- Always use `Clock` sysvar for current time
- Account for `total_paused_duration` in all calculations
- Check for overflow with Rust's checked arithmetic

### Token Decimals
The programs use 6 decimal places for USDC compatibility. Always multiply human-readable amounts by 10^6.

## Program Interactions

### Bounty → Sprint Reference
Bounties can link to sprints for hybrid payment models:
```rust
BountyPool {
    associated_sprint: Option<Pubkey>, // Sprint PDA
    // ...
}
```

### Vault as Backend
The generic Vault program could replace custom escrow logic in future iterations, providing unified escrow management across all payment types.

## Build Configuration

### Solana BPF/SBF Compilation
Configured in `.cargo/config.toml`:
- Stack size: 32KB (increased for complex calculations)
- Heap size: 320KB (for larger account data)
- Target: `sbf-solana-solana`

### Anchor Configuration
- Localnet program IDs are fixed in `Anchor.toml`
- Test timeout set to 60 seconds for complex scenarios
- Uses yarn as package manager
