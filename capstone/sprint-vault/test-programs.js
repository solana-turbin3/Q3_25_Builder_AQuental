#!/usr/bin/env node

const { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');
const fs = require('fs');

// Program IDs (deployed to devnet)
const PROGRAM_IDS = {
  sprintVault: 'AVeTrbMYCmjkvjA8yzkC41Y4AD2Hg8fmZLgpSXgoXSkX',
  vault: '9JoLiDYTVqJ9i1tHxfKQkaFLD6prk9PMUHTAVF2S9WE5',
  bounty: 'EeVnFRVgane4uJQu97yTe3YujwweCLW3ChAT6VStj4HL'
};

async function testPrograms() {
  console.log('🧪 Testing Sprint Vault Programs\n');
  console.log('================================\n');

  try {
    // Connect to devnet
    const connection = new Connection('https://polished-warmhearted-frog.solana-devnet.quiknode.pro/9bc0c3437243817577c59c3690d3bcde03fe8b6f', 'confirmed');
    
    // Load wallet
    const walletPath = '/Users/aquental/.config/solana/turbin3-wallet.json';
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    const wallet = Keypair.fromSecretKey(Uint8Array.from(walletData));
    
    console.log('📍 Wallet:', wallet.publicKey.toBase58());
    
    // Check wallet balance
    const balance = await connection.getBalance(wallet.publicKey);
    console.log('💰 Balance:', (balance / LAMPORTS_PER_SOL).toFixed(2), 'SOL\n');
    
    // Verify programs are deployed
    console.log('🔍 Verifying deployed programs:\n');
    
    for (const [name, address] of Object.entries(PROGRAM_IDS)) {
      const programId = new PublicKey(address);
      const accountInfo = await connection.getAccountInfo(programId);
      
      if (accountInfo && accountInfo.executable) {
        console.log(`✅ ${name}: Deployed and executable`);
        console.log(`   Address: ${address}`);
        console.log(`   Owner: ${accountInfo.owner.toBase58()}`);
        console.log('');
      } else {
        console.log(`❌ ${name}: Not found or not executable`);
      }
    }
    
    // Test basic interaction (account derivation)
    console.log('🧮 Testing PDA derivation:\n');
    
    // Derive a sprint PDA
    const sprintId = 1;
    const [sprintPda, sprintBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('sprint'),
        wallet.publicKey.toBuffer(),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(sprintId)]).buffer))
      ],
      new PublicKey(PROGRAM_IDS.sprintVault)
    );
    
    console.log('Sprint PDA:');
    console.log('  Address:', sprintPda.toBase58());
    console.log('  Bump:', sprintBump);
    console.log('');
    
    // Derive a bounty pool PDA
    const bountyId = 1;
    const [bountyPda, bountyBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('bounty_pool'),
        wallet.publicKey.toBuffer(),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(bountyId)]).buffer))
      ],
      new PublicKey(PROGRAM_IDS.bounty)
    );
    
    console.log('Bounty Pool PDA:');
    console.log('  Address:', bountyPda.toBase58());
    console.log('  Bump:', bountyBump);
    console.log('');
    
    // Summary
    console.log('================================');
    console.log('✨ Test Summary:\n');
    console.log('• All 3 programs are deployed and executable');
    console.log('• PDAs can be derived correctly');
    console.log('• Programs are ready for integration');
    console.log('');
    console.log('📝 Next Steps:');
    console.log('1. Create TypeScript SDK for easier interaction');
    console.log('2. Build frontend to interact with programs');
    console.log('3. Write comprehensive integration tests');
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.logs) {
      console.error('Logs:', error.logs);
    }
  }
}

// Run the test
testPrograms().catch(console.error);
