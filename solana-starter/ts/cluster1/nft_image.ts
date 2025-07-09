import wallet from "../turbin3-wallet.json";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createGenericFile,
  createSignerFromKeypair,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { readFile } from "fs/promises";
import path from "path";
import { mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";

// Create a devnet connection
const umi = createUmi("https://api.devnet.solana.com");

let keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const signer = createSignerFromKeypair(umi, keypair);

//umi.use(mplTokenMetadata());
umi.use(
  irysUploader({
    address: "https://devnet.irys.xyz",
  })
);
umi.use(signerIdentity(signer));

const rug_name = "oriental.png";

(async () => {
  try {
    //1. Load image
    const file_path = path.join(__dirname, "/rugs/", rug_name);
    //check if file exists
    if (!file_path) {
      throw new Error("File not found");
    } else {
      console.log("File: ", file_path.toString());
    }
    const imageFile = await readFile(file_path);

    //2. Convert image to generic file.
    const umiImageFile = createGenericFile(imageFile, rug_name, {
      tags: [{ name: "Content-Type", value: "image/png" }],
    });

    //3. Upload image
    const imageUri = await umi.uploader.upload([umiImageFile]).catch((err) => {
      throw new Error(err);
    });

    console.log("Your image URI: ", imageUri[0], "\n");
  } catch (error) {
    console.log("Oops.. Something went wrong", error);
  }
})();

//Your image URI:  https://gateway.irys.xyz/GSYT2mmURM2yyzCgZYStaZa4gjyNidM75Wz5egssrUvc
