#!/bin/bash

# Set environment variables to help with stack usage
export RUST_MIN_STACK=8388608  # 8MB stack
export CARGO_TARGET_BPFEL_UNKNOWN_UNKNOWN_RUSTFLAGS="-C link-arg=-zstack-size=32768"
export CARGO_TARGET_SBF_SOLANA_SOLANA_RUSTFLAGS="-C link-arg=-zstack-size=32768"

# Clean build artifacts
echo "Cleaning build artifacts..."
cargo clean

# Build with no-idl flag to avoid IDL generation issues
echo "Building programs..."
anchor build --no-idl

echo "Build completed!"
