import { formatUnits, getUsdcMint, type SolanaNetwork } from "./balances.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_QUOTE_URL = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP_URL = "https://api.jup.ag/swap";

// ── Mint resolution ──────────────────────────────────────────────────────────

export function getMintForAsset(
  asset: "SOL" | "USDC",
  network: SolanaNetwork,
): string {
  if (asset === "SOL") return SOL_MINT;
  const mint = getUsdcMint();
  if (!mint) throw new Error(`USDC mint not configured for ${network}`);
  return mint;
}

export function getDecimalsForAsset(asset: "SOL" | "USDC"): number {
  return asset === "SOL" ? 9 : 6;
}

// ── Jupiter v6 types ─────────────────────────────────────────────────────────

export interface JupiterV6Quote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  priceImpactPct: string;
  slippageBps: number;
  [key: string]: unknown;
}

interface JupiterSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
}

// ── Quote ────────────────────────────────────────────────────────────────────

export async function fetchJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
}): Promise<JupiterV6Quote> {
  const url = new URL(JUPITER_QUOTE_URL);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount);
  url.searchParams.set("slippageBps", String(params.slippageBps));
  url.searchParams.set("onlyDirectRoutes", "false");
  url.searchParams.set("asLegacyTransaction", "false");

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jupiter quote failed ${response.status}: ${text}`);
  }

  return response.json() as Promise<JupiterV6Quote>;
}

// ── Swap transaction builder ─────────────────────────────────────────────────

export async function buildJupiterSwapTransaction(params: {
  quoteResponse: JupiterV6Quote;
  userPublicKey: string;
}): Promise<JupiterSwapResponse> {
  const response = await fetch(JUPITER_SWAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jupiter swap build failed ${response.status}: ${text}`);
  }

  return response.json() as Promise<JupiterSwapResponse>;
}

// ── Human-readable output amount ─────────────────────────────────────────────

export function formatOutAmount(
  rawAmount: string,
  outputAsset: "SOL" | "USDC",
): string {
  const decimals = getDecimalsForAsset(outputAsset);
  return formatUnits(BigInt(rawAmount), decimals);
}
