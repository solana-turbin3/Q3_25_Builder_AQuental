#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}        AMM Strategy Test Suite         ${NC}"
echo -e "${BLUE}========================================${NC}"

# Function to print section headers
print_section() {
    echo -e "\n${YELLOW}$1${NC}"
    echo -e "${YELLOW}$(printf '%*s' ${#1} '' | tr ' ' '-')${NC}"
}

# Function to check if command succeeded
check_result() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ $1 passed${NC}"
        return 0
    else
        echo -e "${RED}✗ $1 failed${NC}"
        return 1
    fi
}

# Track test results
rust_tests_passed=0
anchor_tests_passed=0
total_failures=0

print_section "1. Running Rust Unit Tests"
echo "Running cargo test for all strategy unit tests..."
cargo test --lib
check_result "Rust Unit Tests"
if [ $? -eq 0 ]; then
    rust_tests_passed=1
else
    ((total_failures++))
fi

print_section "2. Running Rust Integration Tests"
echo "Running cargo test for strategy integration tests..."
cargo test --test strategy_test
check_result "Rust Integration Tests"
if [ $? -ne 0 ]; then
    ((total_failures++))
fi

print_section "3. Running All Rust Tests"
echo "Running all Rust tests together..."
cargo test
check_result "All Rust Tests"
if [ $? -ne 0 ]; then
    ((total_failures++))
fi

print_section "4. Building Anchor Program"
echo "Building Anchor program..."
anchor build
check_result "Anchor Build"
if [ $? -ne 0 ]; then
    ((total_failures++))
    echo -e "${RED}Cannot proceed with Anchor tests without successful build${NC}"
else
    print_section "5. Running Anchor Tests"
    echo "Running TypeScript/Anchor tests..."
    
    # Check if we have tests to run
    if [ -f "tests/amm.ts" ]; then
        echo "Running AMM integration tests..."
        anchor test --skip-build
        check_result "Anchor AMM Tests"
        if [ $? -eq 0 ]; then
            anchor_tests_passed=1
        else
            ((total_failures++))
        fi
    fi
    
    # Run strategy tests if they exist
    if [ -f "tests/strategy-tests.ts" ]; then
        echo "Running strategy tests..."
        yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/strategy-tests.ts
        check_result "Strategy Tests"
        if [ $? -ne 0 ]; then
            ((total_failures++))
        fi
    fi
fi

print_section "6. Test Summary"
echo -e "Rust Unit Tests: ${rust_tests_passed:+${GREEN}✓${NC}}${rust_tests_passed:-${RED}✗${NC}}"
echo -e "Anchor Tests: ${anchor_tests_passed:+${GREEN}✓${NC}}${anchor_tests_passed:-${RED}✗${NC}}"

if [ $total_failures -eq 0 ]; then
    echo -e "\n${GREEN}🎉 All tests passed successfully!${NC}"
    exit 0
else
    echo -e "\n${RED}❌ $total_failures test suite(s) failed${NC}"
    exit 1
fi
