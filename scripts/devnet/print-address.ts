import { keypairPath, loadKeypair, solanaNetwork } from "./lib.js";

const keypair = await loadKeypair();

console.log(`Keypair path: ${keypairPath}`);
console.log(`Network: ${solanaNetwork}`);
console.log(`Public address: ${keypair.publicKey.toBase58()}`);
