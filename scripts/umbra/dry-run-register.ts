import { getUserRegistrationFunction } from '@umbra-privacy/sdk'
import { getDevnetUmbraClient, jsonSafe } from './lib.js'

const client = await getDevnetUmbraClient()
const register = getUserRegistrationFunction(
  { client },
  {
    rpc: {
      transactionForwarder: {
        forwardSequentially: async (transactions) => {
          console.log(`Forwarder received ${transactions.length} transaction(s)`)
          console.log(jsonSafe(transactions[0]))
          return ['DRY_RUN_SIGNATURE']
        },
        fireAndForget: async () => 'DRY_RUN_SIGNATURE',
      },
    },
  },
)

const signatures = await register({
  confidential: false,
  anonymous: false,
  callbacks: {
    userAccountInitialisation: {
      pre: async (...args) => console.log(`pre: ${jsonSafe(args)}`),
      post: async (...args) => console.log(`post: ${jsonSafe(args)}`),
    },
  },
})

console.log(jsonSafe(signatures))
