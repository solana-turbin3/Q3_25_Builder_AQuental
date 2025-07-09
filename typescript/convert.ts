import bs58 from "bs58";
import prompt from "prompt-sync";

function base58ToByteArray(base58Key: string): Uint8Array {
  return bs58.decode(base58Key);
}
const base58PrivateKey = "base58PrivateKey"; //switched for security reasons
const byteArray = base58ToByteArray(base58PrivateKey);

console.log("Byte Array:", byteArray);
//pasted to  Turbin3-wallet.json
