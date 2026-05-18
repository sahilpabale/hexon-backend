import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createSignerFromPrivateKeyBytes, getUmbraClient } from '@umbra-privacy/sdk'
import { getSolanaNetwork, getUsdcMint } from '../../src/services/balances.js'
import { keypairPath, rpcUrl } from '../devnet/lib.js'

export const umbraNetwork = getSolanaNetwork()

function getWsUrl(httpUrl: string) {
  const configured =
    umbraNetwork === 'mainnet'
      ? process.env.HELIUS_MAINNET_WS_URL ?? process.env.SOLANA_MAINNET_WS_URL ?? process.env.SOLANA_WS_URL
      : process.env.HELIUS_DEVNET_WS_URL ?? process.env.SOLANA_DEVNET_WS_URL ?? process.env.SOLANA_WS_URL
  if (configured) {
    return configured
  }

  if (httpUrl.startsWith('https://')) {
    return `wss://${httpUrl.slice('https://'.length)}`
  }

  if (httpUrl.startsWith('http://')) {
    return `ws://${httpUrl.slice('http://'.length)}`
  }

  return httpUrl
}

export async function loadUmbraSigner() {
  const raw = await readFile(resolve(keypairPath), 'utf8')
  const privateKeyBytes = Uint8Array.from(JSON.parse(raw) as number[])
  return createSignerFromPrivateKeyBytes(privateKeyBytes)
}

export async function getDevnetUmbraClient() {
  const signer = await loadUmbraSigner()

  return getUmbraClient({
    signer,
    network: umbraNetwork,
    rpcUrl,
    rpcSubscriptionsUrl: getWsUrl(rpcUrl),
    indexerApiEndpoint:
      umbraNetwork === 'mainnet'
        ? process.env.UMBRAPRIVACY_MAINNET_INDEXER_URL
        : process.env.UMBRAPRIVACY_DEVNET_INDEXER_URL,
    deferMasterSeedSignature: true,
  })
}

export function getDevnetUsdcMintOrThrow() {
  const mint = getUsdcMint()
  if (!mint) {
    throw new Error(`Missing ${umbraNetwork.toUpperCase()} USDC mint configuration`)
  }

  return mint
}

export function jsonSafe(value: unknown) {
  return JSON.stringify(
    value,
    (_, innerValue) => {
      if (typeof innerValue === 'bigint') {
        return innerValue.toString()
      }

      if (innerValue instanceof Uint8Array) {
        return Buffer.from(innerValue).toString('hex')
      }

      return innerValue
    },
    2,
  )
}

function findTransactionLogs(error: unknown): string[] | undefined {
  let current = error
  while (current && typeof current === 'object') {
    const context = (current as { context?: unknown }).context
    if (context && typeof context === 'object') {
      const logs = (context as { logs?: unknown }).logs
      if (Array.isArray(logs) && logs.every((log) => typeof log === 'string')) {
        return logs
      }
    }

    current = (current as { cause?: unknown }).cause
  }

  return undefined
}

export function printUmbraError(error: unknown) {
  const details =
    error && typeof error === 'object'
      ? (error as { name?: string; message?: string; code?: string; stage?: string })
      : undefined

  console.error(`${details?.name ?? 'UmbraError'}: ${details?.message ?? String(error)}`)

  if (details?.code) {
    console.error(`Code: ${details.code}`)
  }

  if (details?.stage) {
    console.error(`Stage: ${details.stage}`)
  }

  const logs = findTransactionLogs(error)
  if (logs) {
    console.error('Simulation logs:')
    for (const log of logs) {
      console.error(`  ${log}`)
    }

    if (logs.some((log) => log.includes('InstructionFallbackNotFound'))) {
      console.error('')
      console.error('Known Umbra devnet issue:')
      console.error('  The latest published SDK built an instruction that the deployed devnet program rejected.')
      console.error('  This is an Umbra SDK/program deployment mismatch, not a wallet balance or signing issue.')
    }

    if (logs.some((log) => log.includes('Program is not deployed'))) {
      console.error('')
      console.error('Known Umbra devnet issue:')
      console.error('  This SDK version points at an Umbra devnet program that is not currently deployed.')
    }
  }
}
