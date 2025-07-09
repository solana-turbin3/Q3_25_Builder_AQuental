#[cfg(test)]
mod tests {
    //use super::*;
    use bs58;
    use solana_client::rpc_client::RpcClient;
    use solana_sdk::{
        instruction::{AccountMeta, Instruction},
        message::Message,
        pubkey::Pubkey,
        signature::{Keypair, Signer},
        signer::keypair::read_keypair_file,
        system_instruction::transfer,
        transaction::Transaction,
    };
    use std::str::FromStr;
    pub const TURBIN3_WALLET: &str = "turbin3-wallet.json";
    pub const TURBIN3_PUB_KEY: &str = "Dn2ucNUVe5ptVueYRKf6m6effxs13RJpjJEMfEL9yMzG";
    pub const DEV_WALLET: &str = "dev-wallet.json";
    const RPC_URL: &str =
        "https://turbine-solanad-4cde.devnet.rpcpool.com/9a9da9cf-6db1-47dc-839a-55aca5c9c80a";
    #[test]
    fn base58_to_wallet() {
        let pvt_key = "2SjGRsmREMsHCvpgUkf5yjm4JfkdjY7USBWwW9LVxt7VdDc1gFTWyPkXfrySw1sr99UrfRh6szoQ7gnonzRC8hFG";
        println!("Input your private key as a base58 string: {}", pvt_key);
        let base58 = pvt_key.lines().next().unwrap();
        println!("Your wallet file format is:");
        let wallet = bs58::decode(base58).into_vec().unwrap();
        println!("{:?}", wallet);
    }

    #[test]
    fn wallet_to_base58() {
        println!("Your private key as a JSON byte array is:");
        let byte_array = "[72, 52, 88, 98, 249, 84, 183, 151, 226, 215, 97, 156, 164, 119, 143, 110, 22, 145, 187, 255, 124, 166, 106, 215, 116, 142, 236, 33, 6, 102, 97, 28, 31, 15, 6, 255, 105, 241, 15, 83, 186, 125, 57, 180, 245, 253, 113, 156, 57, 124, 151, 75, 245, 252, 97, 139, 243, 5, 237, 102, 95, 174, 151, 99]";
        let wallet = byte_array
            .trim_start_matches('[')
            .trim_end_matches(']')
            .split(',')
            .map(|s| s.trim().parse::<u8>().unwrap())
            .collect::<Vec<u8>>();
        println!("Your Base58-encoded private key is:");
        let base58 = bs58::encode(wallet).into_string();
        println!("{:?}", base58);
    }

    #[test]
    fn keygen() {
        // Create a new keypair
        let kp = Keypair::new();
        println!(
            "You've generated a new Solana wallet: {}",
            kp.pubkey().to_string()
        );
        println!("\nTo save your wallet, copy and paste the following into a JSON file:");
        println!("{:?}", kp.to_bytes());
    }

    #[test]
    fn claim_airdrop() {
        // let's read our keypair file
        let keypair = read_keypair_file(DEV_WALLET).expect("Couldn't find wallet file");
        // Connected to Solana Devnet RPC Client
        let client = RpcClient::new(RPC_URL);
        // Now, we're gonna claim 2 SOL
        match client.request_airdrop(&keypair.pubkey(), 2_000_000_000u64) {
            Ok(s) => {
                println!("Airdrop success! Check out your TX here");
                println!(
                    "https://explorer.solana.com/tx/{}?cluster=devnet",
                    s.to_string()
                );
            }
            Err(e) => println!("Oops, Something went wrong: {}", e.to_string()),
        };
    }

    #[test]
    fn transfer_sol() {
        // Let's get our dev-wallet.json file
        let keypair = read_keypair_file(DEV_WALLET).expect("Couldn't find wallet file");
        // Generate a signature from the keypair
        let pubkey = keypair.pubkey();

        let message_bytes = b"I verify my Solana Keypair!";
        let sig = keypair.sign_message(message_bytes);
        println!(
            "PubKey: {}, message: {:?}, signature: {}",
            pubkey.to_string(),
            message_bytes,
            sig.to_string()
        );
        // Verify the signature using the public key
        match sig.verify(&pubkey.to_bytes(), message_bytes) {
            true => println!("Signature verified"),
            false => println!("Verification failed"),
        }
        // Define our Turbin3 public key
        let to_pubkey = Pubkey::from_str(TURBIN3_PUB_KEY).unwrap();
        // Create a solana devnet connection
        let rpc_client = RpcClient::new(RPC_URL);
        let recent_blockhash = rpc_client
            .get_latest_blockhash()
            .expect("Failed to get recent blockhash");
        println!("Latest blockhash: {}", recent_blockhash);
        //Create and sign the transaction
        let transaction = Transaction::new_signed_with_payer(
            &[transfer(&keypair.pubkey(), &to_pubkey, 1_000_000)],
            Some(&keypair.pubkey()),
            &vec![&keypair],
            recent_blockhash,
        );
        // Send the transaction and print tx
        let signature = rpc_client
            .send_and_confirm_transaction(&transaction)
            .expect("Failed to send transaction");
        println!(
            "Success! Check out your TX here: https://explorer.solana.com/tx/{}/?cluster=devnet",
            signature
        );

        //Get current balance
        let balance = rpc_client
            .get_balance(&keypair.pubkey())
            .expect("Failed to get balance");
        println!("Current balance: {}", balance);
        //Build a mock transaction to calculate fee
        let message = Message::new_with_blockhash(
            &[transfer(&keypair.pubkey(), &to_pubkey, balance)],
            Some(&keypair.pubkey()),
            &recent_blockhash,
        );
        //Estimate transaction fee
        let fee = rpc_client
            .get_fee_for_message(&message)
            .expect("Failed to get fee calculator");
        println!("Fee: {}", fee);
        println!("Balance minus fee: {}", balance - fee);
        //Create final transaction with balance minus fee
        let transaction = Transaction::new_signed_with_payer(
            &[transfer(&keypair.pubkey(), &to_pubkey, balance - fee)],
            Some(&keypair.pubkey()),
            &vec![&keypair],
            recent_blockhash,
        );
        //Send transaction and verify
        let signature = rpc_client
            .send_and_confirm_transaction(&transaction)
            .expect("Failed to send final transaction");
        println!(
            "Success! Entire balance transferred: https://explorer.solana.com/tx/{}/?cluster=devnet",
            signature
        );
    }

    #[test]
    fn enroll() {
        //Create a Solana RPC client
        let rpc_client = RpcClient::new(RPC_URL);
        //Load your signer keypair (Turbin3)
        let signer = read_keypair_file(TURBIN3_WALLET).expect("Couldn't find wallet file");
        //Define program and account public keys
        let mint = Keypair::new();
        let turbin3_prereq_program =
            Pubkey::from_str("TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM").unwrap();
        let collection = Pubkey::from_str("5ebsp5RChCGK7ssRZMVMufgVZhd2kFbNaotcZ5UvytN2").unwrap();
        let mpl_core_program =
            Pubkey::from_str("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d").unwrap();
        let system_program = solana_program::system_program::id();
        //Get the PDA (Program Derived Address)
        let signer_pubkey = signer.pubkey();
        let seeds = &[b"prereqs", signer_pubkey.as_ref()];
        let (prereq_pda, _bump) = Pubkey::find_program_address(seeds, &turbin3_prereq_program);
        // Authority (PDA)
        let (authority, _authority_bump) =
            Pubkey::find_program_address(&[b"collection", collection.as_ref()], &mpl_core_program);

        //Prepare the instruction data (discriminator)
        let data = vec![77, 124, 82, 163, 21, 133, 181, 206];
        //Define the accounts metadata
        let accounts = vec![
            AccountMeta::new(signer.pubkey(), true),     //user signer
            AccountMeta::new(prereq_pda, false),         //PDA account
            AccountMeta::new(mint.pubkey(), true),       //mint keypair
            AccountMeta::new(collection, false),         // collection
            AccountMeta::new_readonly(authority, false), // authority (PDA)
            AccountMeta::new_readonly(mpl_core_program, false), // mpl core program
            AccountMeta::new_readonly(system_program, false), // system program
        ];
        //Get the recent blockhash
        let blockhash = rpc_client
            .get_latest_blockhash()
            .expect("Failed to get recent blockhash");
        //println!("Blockhash: {}", blockhash);
        //Build the instruction
        let instruction = Instruction {
            program_id: turbin3_prereq_program,
            accounts,
            data,
        };
        //println!("Instruction: {:#?}", instruction);
        //Create and sign the transaction
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&signer.pubkey()),
            &[&signer, &mint],
            blockhash,
        );
        //println!("Transaction: {:#?}", transaction);
        // Send and confirm the transaction
        let signature = rpc_client
            .send_and_confirm_transaction(&transaction)
            .expect("Failed to send transaction");
        println!(
            "Success! Check out your TX here:\nhttps://explorer.solana.com/tx/{}/?cluster=devnet",
            signature
        );
    }
}
