import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, Wallet, AnchorProvider } from "@coral-xyz/anchor";
import { Q3PreReqsRs, IDL } from "./programs/Turbin3_prereq";
import wallet from "./turbin3-wallet.json";
const MPL_CORE_PROGRAM_ID = new PublicKey(
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
);

//const ENDPOINT = "https://polished-warmhearted-frog.solana-devnet.quiknode.pro/9bc0c3437243817577c59c3690d3bcde03fe8b6f/";
const ENDPOINT = "https://api.devnet.solana.com";

// We're going to import our keypair from the wallet file
const keypair = Keypair.fromSecretKey(new Uint8Array(wallet));
// Create a devnet connection
const connection = new Connection(ENDPOINT);
// Github account
const github_account = "aquental";
// Create our anchor provider
const provider = new AnchorProvider(connection, new Wallet(keypair), {
  commitment: "confirmed",
});

// Create our program
const program: Program<Q3PreReqsRs> = new Program(IDL, provider);

// Create the PDA for our enrollment account
const account_seeds = [Buffer.from("prereqs"), keypair.publicKey.toBuffer()];
const [enrollment_key, _bump] = PublicKey.findProgramAddressSync(
  account_seeds,
  program.programId
);

// Execute the initialize transaction
(async () => {
  try {
    const txhash = await program.methods
      .initialize(github_account)
      .accountsPartial({
        user: keypair.publicKey, // your public key (the one you use for the Turbin3 application)
        account: enrollment_key, // an account that will be created by our program with a custom PDA seed
        systemProgram: SystemProgram.programId, // the system program
      })
      .signers([keypair])
      .rpc();
    console.log(
      `Success! Check out your initialize TX here: https://explorer.solana.com/tx/${txhash}?cluster=devnet`
    );
  } catch (e) {
    console.error(`Oops, something went wrong with initialize: ${e}`);
  }
})();
//Success! Check out your initialize TX here: https://explorer.solana.com/tx/rCCgBhUzZ9g5Tqon9yZc3g7VcjfwVExd7rFJ6oHSkmdm7UAwaU1caEFvxyHzEHHxqAFtHV5auHdHZEqqrrvDHfV?cluster=devnet

// Address of collection
const mintCollection = new PublicKey(
  "5ebsp5RChCGK7ssRZMVMufgVZhd2kFbNaotcZ5UvytN2"
);
const mintTs = Keypair.generate();

// Execute the submitTs transaction
(async () => {
  try {
    const txhash = await program.methods
      .submitTs()
      .accountsPartial({
        user: keypair.publicKey, // your public key (the one you use for the Turbin3 application)
        account: enrollment_key, // the account created by our program (see above)
        mint: mintTs.publicKey, // the address of the new asset (that will be created by our program)
        collection: mintCollection, // the collection to which the asset belongs
        mplCoreProgram: MPL_CORE_PROGRAM_ID, // the authority signing for the creation of the NFT (also a PDA)
        systemProgram: SystemProgram.programId, // the system program
      })
      .signers([keypair, mintTs])
      .rpc();
    console.log(
      `Success! Check out your submitTs TX here: https://explorer.solana.com/tx/${txhash}?cluster=devnet`
    );
  } catch (e) {
    console.error(`Oops, something went wrong with submitTs: ${e}`);
  }
})();
//Success! Check out your submitTs TX here: https://explorer.solana.com/tx/4UKBHJcQw89heXsMWZSLnfcQPmHAohLhCn3tuE2V2goQuEDvJZozcXA5LccoMid9PnruvGP6epfP5xwoZRG61uvC?cluster=devnet
