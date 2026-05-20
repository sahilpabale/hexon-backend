import { existsSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import { keypairPath, writeKeypair } from "./lib.js";

if (existsSync(keypairPath) && process.env.FORCE !== "true") {
  throw new Error(
    `Keypair already exists at ${keypairPath}. Set FORCE=true to overwrite it.`,
  );
}

const keypair = Keypair.generate();
await writeKeypair(keypair);

console.log(`Devnet keypair written to ${keypairPath}`);
console.log(`Public address: ${keypair.publicKey.toBase58()}`);
