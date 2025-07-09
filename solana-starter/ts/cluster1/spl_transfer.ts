import {
  Commitment,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import wallet from "../turbin3-wallet.json";
import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";

// We're going to import our keypair from the wallet file
const keypair = Keypair.fromSecretKey(new Uint8Array(wallet));

//Create a Solana devnet connection
const commitment: Commitment = "confirmed";
const connection = new Connection("https://api.devnet.solana.com", commitment);

const toKeypair = Keypair.generate();
// Mint address
const mint = new PublicKey("xxxxxxxxxxxxxxxxxx");

// Recipient address
const to = new PublicKey("Dn2ucNUVe5ptVueYRKf6m6effxs13RJpjJEMfEL9yMzG");

(async () => {
  try {
    // Get the token account of the fromWallet address, and if it does not exist, create it
    const fromWalletAta = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      mint,
      keypair.publicKey
    );
    // Get the token account of the toWallet address, and if it does not exist, create it
    const toWalletAta = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      mint,
      toKeypair.publicKey
    );
    // Transfer the new token to the "toTokenAccount" we just created

    const tx = await transfer(
      connection,
      keypair,
      fromWalletAta.address,
      toWalletAta.address,
      keypair,
      10
    );

    console.log("tx id: ", tx);
  } catch (e) {
    console.error(`Oops, something went wrong: ${e}`);
  }
})();
