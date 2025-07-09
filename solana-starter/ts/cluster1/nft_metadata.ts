import wallet from "../turbin3-wallet.json";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createGenericFile,
  createSignerFromKeypair,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";

// Create a devnet connection
const umi = createUmi("https://api.devnet.solana.com");

let keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const signer = createSignerFromKeypair(umi, keypair);

umi.use(
  irysUploader({
    address: "https://devnet.irys.xyz",
  })
);
umi.use(signerIdentity(signer));

(async () => {
  try {
    const image =
      "https://gateway.irys.xyz/GSYT2mmURM2yyzCgZYStaZa4gjyNidM75Wz5egssrUvc";
    const metadata = {
      name: "Oriental Fancy Rug",
      symbol: "AQ",
      description: "A beautiful oriental themed rug",
      image: image,
      attributes: [{ trait_type: "creator", value: "CoPilot" }],
      properties: {
        files: [
          {
            uri: image,
            type: "image/png",
          },
        ],
      },
    };

    const myUri = await umi.uploader.uploadJson(metadata);

    console.log("Your metadata URI: ", myUri);
  } catch (error) {
    console.log("Oops.. Something went wrong", error);
  }
})();

//Your metadata URI:  https://gateway.irys.xyz/9dw2bELBvmvTcyEKQg4AEgMfsY6YB82podE8U1Md4ESH
