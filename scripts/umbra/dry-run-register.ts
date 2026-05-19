import { getUserRegistrationFunction } from '@umbra-privacy/sdk'
import { getDevnetUmbraClient, jsonSafe } from './lib.js'

const client = await getDevnetUmbraClient()
const register = getUserRegistrationFunction(
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
  },
)

const signatures = await register({
  confidential: false,
  anonymous: false,
  callbacks: {
    userAccountInitialisation: {
      pre: (...args) => Promise.resolve(void console.log(`pre: ${jsonSafe(args)}`)),
      post: (...args) => Promise.resolve(void console.log(`post: ${jsonSafe(args)}`)),
    },
  },
})

console.log(jsonSafe(signatures))
