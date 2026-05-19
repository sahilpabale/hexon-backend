import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { airdropRpcUrl, getAirdropConnection, loadKeypair } from './lib.js'

const amountSol = Number(process.argv[2] ?? '1')
if (!Number.isFinite(amountSol) || amountSol <= 0) {
  throw new Error('Airdrop amount must be a positive number of SOL')
}

const connection = getAirdropConnection()
const keypair = await loadKeypair()
const lamports = Math.round(amountSol * LAMPORTS_PER_SOL)

try {
  const signature = await connection.requestAirdrop(keypair.publicKey, lamports)
  const latestBlockhash = await connection.getLatestBlockhash()

  await connection.confirmTransaction({ signature, ...latestBlockhash }, 'confirmed')

  console.log(`Airdropped ${amountSol} devnet SOL`)
  console.log(`Address: ${keypair.publicKey.toBase58()}`)
  console.log(`Faucet RPC: ${airdropRpcUrl}`)
  console.log(`Signature: ${signature}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(
    [
      `Devnet airdrop failed via ${airdropRpcUrl}.`,
      message,
      'Try a smaller amount, wait for faucet limits to reset, or fund the printed address from an external devnet faucet.',
    ].join('\n'),
    { cause: error },
  )
}
