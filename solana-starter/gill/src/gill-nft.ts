import { Gill } from "gill";
import fs from "fs";
import path from "path";
import wallet from "../turbin3-wallet.json";

const createNft = async () => {
  try {
    // Initialize Gill with Solana Devnet and wallet
    const gill = new Gill({
      cluster: "https://api.devnet.solana.com",
      secretKey: new Uint8Array(wallet), // Load wallet secret key
      storage: {
        type: "irys",
        config: {
          address: "https://devnet.irys.xyz",
        },
      },
    });

    // Read the image file
    const rug_name = "scott-ian.png";
    const imageFile = fs.readFileSync(path.join(__dirname, "/rugs/", rug_name));

    // Define NFT metadata
    const metadata: GillNftMetadata = {
      name: "Jeff rocker",
      description: "Jeff themed rug",
      image: {
        file: imageFile,
        fileName: rug_name,
        contentType: "image/png",
      },
      external_url: "https://example.com/oriental",
      attributes: [
        { trait_type: "creator", value: "aquental" },
        { trait_type: "program", value: "turbin3" },
        { trait_type: "cohort", value: "Q3" },
        { trait_type: "year", value: "2025" },
      ],
      properties: {
        files: [{ type: "image/png" }], // Note: URI is handled by Gill
        category: "image",
      },
    };

    // Create the NFT using Gill
    console.log("Creating NFT...");
    const result = await createNFT(gill, {
      metadata,
      sellerFeeBasisPoints: 550, // 5.5% (in basis points)
      amount: 0.01, // 0.01 SOL
      ruleset: null, // Optional: Set to Metaplex or compatibility ruleset if needed
    });

    // Log the results
    console.log("\npNFT Created");
    console.log("View Transaction on Solana Explorer");
    console.log(
      `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`
    );
    console.log("\nView NFT on Metaplex Explorer");
    console.log(
      `https://explorer.solana.com/address/${result.mint}?cluster=devnet`
    );
  } catch (err) {
    console.error("Error creating NFT:", err);
    throw err;
  }
};

createNft();
