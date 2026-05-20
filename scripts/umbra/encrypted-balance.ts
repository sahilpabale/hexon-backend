import { getEncryptedBalanceQuerierFunction } from "@umbra-privacy/sdk/query";
import type { IUmbraSigner } from "@umbra-privacy/sdk";
import {
  getDevnetUmbraClient,
  getDevnetUsdcMintOrThrow,
  jsonSafe,
} from "./lib.js";

type Address = IUmbraSigner["address"];

const client = await getDevnetUmbraClient();
const mint = (process.argv[2] ?? getDevnetUsdcMintOrThrow()) as Address;
const query = getEncryptedBalanceQuerierFunction({ client });
const result = await query([mint]);

console.log(`Umbra network: ${client.network}`);
console.log(`Umbra program: ${client.networkConfig.programId}`);
console.log(`Wallet: ${client.signer.address}`);
console.log(`Mint: ${mint}`);
console.log(jsonSafe(result.get(mint)));
