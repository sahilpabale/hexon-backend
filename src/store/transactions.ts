// In-memory transaction store and Jupiter quote cache.
// Both are process-scoped — restart clears all state.

export type TxStatus =
  | "built"
  | "broadcasted"
  | "confirmed"
  | "failed"
  | "unknown";

export interface TxRecord {
  requestId: string;
  action: string;
  network: string;
  signature?: string;
  status: TxStatus;
  createdAt: number;
}

const txStore = new Map<string, TxRecord>();

export function createTx(
  record: Omit<TxRecord, "createdAt" | "status">,
): TxRecord {
  const tx: TxRecord = { ...record, status: "built", createdAt: Date.now() };
  txStore.set(record.requestId, tx);
  return tx;
}

export function recordBroadcast(
  requestId: string,
  signature: string,
): TxRecord {
  const tx = txStore.get(requestId);
  if (!tx) {
    // Create a synthetic record for public sends (requestId is a fresh UUID)
    const synthetic: TxRecord = {
      requestId,
      action: "public_send",
      network: "unknown",
      signature,
      status: "broadcasted",
      createdAt: Date.now(),
    };
    txStore.set(requestId, synthetic);
    return synthetic;
  }
  tx.signature = signature;
  tx.status = "broadcasted";
  return tx;
}

export function getTx(requestId: string): TxRecord | null {
  return txStore.get(requestId) ?? null;
}

// ── Jupiter quote cache ──────────────────────────────────────────────────────

export interface CachedQuote {
  quoteId: string;
  jupiterResponse: unknown; // raw Jupiter v6 /quote response object
  expiresAt: number;
}

const quoteCache = new Map<string, CachedQuote>();
const QUOTE_TTL_MS = 60_000;

export function cacheQuote(
  quoteId: string,
  jupiterResponse: unknown,
): CachedQuote {
  const entry: CachedQuote = {
    quoteId,
    jupiterResponse,
    expiresAt: Date.now() + QUOTE_TTL_MS,
  };
  quoteCache.set(quoteId, entry);
  return entry;
}

export function getCachedQuote(quoteId: string): CachedQuote | null {
  const entry = quoteCache.get(quoteId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    quoteCache.delete(quoteId);
    return null;
  }
  return entry;
}
