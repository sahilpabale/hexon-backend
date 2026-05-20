import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { getRpcUrl } from "./balances.js";

export async function buildWrapSolTransaction(
  walletAddress: string,
  lamports: bigint,
): Promise<{
  transactionBase64: string;
  lastValidBlockHeight: number;
  ataAddress: string;
}> {
  const connection = new Connection(getRpcUrl(), "confirmed");
  const owner = new PublicKey(walletAddress);
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, owner);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      ata,
      owner,
      NATIVE_MINT,
    ),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata, lamports }),
    createSyncNativeInstruction(ata),
  );

  return {
    transactionBase64: tx.serialize({ requireAllSignatures: false }).toString("base64"),
    lastValidBlockHeight,
    ataAddress: ata.toBase58(),
  };
}

export async function buildUnwrapSolTransaction(walletAddress: string): Promise<{
  transactionBase64: string;
  lastValidBlockHeight: number;
}> {
  const connection = new Connection(getRpcUrl(), "confirmed");
  const owner = new PublicKey(walletAddress);
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, owner);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
  tx.add(createCloseAccountInstruction(ata, owner, owner));

  return {
    transactionBase64: tx.serialize({ requireAllSignatures: false }).toString("base64"),
    lastValidBlockHeight,
  };
}
