import { Keypair } from "@solana/web3.js";

//Generate a new keypair
let kp = Keypair.generate();
console.log(`You've generated a new Solana wallet:
    ${kp.publicKey.toBase58()}
    `);

/*
3iEGhQ17vMwf5VyV521SDxTmH3ujJ9BGDcNJs63kbuMj
[40, 71, 49, 50, 64, 158, 158, 30, 118, 171, 145, 49, 127, 7, 133,
 185, 99, 104, 104, 236, 115, 34, 139, 39, 159, 171, 116, 249, 165,
 212, 33, 130]


[34, 46, 55, 124, 141, 190, 24, 204, 134, 91, 70, 184, 161, 181, 44, 122, 15, 172, 63, 62, 153, 150, 99, 255, 202, 89, 105, 77, 41, 89, 253, 130, 27, 195, 134, 14, 66, 75, 242, 7, 132, 234, 160, 203, 109, 195, 116, 251, 144, 44, 28, 56, 231, 114, 50, 131, 185, 168, 138, 61, 35, 98, 78, 53]
pk is: "gdtKSTXYULQNx87fdD3YgXkzVeyFeqwtxHm6WdEb5a9YJRnHse7GQr7t5pbepsyvUCk7VvksUGhPt4SZ8JHVSkt"

*/
