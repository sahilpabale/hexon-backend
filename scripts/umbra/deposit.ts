import { getATAIntoETADirectDepositorFunction } from "@umbra-privacy/sdk/deposit";
import type { IUmbraSigner } from "@umbra-privacy/sdk";
import {
  getDevnetUmbraClient,
  getDevnetUsdcMintOrThrow,
  jsonSafe,
  printUmbraError,
} from "./lib.js";

type Address = IUmbraSigner["address"];

const amount = BigInt(process.argv[2] ?? "1000000");
if (amount <= 0n) {
  throw new Error("Deposit amount must be a positive integer in base units");
}

const client = await getDevnetUmbraClient();
const mint = getDevnetUsdcMintOrThrow();
const deposit = getATAIntoETADirectDepositorFunction({ client });

console.log(`Umbra network: ${client.network}`);
console.log(`Umbra program: ${client.networkConfig.programId}`);
console.log(`Wallet: ${client.signer.address}`);
console.log(`Mint: ${mint}`);
console.log(`Amount: ${amount.toString()} base units`);

try {
  const result = await deposit(
    client.signer.address,
    mint as Address,
    amount as Parameters<typeof deposit>[2],
  );
  console.log(jsonSafe(result));
} catch (error) {
  printUmbraError(error);
  process.exitCode = 1;
}
