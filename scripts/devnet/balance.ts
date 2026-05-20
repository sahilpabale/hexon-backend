import { getPublicBalances } from "../../src/services/balances.js";
import { loadKeypair, requireArg, rpcUrl, solanaNetwork } from "./lib.js";

const walletAddress =
  process.argv[2] ?? (await loadKeypair()).publicKey.toBase58();
requireArg(walletAddress, "wallet address");

const balances = await getPublicBalances(walletAddress);

console.log(`Network: ${solanaNetwork}`);
console.log(`RPC: ${rpcUrl.replace(/api-key=[^&]+/, "api-key=***")}`);
console.log(`Wallet: ${walletAddress}`);
for (const balance of balances) {
  console.log(
    `${balance.asset}: ${balance.uiAmount} (${balance.amount} base units)`,
  );
  console.log(`  Mint: ${balance.mint}`);
}
