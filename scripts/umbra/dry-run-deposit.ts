import { getATAIntoETADirectDepositorFunction } from "@umbra-privacy/sdk/deposit";
import type { IUmbraSigner, SignedTransaction, TransactionSignature } from "@umbra-privacy/sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { getDevnetUmbraClient, jsonSafe } from "./lib.js";

type Address = IUmbraSigner["address"];

// Default: 1_000_000 lamports = 0.001 wSOL
const amount = BigInt(process.argv[2] ?? "1000000");
if (amount <= 0n) {
  throw new Error(
    "Dry-run deposit amount must be a positive integer in lamports",
  );
}

const client = await getDevnetUmbraClient();
const mint = NATIVE_MINT.toBase58();
const deposit = getATAIntoETADirectDepositorFunction(
  { client },
  {
    rpc: {
      transactionForwarder: {
        forwardSequentially: (transactions: readonly SignedTransaction[]) => {
          console.log(
            `Forwarder received ${transactions.length} transaction(s)`,
          );
          console.log(jsonSafe(transactions[0]));
          return Promise.resolve(["DRY_RUN_SIGNATURE" as TransactionSignature]);
        },
        forwardInParallel: (transactions: readonly SignedTransaction[]) =>
          Promise.resolve(
            transactions.map(() => "DRY_RUN_SIGNATURE" as TransactionSignature),
          ),
        fireAndForget: () =>
          Promise.resolve("DRY_RUN_SIGNATURE" as TransactionSignature),
      },
    },
    arcium: {
      awaitComputationFinalization: false,
    },
  },
);

console.log(`Umbra network: ${client.network}`);
console.log(`Umbra program: ${client.networkConfig.programId}`);
console.log(`Wallet: ${client.signer.address}`);
console.log(`Mint: ${mint} (wSOL)`);
console.log(`Amount: ${amount.toString()} lamports`);

const result = await deposit(
  client.signer.address,
  mint as Address,
  amount as Parameters<typeof deposit>[2],
);
console.log(jsonSafe(result));
