import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getConnection,
  loadKeypair,
  requireArg,
  writeSignedTransaction,
} from "./lib.js";

const keypair = await loadKeypair();
const recipient = new PublicKey(
  requireArg(process.argv[2], "recipient public key"),
);
const amount = BigInt(process.argv[3] ?? "1");
const mint = new PublicKey(
  requireArg(process.env.DEVNET_USDC_MINT, "DEVNET_USDC_MINT"),
);
const decimals = Number(process.env.DEVNET_USDC_DECIMALS ?? "6");

if (amount <= 0n) {
  throw new Error("USDC amount must be a positive integer in base units");
}

const connection = getConnection();
const sourceAta = await getAssociatedTokenAddress(mint, keypair.publicKey);
const destinationAta = await getAssociatedTokenAddress(mint, recipient);
const instructions = [];
const destinationInfo = await connection.getAccountInfo(destinationAta);

if (!destinationInfo) {
  instructions.push(
    createAssociatedTokenAccountInstruction(
      keypair.publicKey,
      destinationAta,
      recipient,
      mint,
    ),
  );
}

instructions.push(
  createTransferCheckedInstruction(
    sourceAta,
    mint,
    destinationAta,
    keypair.publicKey,
    amount,
    decimals,
  ),
);

const latestBlockhash = await connection.getLatestBlockhash();
const message = new TransactionMessage({
  payerKey: keypair.publicKey,
  recentBlockhash: latestBlockhash.blockhash,
  instructions,
}).compileToV0Message();

const transaction = new VersionedTransaction(message);
transaction.sign([keypair]);

const serializedBase64 = Buffer.from(transaction.serialize()).toString(
  "base64",
);
const outputPath = await writeSignedTransaction(
  "signed-usdc-transfer",
  serializedBase64,
);

console.log("Signed devnet USDC transfer transaction");
console.log(`From: ${keypair.publicKey.toBase58()}`);
console.log(`To: ${recipient.toBase58()}`);
console.log(`Mint: ${mint.toBase58()}`);
console.log(`Base units: ${amount.toString()}`);
console.log(`Output: ${outputPath}`);
