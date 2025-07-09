# turbin3-prereq-ts <img src="../img/typescript.png" alt="logo" width="25"/>

```script
nvm install --lts
nvm use --lts
node --version
$ v22.17.0
npm install --global yarn
yarn --version
$ 1.22.22
```

```node
yarn add @types/node typescript @solana/web3.js bs58
yarn add -D ts-node
yarn tsc --init --rootDir ./ --outDir ./dist --esModuleInterop --lib ES2019 --module commonjs --resolveJsonModule true --noImplicitAny true
yarn add bs58 prompt-sync
yarn add --dev @types/prompt-sync
```

package.json

```json
{
  "name": "airdrop",
  "version": "1.0.0",
  "main": "index.js",
  "license": "MIT",
  "scripts": {
    "keygen": "ts-node ./1keygen.ts",
    "airdrop": "ts-node ./2airdrop.ts",
    "convert": "ts-node ./convert.ts",
    "transfer": "ts-node ./3transfer.ts",
    "enroll": "ts-node ./4enroll.ts"
  },
  "dependencies": {
    "@coral-xyz/anchor": "^0.31.1",
    "@solana/web3.js": "^1.98.2",
    "@types/node": "^24.0.4",
    "bs58": "^6.0.0",
    "prompt-sync": "^4.2.0",
    "typescript": "^5.8.3"
  },
  "devDependencies": {
    "@types/prompt-sync": "^4.2.3",
    "ts-node": "^10.9.2"
  }
}
```

Transfer from `dev` to `Dn2ucNUVe5ptVueYRKf6m6effxs13RJpjJEMfEL9yMzG`: [devnet: ok](https://explorer.solana.com/tx/4xh9Zd473hGGcrL1556SGjfrFiZk3e3GabEG4fQam6HW3fpx5CdskW2y1REkavA5XCU7vf9sa57KAiUQeKBcnqu7?cluster=devnet)

```script
Dev wallet balance: 15.849442107 SOL
fee: 0.000005 SOL
Success! Check out your TX here:
        https://explorer.solana.com/tx/4xh9Zd473hGGcrL1556SGjfrFiZk3e3GabEG4fQam6HW3fpx5CdskW2y1REkavA5XCU7vf9sa57KAiUQeKBcnqu7?cluster=devnet
```

### _Typescript_ - Prerequisites: Enrollment dApp

```script
yarn add @coral-xyz/anchor
```

```script
anchor idl type ./programs/TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM-idl.json -o ./programs/Turbin3_prereq.ts
```

- _initialize_ :

  - github – String
  - 3 accounts:
    - user – your public key (the one you use for the Turbin3 application)
    - account – an account that will be created by our program with a custom PDA seed (more on this later)
    - system_program – the Solana system program which is responsible to create new accounts

- _submit_ts_ :
  - ()
  - 4 accounts:
    - user – your public key (the one you use for the Turbin3 application) account – the account created by our program (see above)
    - mint – the address of the new asset (that will be created by our program) collection – the collection to which the asset belongs
    - authority – the authority signing for the creation of the NFT (also a PDA) mpl_core_program – the Metaplex Core program
    - system_program – the Solana system program

> [Anchor Program IDL](./typescript/programs/TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM-idl.json) from [address](https://explorer.solana.com/address/TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM?cluster=devnet)
>
> [devnet-transaction](https://explorer.solana.com/tx/4UKBHJcQw89heXsMWZSLnfcQPmHAohLhCn3tuE2V2goQuEDvJZozcXA5LccoMid9PnruvGP6epfP5xwoZRG61uvC?cluster=devnet)

---
