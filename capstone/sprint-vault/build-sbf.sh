#!/bin/bash

# Clean previous builds
echo "Cleaning previous builds..."
cargo clean

# Set environment variables to control stack usage
export RUST_MIN_STACK=8388608
export SBF_OUT_DIR=target/deploy

# Build each program individually with cargo-build-sbf
echo "Building programs with cargo-build-sbf..."

# Build sprint-vault program
echo "Building sprint-vault..."
cd programs/sprint-vault
cargo build-sbf -- --no-default-features --features no-idl 2>&1 | tail -5
cd ../..

# Build vault program
echo "Building vault..."
cd programs/vault  
cargo build-sbf -- --no-default-features --features no-idl 2>&1 | tail -5
cd ../..

# Build bounty program
echo "Building bounty..."
cd programs/bounty
cargo build-sbf -- --no-default-features --features no-idl 2>&1 | tail -5
cd ../..

echo "Build completed!"
echo "Checking deployed programs..."
ls -la target/deploy/*.so 2>/dev/null || echo "No .so files found yet"
