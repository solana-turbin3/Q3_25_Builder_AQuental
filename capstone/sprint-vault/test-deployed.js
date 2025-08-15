const anchor = require("@coral-xyz/anchor");
const { Connection, PublicKey } = require("@solana/web3.js");

async function main() {
  console.log("🚀 Testing deployed programs...\n");
  
  const connection = new Connection("http://localhost:8899", "confirmed");
  
  const programs = {
    "Sprint Vault": "2XMnUCRiLzaqt3Egt9mfUUo3T9bs6BBnrcE6AQavpx1f",
    "Vault": "5Q5YAzz8Hb2F37qQ3ztmyhEqCQyRswUagUPYJK6bWP4y",
    "Bounty": "8qvnjVHuK27Wbzhe5HCuXybDLRN41t5LAZ9BgNKpiymh"
  };
  
  for (const [name, address] of Object.entries(programs)) {
    try {
      const programId = new PublicKey(address);
      const accountInfo = await connection.getAccountInfo(programId);
      
      if (accountInfo && accountInfo.executable) {
        console.log(`✅ ${name}: Deployed and executable`);
        console.log(`   Address: ${address}`);
        console.log(`   Data length: ${accountInfo.data.length} bytes`);
      } else {
        console.log(`❌ ${name}: Not found or not executable`);
      }
    } catch (error) {
      console.log(`❌ ${name}: Error checking - ${error.message}`);
    }
  }
  
  console.log("\n✨ Program deployment check complete!");
}

main().catch(console.error);
