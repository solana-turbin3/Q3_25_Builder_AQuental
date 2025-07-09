import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createSignerFromKeypair,
  signerIdentity,
  generateSigner,
  percentAmount,
} from "@metaplex-foundation/umi";
import {
  createNft,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";

import wallet from "../turbin3-wallet.json";
import base58 from "bs58";

const umi = createUmi("https://api.devnet.solana.com");

let keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const myKeypairSigner = createSignerFromKeypair(umi, keypair);
umi.use(signerIdentity(myKeypairSigner));
umi.use(mplTokenMetadata());

const mint = generateSigner(umi);
// metadata
const uri =
  "https://gateway.irys.xyz/9dw2bELBvmvTcyEKQg4AEgMfsY6YB82podE8U1Md4ESH";

(async () => {
  let tx = createNft(umi, {
    mint,
    name: "Oriental Fancy Rug",
    uri,
    sellerFeeBasisPoints: percentAmount(5.5),
  });
  let result = await tx.sendAndConfirm(umi);
  const signature = base58.encode(result.signature);

  console.log(
    `Succesfully Minted! Check out your TX here:\nhttps://explorer.solana.com/tx/${signature}?cluster=devnet`
  );
  console.log("Mint Address: ", mint.publicKey);
})();

// Succesfully Minted! Check out your TX here:
// https://explorer.solana.com/tx/2fC3hvfbXUvE1BCgUiHhmQTXhGbSjrsanqE9eDhNZJ3d8DXrZJLrntJfUiXTvaZAPzMNjdr2LjzsdWQF1cgZUbJH?cluster=devnet
// Mint Address:  36Yot5KReZRMRwMGxjKTUuUHW7GP3oKQX1ieGsaX1cn1
