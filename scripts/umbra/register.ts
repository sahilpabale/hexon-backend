import { getUserAccountQuerierFunction, getUserRegistrationFunction } from '@umbra-privacy/sdk'
import { getDevnetUmbraClient, jsonSafe, printUmbraError } from './lib.js'

const confidential = process.env.UMBRA_CONFIDENTIAL !== 'false'
const anonymous = process.env.UMBRA_ANONYMOUS === 'true'
const client = await getDevnetUmbraClient()
const query = getUserAccountQuerierFunction({ client })

console.log(`Umbra network: ${client.network}`)
console.log(`Umbra program: ${client.networkConfig.programId}`)
console.log(`Wallet: ${client.signer.address}`)
console.log(`Registering with confidential=${confidential}, anonymous=${anonymous}`)

const before = await query(client.signer.address)
console.log('Before:')
console.log(jsonSafe(before))

try {
  const register = getUserRegistrationFunction({ client })
  const signatures = await register({
    confidential,
    anonymous,
    callbacks: {
      userAccountInitialisation: {
        pre: async () => console.log('Preparing account initialization tx...'),
        post: async (_tx, sig) => console.log(`Account initialization confirmed: ${sig}`),
      },
      registerX25519PublicKey: {
        pre: async () => console.log('Preparing X25519 key registration tx...'),
        post: async (_tx, sig) => console.log(`X25519 key registration confirmed: ${sig}`),
      },
      registerUserForAnonymousUsage: {
        pre: async () => console.log('Preparing anonymous commitment registration tx...'),
        post: async (_tx, sig) => console.log(`Anonymous commitment registration confirmed: ${sig}`),
      },
    },
  })

  console.log(`Registration submitted ${signatures.length} transaction(s):`)
  for (const signature of signatures) {
    console.log(`- ${signature}`)
  }

  const after = await query(client.signer.address)
  console.log('After:')
  console.log(jsonSafe(after))
} catch (error) {
  printUmbraError(error)
  process.exitCode = 1
}
