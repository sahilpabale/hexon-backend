// Umbra Privacy Protocol — server-side unsigned transaction builder.
//
// Flow:
//   1. iOS signs UMBRA_MESSAGE_TO_SIGN via Privy (Ed25519, raw bytes, no prefix).
//   2. iOS sends the 64-byte signature (base64) to the backend with each Umbra build request.
//   3. Backend creates a "signature-forwarding signer" whose signMessage returns the iOS signature.
//   4. SDK's getDefaultMasterSeedGenerator then derives the correct master seed via KMAC256.
//   5. Backend creates an address-spoofed signer with placeholder transaction signing.
//   6. SDK builds + "signs" the transaction (with placeholder 64-byte zero signature).
//   7. Backend captures the transaction via a forwarder, encodes it to base64, returns to iOS.
//   8. iOS calls decodeBackendTransaction to strip the placeholder sig, re-signs with Privy.

import { getUmbraClient } from "@umbra-privacy/sdk";
import type {
  IUmbraSigner,
  SignableTransaction,
  SignedTransaction,
  TransactionForwarder,
  TransactionSignature,
} from "@umbra-privacy/sdk";
import { getDefaultMasterSeedGenerator } from "@umbra-privacy/sdk/client";
import type { GetUmbraClientDeps, SignedMessage } from "@umbra-privacy/sdk/client";
import { getUserRegistrationFunction } from "@umbra-privacy/sdk/registration";
import { getATAIntoETADirectDepositorFunction } from "@umbra-privacy/sdk/deposit";
import { getETAIntoATAWithdrawerFunction } from "@umbra-privacy/sdk/withdrawal";
import { masterSeedSchemeCurrent } from "@umbra-privacy/sdk/master-seed-schemes";
import { getRpcUrl, getSolanaNetwork, getUsdcMint } from "./balances.js";

export const UMBRA_MESSAGE_TO_SIGN: string = masterSeedSchemeCurrent.messageToSign;

// Type aliases derived from SDK exports — avoids adding @solana/kit as a direct dep.
type Address = IUmbraSigner["address"];
type SignatureBytes = SignedMessage["signature"];
type U64 = Parameters<
  ReturnType<typeof getATAIntoETADirectDepositorFunction>
>[2];

// Internal SDK transaction shape accessed during serialization.
// The SDK's Transaction runtime object has a plain-object signatures field
// keyed by wallet address, not the ReadonlyMap the @solana/kit type declares.
interface UmbraRawTx {
  signatures: Record<string, Uint8Array>;
  messageBytes: Uint8Array;
}

// ── Transaction serialization (manual wire format) ────────────────────────────
// Solana wire format: [compact-u16 numSigs][numSigs × 64 bytes][message bytes]
// This is the reverse of iOS's decodeBackendTransaction.

function compactU16Encode(value: number): number[] {
  if (value < 0x80) return [value];
  return [(value & 0x7f) | 0x80, (value >> 7) & 0x7f];
}

function serializeToBase64WireFormat(tx: SignedTransaction): string {
  const raw = tx as unknown as UmbraRawTx;
  const sigs = Object.values(raw.signatures);
  const messageBytes = raw.messageBytes;

  const sigCountBytes = compactU16Encode(sigs.length);
  const totalLen =
    sigCountBytes.length + sigs.length * 64 + messageBytes.length;
  const buf = new Uint8Array(totalLen);
  let offset = 0;

  for (const b of sigCountBytes) buf[offset++] = b;
  for (const sig of sigs) {
    const bytes = sig && sig.length === 64 ? sig : new Uint8Array(64);
    buf.set(bytes, offset);
    offset += 64;
  }
  buf.set(messageBytes, offset);

  return Buffer.from(buf).toString("base64");
}

// ── Address-spoofed signer ────────────────────────────────────────────────────
// Presents the user's wallet address so transactions are built with the correct
// required-signer account. The placeholder 64-byte zero signature is stripped
// by iOS's decodeBackendTransaction before the real Privy signature is added.

function createSignerForWallet(
  walletAddress: string,
  iosSignatureBytes: Uint8Array,
): IUmbraSigner {
  const address = walletAddress as Address;

  function spoofSign(tx: SignableTransaction): SignedTransaction {
    const raw = tx as unknown as UmbraRawTx;
    return {
      ...raw,
      signatures: { ...raw.signatures, [walletAddress]: new Uint8Array(64) },
    } as unknown as SignedTransaction;
  }

  return {
    address,

    // Called by getDefaultMasterSeedGenerator to produce the master seed.
    // We return the exact iOS-provided signature so the SDK derives the
    // same master seed that the user's Privy wallet would produce.
    signMessage: (message: Uint8Array): Promise<SignedMessage> =>
      Promise.resolve({
        message,
        signature: iosSignatureBytes as SignatureBytes,
        signer: address,
      }),

    // Called by the SDK to sign the compiled transaction.
    // We add a 64-byte zero placeholder keyed to the user's address.
    signTransaction: (tx: SignableTransaction): Promise<SignedTransaction> =>
      Promise.resolve(spoofSign(tx)),

    signTransactions: (
      txs: readonly SignableTransaction[],
    ): Promise<SignedTransaction[]> => Promise.resolve(txs.map(spoofSign)),
  };
}

// ── WebSocket URL helper ──────────────────────────────────────────────────────

function httpToWs(url: string): string {
  if (url.startsWith("https://"))
    return `wss://${url.slice("https://".length)}`;
  if (url.startsWith("http://")) return `ws://${url.slice("http://".length)}`;
  return url;
}

// ── Umbra client factory ──────────────────────────────────────────────────────

async function buildUmbraClient(
  walletAddress: string,
  iosSignatureBase64: string,
) {
  const signatureBytes = Buffer.from(iosSignatureBase64, "base64");
  if (signatureBytes.length !== 64) {
    throw new Error(
      `Invalid Umbra signature: expected 64 bytes, got ${signatureBytes.length}`,
    );
  }

  const rpcUrl = getRpcUrl();
  const wsUrl = httpToWs(rpcUrl);
  const network = getSolanaNetwork();
  const signer = createSignerForWallet(walletAddress, signatureBytes);

  // Use the SDK's own KMAC256-based master seed derivation by providing
  // a custom generator that calls getDefaultMasterSeedGenerator with our signer.
  // The signer's signMessage returns the iOS signature, so the SDK derives the
  // same master seed as the user's real wallet would.
  const masterSeedGenerator = getDefaultMasterSeedGenerator(signer);

  const deps = {
    masterSeedStorage: {
      load: () => Promise.resolve({ exists: false as const }),
      store: () => Promise.resolve({ success: true as const }),
      generate: masterSeedGenerator,
    },
  } satisfies GetUmbraClientDeps;

  return getUmbraClient(
    { signer, network, rpcUrl, rpcSubscriptionsUrl: wsUrl },
    deps,
  );
}

// ── Transaction capture forwarder ─────────────────────────────────────────────

function makeCaptureForwarder() {
  const captured: SignedTransaction[] = [];
  const forwarder: TransactionForwarder = {
    forwardSequentially: (transactions: readonly SignedTransaction[]) => {
      captured.push(...transactions);
      return Promise.resolve(transactions.map(() => "CAPTURED" as TransactionSignature));
    },
    forwardInParallel: (transactions: readonly SignedTransaction[]) => {
      captured.push(...transactions);
      return Promise.resolve(transactions.map(() => "CAPTURED" as TransactionSignature));
    },
    fireAndForget: (): Promise<TransactionSignature> =>
      Promise.resolve("CAPTURED" as TransactionSignature),
  };
  return { forwarder, getCaptured: () => [...captured] };
}

// ── Public builders ───────────────────────────────────────────────────────────

/**
 * Build Umbra registration transactions (may be 1–3 depending on options).
 * Returns an array of base64-encoded wire transactions for iOS to sign in order.
 */
export async function buildUmbraRegisterTransactions(
  walletAddress: string,
  iosSignatureBase64: string,
  confidential: boolean,
  anonymous: boolean,
): Promise<string[]> {
  const client = await buildUmbraClient(walletAddress, iosSignatureBase64);
  const { forwarder, getCaptured } = makeCaptureForwarder();

  const register = getUserRegistrationFunction(
    { client },
    { rpc: { transactionForwarder: forwarder } },
  );
  await register({ confidential, anonymous });

  const captured = getCaptured();
  if (captured.length === 0) {
    throw new Error("Umbra registration produced no transactions");
  }

  return captured.map(serializeToBase64WireFormat);
}

/**
 * Build an Umbra Shield (public → encrypted balance) transaction.
 * Returns a single base64-encoded wire transaction for iOS to sign.
 */
export async function buildUmbraShieldTransaction(
  walletAddress: string,
  iosSignatureBase64: string,
  asset: "SOL" | "USDC",
  amount: bigint,
): Promise<string> {
  const client = await buildUmbraClient(walletAddress, iosSignatureBase64);
  const { forwarder, getCaptured } = makeCaptureForwarder();

  const deposit = getATAIntoETADirectDepositorFunction(
    { client },
    {
      rpc: { transactionForwarder: forwarder },
      arcium: { awaitComputationFinalization: false },
    },
  );

  const mint =
    asset === "SOL"
      ? "So11111111111111111111111111111111111111112"
      : (() => {
          const m = getUsdcMint();
          if (!m) throw new Error("USDC mint not configured for this network");
          return m;
        })();

  await deposit(
    walletAddress as Address,
    mint as Address,
    amount as unknown as U64,
  );

  const captured = getCaptured();
  if (captured.length === 0) {
    throw new Error("Umbra shield produced no transactions");
  }

  return serializeToBase64WireFormat(captured[0]!);
}

/**
 * Build an Umbra direct withdrawal (encrypted balance → public wallet) transaction.
 * Returns a single base64-encoded wire transaction for iOS to sign.
 * No ZK proof required — Arcium MPC handles decryption server-side after broadcast.
 */
export async function buildUmbraWithdrawTransaction(
  walletAddress: string,
  iosSignatureBase64: string,
  asset: "SOL" | "USDC",
  amount: bigint,
  destinationAddress?: string,
): Promise<string> {
  const client = await buildUmbraClient(walletAddress, iosSignatureBase64);
  const { forwarder, getCaptured } = makeCaptureForwarder();

  const withdraw = getETAIntoATAWithdrawerFunction(
    { client },
    {
      rpc: { transactionForwarder: forwarder },
      arcium: { awaitComputationFinalization: false },
    },
  );

  const destination = destinationAddress ?? walletAddress;
  const mint =
    asset === "SOL"
      ? "So11111111111111111111111111111111111111112"
      : (() => {
          const m = getUsdcMint();
          if (!m) throw new Error("USDC mint not configured for this network");
          return m;
        })();

  await withdraw(
    destination as Address,
    mint as Address,
    amount as unknown as U64,
  );

  const captured = getCaptured();
  if (captured.length === 0) {
    throw new Error("Umbra withdraw produced no transactions");
  }

  return serializeToBase64WireFormat(captured[0]!);
}
