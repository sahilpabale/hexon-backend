import { getPublicBalanceToEncryptedBalanceDirectDepositorFunction } from '@umbra-privacy/sdk'
import { getDevnetUmbraClient, getDevnetUsdcMintOrThrow, jsonSafe } from './lib.js'

const amount = BigInt(process.argv[2] ?? '1')
if (amount <= 0n) {
  throw new Error('Dry-run deposit amount must be a positive integer in base units')
}

const client = await getDevnetUmbraClient()
const mint = getDevnetUsdcMintOrThrow()
const deposit = getPublicBalanceToEncryptedBalanceDirectDepositorFunction(
  { client },
  {
    rpc: {
      transactionForwarder: {
        forwardSequentially: (transactions) => {
          console.log(`Forwarder received ${transactions.length} transaction(s)`)
          console.log(jsonSafe(transactions[0]))
          return Promise.resolve(['DRY_RUN_SIGNATURE'])
        },
        fireAndForget: () => Promise.resolve('DRY_RUN_SIGNATURE'),
      },
    },
    arcium: {
      awaitComputationFinalization: false,
    },
  },
)

console.log(`Umbra network: ${client.network}`)
console.log(`Umbra program: ${client.networkConfig.programId}`)
console.log(`Wallet: ${client.signer.address}`)
console.log(`Mint: ${mint}`)
console.log(`Amount: ${amount.toString()} base units`)

const result = await deposit(client.signer.address, mint, amount)
console.log(jsonSafe(result))
