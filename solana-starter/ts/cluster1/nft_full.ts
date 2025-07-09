import {
  createProgrammableNft,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createGenericFile,
  createSignerFromKeypair,
  generateSigner,
  percentAmount,
  publicKey,
  signerIdentity,
  sol,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys";
import { base58 } from "@metaplex-foundation/umi/serializers";
import fs from "fs";
import path from "path";
import wallet from "../turbin3-wallet.json";

const createNft = async () => {
  // Setting Up Umi
  const umi = createUmi("https://api.devnet.solana.com")
    .use(mplTokenMetadata())
    .use(
      irysUploader({
        address: "https://devnet.irys.xyz",
      })
    );

  let keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
  const signer = createSignerFromKeypair(umi, keypair);
  umi.use(signerIdentity(signer));
  // Upload an image to Arweave

  // use `fs` to read file via a string path.
  // You will need to understand the concept of pathing from a computing perspective.
  const rug_name = "scott-ian.png";
  const imageFile = fs.readFileSync(path.join(__dirname, "/rugs/", rug_name));

  // Use `createGenericFile` to transform the file into a `GenericFile` type
  // that umi can understand. Make sure you set the mimi tag type correctly
  // otherwise Arweave will not know how to display your image.

  const umiImageFile = createGenericFile(imageFile, rug_name, {
    tags: [{ name: "Content-Type", value: "image/png" }],
  });

  // Here we upload the image to Arweave via Irys and we get returned a uri
  // address where the file is located. You can log this out but as the
  // uploader can takes an array of files it also returns an array of uris.
  // To get the uri we want we can call index [0] in the array.

  console.log("Uploading image...");
  const imageUri = await umi.uploader.upload([umiImageFile]).catch((err) => {
    throw new Error(err);
  });

  //
  // ** Upload Metadata to Arweave **
  //

  const metadata = {
    name: "Jeff rocker",
    description: "Jeff themed rug",
    image: imageUri[0],
    external_url: "https://example.com/oriental",
    attributes: [
      {
        trait_type: "creator",
        value: "aquental",
      },
      {
        trait_type: "program",
        value: "turbin3",
      },
      {
        trait_type: "cohort",
        value: "Q3",
      },
      {
        trait_type: "year",
        value: "2025",
      },
    ],
    properties: {
      files: [
        {
          uri: imageUri[0],
          type: "image/png",
        },
      ],
      category: "image",
    },
  };

  // Call upon umi's uploadJson function to upload our metadata to Arweave via Irys.
  console.log("Uploading metadata...");
  const metadataUri = await umi.uploader.uploadJson(metadata).catch((err) => {
    throw new Error(err);
  });

  //
  // ** Creating the Nft **
  //

  // We generate a signer for the Nft
  const nftSigner = generateSigner(umi);

  // Decide on a price for the Nft.
  const price = sol(0.01);

  // Decide on a ruleset for the Nft.
  // Metaplex ruleset - publicKey("eBJLFYPxJmMGKuFwpDWkzxZeUrad92kZRC5BJLpzyT9")
  // Compatibility ruleset - publicKey("AdH2Utn6Fus15ZhtenW4hZBQnvtLgM1YCW2MfVp7pYS5")
  const ruleset = null; // or set a publicKey from above

  console.log("Creating Nft...");
  const tx = await createProgrammableNft(umi, {
    mint: nftSigner,
    sellerFeeBasisPoints: percentAmount(5.5),
    name: metadata.name,
    uri: metadataUri,
    ruleSet: ruleset,
  }).sendAndConfirm(umi);

  // Finally we can deserialize the signature that we can check on chain.
  const signature = base58.deserialize(tx.signature)[0];

  // Log out the signature and the links to the transaction and the NFT.
  console.log("\npNFT Created");
  console.log("View Transaction on Solana Explorer");
  console.log(`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  console.log("\n");
  console.log("View NFT on Metaplex Explorer");
  console.log(
    `https://explorer.solana.com/address/${nftSigner.publicKey}?cluster=devnet`
  );
};

createNft();
