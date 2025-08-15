#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Sprint Vault Test Suite Runner\n');
console.log('Note: This requires the programs to be built and deployed.\n');

// Test files to run in order
const testFiles = [
  'tests/core/sprint-vault.test.ts',
  'tests/directives/directive-operations.test.ts',
  'tests/edge-cases/edge-cases.test.ts',
  'tests/integration/full-flow.test.ts'
];

console.log('Test files to run:');
testFiles.forEach(file => console.log(`  - ${file}`));
console.log('\n');

// Check if programs are deployed
console.log('⚠️  Prerequisites:');
console.log('1. Ensure Solana test validator is running');
console.log('2. Ensure programs are built: anchor build');
console.log('3. Ensure programs are deployed: anchor deploy');
console.log('\n');

console.log('If you haven\'t done this yet, run:');
console.log('  1. solana-test-validator (in a separate terminal)');
console.log('  2. anchor build');
console.log('  3. anchor deploy');
console.log('\n');

// Instructions for manual testing
console.log('📝 Manual Test Commands:');
console.log('To run all tests:');
console.log('  yarn test\n');
console.log('To run specific test file:');
testFiles.forEach(file => {
  console.log(`  npx ts-mocha -p ./tsconfig.json ${file}`);
});

console.log('\n✅ Test structure is ready and organized!');
console.log('\nDirectory structure:');
console.log('tests/');
console.log('├── core/              # Core functionality tests');
console.log('├── directives/        # Directive operations tests');
console.log('├── edge-cases/        # Edge case and error handling tests');
console.log('├── integration/       # Full flow integration tests');
console.log('├── shared/            # Shared test helpers');
console.log('└── utils/             # Test utilities');
