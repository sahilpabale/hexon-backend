import { getUserAccountQuerierFunction } from "@umbra-privacy/sdk/query";
import { getDevnetUmbraClient, jsonSafe } from "./lib.js";

const client = await getDevnetUmbraClient();
const query = getUserAccountQuerierFunction({ client });
const result = await query(client.signer.address);

console.log(`Umbra network: ${client.network}`);
console.log(`Umbra program: ${client.networkConfig.programId}`);
console.log(`Wallet: ${client.signer.address}`);
console.log(jsonSafe(result));
