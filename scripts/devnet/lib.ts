import "dotenv/config";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import { getRpcUrl, getSolanaNetwork } from "../../src/services/balances.js";

export const keypairPath = resolve(
  process.env.DEVNET_KEYPAIR_PATH ?? ".devnet/keypair.json",
);
export const solanaNetwork = getSolanaNetwork();
export const rpcUrl = getRpcUrl();
export const airdropRpcUrl =
  process.env.SOLANA_AIRDROP_RPC_URL ?? "https://api.devnet.solana.com";

export function getConnection() {
  return new Connection(rpcUrl, "confirmed");
}

export function getAirdropConnection() {
  if (solanaNetwork !== "devnet") {
    throw new Error("Airdrops are only available on devnet");
  }

  return new Connection(airdropRpcUrl, "confirmed");
}

export async function writeKeypair(keypair: Keypair) {
  await mkdir(dirname(keypairPath), { recursive: true });
  await writeFile(keypairPath, JSON.stringify(Array.from(keypair.secretKey)), {
    mode: 0o600,
  });
}

export async function loadKeypair() {
  if (!existsSync(keypairPath)) {
    throw new Error(
      `Missing devnet keypair at ${keypairPath}. Run pnpm devnet:keypair first.`,
    );
  }

  const raw = await readFile(keypairPath, "utf8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}

export async function writeSignedTransaction(
  name: string,
  serializedBase64: string,
) {
  const outputPath = resolve(
    process.env.DEVNET_SIGNED_TX_PATH ?? `.devnet/${name}.base64`,
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${serializedBase64}\n`, { mode: 0o600 });
  return outputPath;
}

export function requireArg(value: string | undefined, label: string) {
  if (!value) {
    throw new Error(`Missing ${label}`);
  }

  return value;
}
