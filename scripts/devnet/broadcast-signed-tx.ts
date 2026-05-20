import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VersionedTransaction } from "@solana/web3.js";
import { getConnection, requireArg } from "./lib.js";

const inputPath = resolve(
  requireArg(
    process.argv[2] ?? process.env.DEVNET_SIGNED_TX_PATH,
    "signed transaction file path",
  ),
);
const serializedBase64 = (await readFile(inputPath, "utf8")).trim();
const transaction = VersionedTransaction.deserialize(
  Buffer.from(serializedBase64, "base64"),
);
const connection = getConnection();
const signature = await connection.sendTransaction(transaction, {
  maxRetries: 3,
  skipPreflight: false,
});

console.log(`Broadcasted transaction from ${inputPath}`);
console.log(`Signature: ${signature}`);
