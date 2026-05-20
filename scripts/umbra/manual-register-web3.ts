import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const rpc =
  process.env.HELIUS_DEVNET_RPC_URL ??
  process.env.SOLANA_RPC_URL ??
  "https://api.devnet.solana.com";
const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(".devnet/keypair.json", "utf8")) as number[],
  ),
);
const programId = new PublicKey("DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ");

const [userAccount] = PublicKey.findProgramAddressSync(
  [
    Buffer.from([
      238, 187, 82, 14, 65, 210, 89, 81, 200, 33, 148, 214, 254, 44, 85, 185,
      87, 34, 232, 49, 142, 202, 28, 145, 26, 69, 88, 138, 177, 236, 249, 175,
    ]),
    payer.publicKey.toBuffer(),
  ],
  programId,
);
const [protocolConfig] = PublicKey.findProgramAddressSync(
  [
    Buffer.from([
      159, 100, 53, 16, 217, 113, 43, 203, 167, 5, 163, 74, 88, 105, 189, 194,
      208, 152, 173, 184, 208, 3, 163, 55, 229, 49, 254, 115, 201, 134, 96, 90,
    ]),
  ],
  programId,
);

const data = Buffer.concat([
  Buffer.from([62, 135, 35, 139, 115, 81, 113, 227]),
  Buffer.alloc(32, 7),
  Buffer.alloc(32),
]);
const transaction = new Transaction().add(
  new TransactionInstruction({
    programId,
    keys: [
      { pubkey: userAccount, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: false, isWritable: false },
      { pubkey: protocolConfig, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  }),
);

console.log(`RPC: ${rpc.replace(/api-key=.*/, "api-key=***")}`);
console.log(`Wallet: ${payer.publicKey.toBase58()}`);
console.log(`User account PDA: ${userAccount.toBase58()}`);
console.log(`Protocol config PDA: ${protocolConfig.toBase58()}`);
console.log(
  `Instruction discriminator: ${data.subarray(0, 8).toString("hex")}`,
);

try {
  const connection = new Connection(rpc, "confirmed");
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [payer],
    {
      commitment: "confirmed",
    },
  );
  console.log(`Signature: ${signature}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  const logs = (error as { logs?: string[] }).logs;
  if (logs) {
    for (const log of logs) {
      console.error(log);
    }
  }
  process.exitCode = 1;
}
