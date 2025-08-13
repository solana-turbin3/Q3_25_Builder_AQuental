# Fuzzing Tests for Sprint Vault

This document explains how to implement and run fuzzing tests for the Sprint Vault program.

## What is Fuzzing?

Fuzzing (or fuzz testing) is an automated testing technique that provides random, unexpected, or malformed data as inputs to a program to discover bugs, security vulnerabilities, and edge cases that might not be caught by traditional unit tests.

## Implementation Overview

We've implemented two types of fuzzing tests:

### 1. Rust Property-Based Tests (using `proptest`)
Located in: `programs/sprint-vault/tests/fuzz_tests.rs`

These tests verify mathematical properties and invariants of the core calculation functions:
- **No Overflow**: Ensures calculations never overflow even with extreme values
- **Accounting Invariants**: Withdrawn + Available ≤ Total Amount
- **Pause Behavior**: Pausing never increases available amount
- **Time Monotonicity**: Available amount increases monotonically with time
- **Determinism**: Same inputs always produce same outputs
- **Boundary Conditions**: Handles edge cases gracefully

### 2. TypeScript Integration Fuzz Tests (using `fast-check`)
Located in: `tests/fuzz-tests.ts`

These tests verify the program's behavior with random sequences of operations:
- **Random Valid Parameters**: Tests sprint creation with various valid inputs
- **Invalid Time Ranges**: Ensures invalid inputs are properly rejected
- **Withdrawal Invariants**: Verifies withdrawals never exceed available funds
- **Operation Sequences**: Tests random sequences of pause/resume/withdraw operations
- **Stress Testing**: Rapid-fire operations and extreme values

## Running the Tests

### Prerequisites
```bash
# Install Rust fuzzing dependencies (already added to Cargo.toml)
cargo build

# Install TypeScript fuzzing dependencies
npm install --save-dev fast-check
```

### Run Rust Property Tests
```bash
cd programs/sprint-vault
cargo test fuzz_tests --release -- --nocapture
```

### Run TypeScript Fuzz Tests
```bash
# Make sure local validator is running
solana-test-validator &

# Run the fuzz tests
anchor test -- --grep "fuzzing"

# Or run specific fuzz test suites
anchor test -- --grep "Property-based tests"
anchor test -- --grep "Stress testing"
```

## Key Properties Being Tested

### Safety Properties
1. **No Integer Overflow**: All arithmetic operations are safe
2. **No Underflow**: Subtractions never go below zero
3. **Memory Safety**: Account sizes stay within limits
4. **Access Control**: Only authorized users can perform actions

### Functional Properties
1. **Monotonicity**: Time progression increases available funds
2. **Conservation**: Total funds are conserved (no creation/destruction)
3. **Determinism**: Operations are reproducible
4. **Idempotency**: Multiple identical withdrawals are safe

### Business Logic Properties
1. **Sprint Duration**: Start time < End time
2. **Withdrawal Limits**: Can't withdraw more than streamed
3. **Pause Effectiveness**: Paused sprints block withdrawals
4. **Sequential Consistency**: Operations maintain valid state

## Interpreting Results

### Successful Test
```
✓ Property test passed after 1000 iterations
```

### Failed Test (Example)
```
Falsifying example: 
  total_amount = 18446744073709551615
  start_time = 0
  duration = -1
Property violated: InvalidTimeRange
```

When a test fails, the fuzzer provides the minimal failing input that reproduces the issue.

## Configuration

### Rust Proptest Configuration
Create `proptest.toml` in the project root:
```toml
[profile.default]
cases = 1000        # Number of test cases per property
max_shrink_iters = 100  # Shrinking iterations to find minimal case
timeout = 180000    # Timeout in milliseconds
```

### TypeScript fast-check Configuration
In the test files:
```typescript
{ 
  numRuns: 100,      // Number of random inputs to test
  timeout: 60000,    // Timeout per test in ms
  seed: 42,          // Optional: fix seed for reproducibility
  verbose: true      // Optional: detailed output
}
```

## Best Practices

1. **Start Small**: Begin with simple properties and gradually add complexity
2. **Focus on Invariants**: Test properties that should always hold
3. **Use Shrinking**: When a test fails, fuzzer finds minimal failing case
4. **Combine with Unit Tests**: Fuzzing complements but doesn't replace unit tests
5. **Monitor Performance**: Fuzzing can be resource-intensive
6. **Save Failing Cases**: Convert interesting failures into regression tests

## Common Issues and Solutions

### Issue: Tests timeout
**Solution**: Reduce `numRuns` or increase `timeout`

### Issue: Too many false positives
**Solution**: Add more `prop_assume!` conditions to filter invalid inputs

### Issue: Not finding bugs
**Solution**: Increase iteration count or adjust input ranges

### Issue: Reproducibility
**Solution**: Use fixed seeds during debugging

## Advanced Techniques

### Custom Generators
```rust
// Rust
prop_compose! {
    fn valid_sprint()
        (amount in 1000u64..1_000_000_000u64)
        (start in 0i64..1_000_000i64, 
         amount in Just(amount))
        (duration in 60i64..86400i64,
         start in Just(start),
         amount in Just(amount))
    -> (i64, i64, u64) {
        (start, start + duration, amount)
    }
}
```

### Stateful Testing
```typescript
// TypeScript
fc.commands([
  createSprintCommand,
  depositCommand,
  withdrawCommand,
  pauseCommand,
  resumeCommand
])
```

## Continuous Integration

Add to your CI pipeline:
```yaml
- name: Run Fuzz Tests
  run: |
    cargo test fuzz_tests --release
    anchor test -- --grep "fuzzing"
```

## Resources

- [Proptest Documentation](https://github.com/proptest-rs/proptest)
- [Fast-check Documentation](https://github.com/dubzzz/fast-check)
- [Property-Based Testing Guide](https://hypothesis.works/articles/what-is-property-based-testing/)
- [Fuzzing Best Practices](https://google.github.io/fuzzing/)
