const SOL_MINT = 'So11111111111111111111111111111111111111112'
const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const DEFAULT_DEVNET_RPC_URL = 'https://api.devnet.solana.com'
const DEFAULT_MAINNET_RPC_URL = 'https://api.mainnet-beta.solana.com'

export type SolanaNetwork = 'devnet' | 'mainnet'

export type PublicBalance = {
  asset: 'SOL' | 'USDC'
  mint: string
  amount: string
  decimals: number
  uiAmount: string
}

type JsonRpcSuccess<T> = {
  jsonrpc: '2.0'
  id: number
  result: T
}

type JsonRpcFailure = {
  jsonrpc: '2.0'
  id: number
  error: {
    code: number
    message: string
  }
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure

type ParsedTokenAccount = {
  account: {
    data: {
      parsed?: {
        info?: {
          tokenAmount?: {
            amount?: string
            decimals?: number
          }
        }
      }
    }
  }
}

export function getRpcUrl() {
  if (getSolanaNetwork() === 'mainnet') {
    return process.env.HELIUS_MAINNET_RPC_URL ?? process.env.SOLANA_MAINNET_RPC_URL ?? DEFAULT_MAINNET_RPC_URL
  }

  return process.env.HELIUS_DEVNET_RPC_URL ?? process.env.SOLANA_DEVNET_RPC_URL ?? process.env.SOLANA_RPC_URL ?? DEFAULT_DEVNET_RPC_URL
}

export function getSolanaNetwork(): SolanaNetwork {
  return process.env.SOLANA_NETWORK === 'mainnet' ? 'mainnet' : 'devnet'
}

export function getUsdcMint() {
  if (getSolanaNetwork() === 'mainnet') {
    return process.env.MAINNET_USDC_MINT ?? MAINNET_USDC_MINT
  }

  return process.env.DEVNET_USDC_MINT
}

export function getUsdcDecimals() {
  if (getSolanaNetwork() === 'mainnet') {
    return Number(process.env.MAINNET_USDC_DECIMALS ?? '6')
  }

  return Number(process.env.DEVNET_USDC_DECIMALS ?? '6')
}

export function formatUnits(baseUnits: bigint, decimals: number) {
  const sign = baseUnits < 0n ? '-' : ''
  const value = baseUnits < 0n ? -baseUnits : baseUnits
  const divisor = 10n ** BigInt(decimals)
  const whole = value / divisor
  const fraction = value % divisor

  if (fraction === 0n) {
    return `${sign}${whole.toString()}`
  }

  return `${sign}${whole.toString()}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

async function rpc<T>(method: string, params: unknown[], rpcUrl = getRpcUrl()) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  })

  if (!response.ok) {
    throw new Error(`RPC ${method} failed: ${response.status} ${response.statusText}`)
  }

  const body = (await response.json()) as JsonRpcResponse<T>
  if ('error' in body) {
    throw new Error(`RPC ${method} failed: ${body.error.code} ${body.error.message}`)
  }

  return body.result
}

async function getSolLamports(walletAddress: string) {
  const result = await rpc<{ value: number }>('getBalance', [walletAddress, { commitment: 'confirmed' }])
  return BigInt(result.value)
}

async function getSplTokenBalance(ownerAddress: string, mintAddress: string) {
  const result = await rpc<{ value: ParsedTokenAccount[] }>('getTokenAccountsByOwner', [
    ownerAddress,
    { mint: mintAddress },
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ])

  return result.value.reduce(
    (acc, tokenAccount) => {
      const tokenAmount = tokenAccount.account.data.parsed?.info?.tokenAmount
      const amount = BigInt(tokenAmount?.amount ?? '0')
      const decimals = tokenAmount?.decimals ?? acc.decimals

      return {
        amount: acc.amount + amount,
        decimals,
      }
    },
    { amount: 0n, decimals: getUsdcDecimals() },
  )
}

export async function getPublicBalances(walletAddress: string) {
  const solLamports = await getSolLamports(walletAddress)
  const balances: PublicBalance[] = [
    {
      asset: 'SOL',
      mint: SOL_MINT,
      amount: solLamports.toString(),
      decimals: 9,
      uiAmount: formatUnits(solLamports, 9),
    },
  ]

  const usdcMint = getUsdcMint()
  if (!usdcMint) {
    balances.push({
      asset: 'USDC',
      mint: `UNCONFIGURED_${getSolanaNetwork().toUpperCase()}_USDC_MINT`,
      amount: '0',
      decimals: getUsdcDecimals(),
      uiAmount: '0',
    })
    return balances
  }

  const usdcBalance = await getSplTokenBalance(walletAddress, usdcMint)
  balances.push({
    asset: 'USDC',
    mint: usdcMint,
    amount: usdcBalance.amount.toString(),
    decimals: usdcBalance.decimals,
    uiAmount: formatUnits(usdcBalance.amount, usdcBalance.decimals),
  })

  return balances
}
