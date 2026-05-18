import { getPublicBalanceToEncryptedBalanceDirectDepositorFunction } from '@umbra-privacy/sdk'
import { getDevnetUmbraClient, getDevnetUsdcMintOrThrow, jsonSafe, printUmbraError } from './lib.js'

const amount = BigInt(process.argv[2] ?? '1000000')
if (amount <= 0n) {
  throw new Error('Deposit amount must be a positive integer in base units')
}

const client = await getDevnetUmbraClient()
const mint = getDevnetUsdcMintOrThrow()
const deposit = getPublicBalanceToEncryptedBalanceDirectDepositorFunction({ client })

console.log(`Umbra network: ${client.network}`)
console.log(`Umbra program: ${client.networkConfig.programId}`)
console.log(`Wallet: ${client.signer.address}`)
console.log(`Mint: ${mint}`)
console.log(`Amount: ${amount.toString()} base units`)

try {
  const result = await deposit(client.signer.address, mint, amount)
  console.log(jsonSafe(result))
} catch (error) {
  printUmbraError(error)
  process.exitCode = 1
}
