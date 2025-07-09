# turbin3-prereq-rs 🦀

```shell
$ cargo init --lib
$ cargo add solana-sdk
```

### keygen

```shell
$ cargo test -- --nocapture
running 3 tests
test tests::transfer_sol ... ok
test tests::airdrop ... ok
You've generated a new Solana wallet: 36EvskxpVdgDLWRSkVmimqDCeJV8o9CXt7pDHDjvHTjg

To save your wallet, copy and paste the following into a JSON file:
[72, 52, 88, 98, 249, 84, 183, 151, 226, 215, 97, 156, 164, 119, 143, 110, 22, 145, 187, 255, 124, 166, 106, 215, 116, 142, 236, 33, 6, 102, 97, 28, 31, 15, 6, 255, 105, 241, 15, 83, 186, 125, 57, 180, 245, 253, 113, 156, 57, 124, 151, 75, 245, 252, 97, 139, 243, 5, 237, 102, 95, 174, 151, 99]
test tests::keygen ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### import/export from Phantom

```shell
cargo add bs58
```

### claim token airdrop

```shell
cargo add solana-client
```

### _Rust_ - Prerequisites: Enrollment dApp

- _submit_rs_ :
  - ()
  - 4 accounts:
    - user – Your public key (used for the Turbin3 application).
    - account – The account created by the program (from the TypeScript prerequisite).
    - mint – The address of the new asset (created by the program).
    - collection – The collection to which the asset belongs.
    - authority – The authority signing the NFT creation (PDA).
    - mpl_core_program – The Metaplex Core program
    - system_program – The Solana system program

> [Anchor Program IDL](./rust/src/program/TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM-idl.json) from [address](https://explorer.solana.com/address/TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM/anchor-program?cluster=devnet)
>
> [devnet-transaction](https://explorer.solana.com/tx/5oTCTx4FXESAx3qwcgXLQhL2HdXwCKXiTNQpntw8xNhUwQn7FUoL58VBordwJRbNV2s636dRNUCz18i7GWhi7rpz/?cluster=devnet)
