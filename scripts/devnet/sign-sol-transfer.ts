import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getConnection, loadKeypair, writeSignedTransaction } from "./lib.js";

const keypair = await loadKeypair();
const recipient = new PublicKey(
  process.argv[2] ?? keypair.publicKey.toBase58(),
);
const lamports = BigInt(process.argv[3] ?? "1");

if (lamports <= 0n) {
  throw new Error("Lamports must be a positive integer");
}

const connection = getConnection();
const latestBlockhash = await connection.getLatestBlockhash();
const instruction = SystemProgram.transfer({
  fromPubkey: keypair.publicKey,
  toPubkey: recipient,
  lamports,
});

const message = new TransactionMessage({
  payerKey: keypair.publicKey,
  recentBlockhash: latestBlockhash.blockhash,
  instructions: [instruction],
}).compileToV0Message();

const transaction = new VersionedTransaction(message);
transaction.sign([keypair]);

const serializedBase64 = Buffer.from(transaction.serialize()).toString(
  "base64",
);
const outputPath = await writeSignedTransaction(
  "signed-sol-transfer",
  serializedBase64,
);

console.log("Signed devnet SOL transfer transaction");
console.log(`From: ${keypair.publicKey.toBase58()}`);
console.log(`To: ${recipient.toBase58()}`);
console.log(
  `Lamports: ${lamports.toString()} (${Number(lamports) / LAMPORTS_PER_SOL} SOL)`,
);
console.log(`Output: ${outputPath}`);
