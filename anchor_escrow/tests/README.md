# Anchor Escrow Program Tests

This directory contains comprehensive tests for the Anchor Escrow program. The tests are organized into three main categories:

## Test Files

### 1. `anchor-escrow.ts` - Main Functionality Tests
This file contains the core functionality tests including:
- ✅ Successfully creating an escrow
- ✅ Successfully refunding an escrow
- ✅ Error handling for zero deposits
- ✅ Error handling for insufficient funds
- ✅ Authorization checks for refund operations
- ✅ Duplicate escrow prevention
- ✅ Multiple escrows with different seeds
- ✅ Various token amount scenarios

### 2. `escrow-edge-cases.ts` - Edge Case Tests
This file tests various edge cases and boundary conditions:
- ✅ Very large seed values (max u64)
- ✅ Zero receive amounts
- ✅ Maximum token amounts
- ✅ Same mint for both tokens
- ✅ Multiple rapid escrow creations
- ✅ Account space and layout validation
- ✅ Minimal amount refunds
- ✅ Token program compatibility

### 3. `escrow-security.ts` - Security Tests
This file focuses on security and access control:
- ✅ Unauthorized escrow creation prevention
- ✅ Unauthorized refund prevention
- ✅ Wrong token account prevention
- ✅ Wrong vault prevention
- ✅ Double refund attack prevention
- ✅ Mint consistency validation
- ✅ PDA seed validation
- ✅ Bump manipulation prevention
- ✅ Reentrancy attack prevention
- ✅ Token account ownership validation
- ✅ Unauthorized account initialization prevention

## Running the Tests

### Prerequisites
1. Install dependencies:
   ```bash
   npm install
   ```

2. Make sure you have a local Solana validator running:
   ```bash
   solana-test-validator
   ```

3. Build the program:
   ```bash
   anchor build
   ```

### Running All Tests
```bash
anchor test
```

### Running Specific Test Files
```bash
# Main functionality tests
anchor test --skip-deploy tests/anchor-escrow.ts

# Edge case tests
anchor test --skip-deploy tests/escrow-edge-cases.ts

# Security tests
anchor test --skip-deploy tests/escrow-security.ts
```

### Running Individual Tests
You can run individual tests using mocha's grep option:
```bash
# Run only the escrow creation test
npx mocha tests/anchor-escrow.ts --grep "Successfully creates an escrow"

# Run only security-related tests
npx mocha tests/escrow-security.ts --grep "Prevents"
```

## Test Structure

Each test follows this general structure:

1. **Setup**: Creates fresh keypairs, mints, and token accounts for each test
2. **Action**: Performs the specific operation being tested
3. **Assertion**: Verifies the expected behavior occurred
4. **Cleanup**: Tests that involve refunds verify proper account closure

## Key Test Concepts

### Account Setup
- Each test creates fresh accounts to ensure isolation
- Makers and takers get SOL airdrops for transaction fees
- Token mints are created with 6 decimal places
- Associated token accounts are created for all participants

### PDA Derivation
Tests verify that Program Derived Addresses (PDAs) are correctly derived using:
- The string "escrow"
- The maker's public key
- The seed value (as 8-byte little-endian)

### Error Handling
Many tests verify that the program correctly rejects invalid operations by:
- Catching expected errors
- Verifying error messages contain expected content
- Ensuring failed operations don't modify state

### State Verification
Tests verify program state by:
- Fetching account data after operations
- Comparing expected vs actual values
- Checking token balances
- Verifying account closure

## Common Test Utilities

The tests use several common patterns:

```typescript
// Creating test accounts
const maker = Keypair.generate();
const mintA = await createMint(connection, payer, authority, freezeAuthority, decimals);

// Deriving PDAs
const [escrow] = PublicKey.findProgramAddressSync(
  [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
  program.programId
);

// Testing error conditions
try {
  await program.methods.someMethod().rpc();
  assert.fail("Should have failed");
} catch (error) {
  assert.include(error.message, "expected error text");
}
```

## Test Coverage

The test suite provides comprehensive coverage of:
- ✅ Happy path scenarios
- ✅ Error conditions and edge cases
- ✅ Security vulnerabilities
- ✅ Access control mechanisms
- ✅ State consistency
- ✅ Token handling
- ✅ Account lifecycle management

## Notes

- Tests use the Chai assertion library for readable assertions
- All tests are designed to be independent and can run in any order
- The test environment uses a local Solana test validator
- Token operations use the SPL Token library
- Each test file has its own describe block for better organization
