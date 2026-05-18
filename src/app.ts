import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { apiReference } from '@scalar/hono-api-reference'
import { getPublicBalances, getRpcUrl, getSolanaNetwork, getUsdcDecimals, getUsdcMint } from './services/balances.js'

export const app = new OpenAPIHono()

export const NetworkSchema = z.enum(['devnet', 'mainnet']).openapi('Network')
export const AssetSchema = z.enum(['SOL', 'USDC']).openapi('Asset')
export const PublicKeySchema = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/)
  .openapi({
    example: '7sM2V3iVY7uWZK9YpHk2Q38w5JN9wYpFhG4WD4X8A9mQ',
  })

const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
      message: z.string().openapi({ example: 'Invalid request body' }),
      requestId: z.string().uuid().optional(),
      details: z.unknown().optional(),
    }),
  })
  .openapi('ErrorResponse')

const TxBuildResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    network: NetworkSchema,
    action: z.string().openapi({ example: 'jupiter_swap' }),
    unsignedTransactionBase64: z.string().openapi({
      description: 'Serialized unsigned Solana VersionedTransaction encoded as base64',
    }),
    lastValidBlockHeight: z.number().int().positive().optional(),
    expiresAt: z.string().datetime().optional(),
    requiresUserSignature: z.literal(true),
    broadcastBy: z.literal('ios'),
    rpcUrl: z.string().url().openapi({ example: 'https://mainnet.helius-rpc.com/?api-key=...' }),
    warnings: z.array(z.string()).default([]),
  })
  .openapi('TxBuildResponse')

export const SessionSyncRequestSchema = z
  .object({
    walletAddress: PublicKeySchema,
    deviceId: z.string().min(8).max(128),
  })
  .openapi('SessionSyncRequest')

const SessionSyncResponseSchema = z
  .object({
    userId: z.string().uuid(),
    privyDid: z.string().openapi({ example: 'did:privy:cm123...' }),
    walletAddress: PublicKeySchema,
    network: NetworkSchema,
  })
  .openapi('SessionSyncResponse')

const BalanceResponseSchema = z
  .object({
    walletAddress: PublicKeySchema,
    network: NetworkSchema,
    balances: z.array(
      z.object({
        asset: AssetSchema,
        mint: z.string(),
        amount: z.string().openapi({ description: 'Native token units as a decimal string' }),
        decimals: z.number().int(),
        uiAmount: z.string(),
      }),
    ),
  })
  .openapi('BalanceResponse')

const UmbraRegisterBuildRequestSchema = z
  .object({
    walletAddress: PublicKeySchema,
    confidential: z.literal(true).default(true),
    anonymous: z.literal(true).default(true),
  })
  .openapi('UmbraRegisterBuildRequest')

export const UmbraShieldBuildRequestSchema = z
  .object({
    walletAddress: PublicKeySchema,
    asset: AssetSchema,
    amount: z.string().regex(/^\d+$/).openapi({ description: 'Native token units' }),
  })
  .openapi('UmbraShieldBuildRequest')

export const UmbraPrivateSendBuildRequestSchema = z
  .object({
    senderWalletAddress: PublicKeySchema,
    recipientWalletAddress: PublicKeySchema,
    asset: AssetSchema,
    amount: z.string().regex(/^\d+$/).openapi({ description: 'Native token units' }),
    memo: z.string().max(140).optional(),
  })
  .openapi('UmbraPrivateSendBuildRequest')

const UmbraClaimBuildRequestSchema = z
  .object({
    walletAddress: PublicKeySchema,
    utxoIds: z.array(z.string().min(1)).min(1).max(16),
    destination: z.enum(['encrypted_balance', 'public_wallet']).default('encrypted_balance'),
  })
  .openapi('UmbraClaimBuildRequest')

export const JupiterQuoteBaseSchema = z.object({
  walletAddress: PublicKeySchema,
  inputAsset: AssetSchema,
  outputAsset: AssetSchema,
  amount: z.string().regex(/^\d+$/).openapi({ description: 'Input amount in native token units' }),
  slippageBps: z.number().int().min(1).max(500).default(50),
})

export const JupiterQuoteRequestSchema = JupiterQuoteBaseSchema
  .refine((value) => value.inputAsset !== value.outputAsset, {
    message: 'inputAsset and outputAsset must be different',
  })
  .openapi('JupiterQuoteRequest')

const JupiterQuoteResponseSchema = z
  .object({
    quoteId: z.string().uuid(),
    network: NetworkSchema,
    inputAsset: AssetSchema,
    outputAsset: AssetSchema,
    inAmount: z.string(),
    outAmount: z.string(),
    priceImpactPct: z.string(),
    slippageBps: z.number().int(),
    expiresAt: z.string().datetime(),
    warning: z.string().optional(),
  })
  .openapi('JupiterQuoteResponse')

export const JupiterSwapBuildRequestSchema = JupiterQuoteBaseSchema.extend({
  quoteId: z.string().uuid().optional(),
})
  .refine((value) => value.inputAsset !== value.outputAsset, {
    message: 'inputAsset and outputAsset must be different',
  })
  .openapi('JupiterSwapBuildRequest')

export const TxRecordBroadcastRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    signature: z.string().min(64).max(128),
    signedTransactionBase64: z.string().optional(),
  })
  .openapi('TxRecordBroadcastRequest')

const TxStatusResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    signature: z.string().optional(),
    status: z.enum(['created', 'built', 'signed', 'broadcasted', 'confirmed', 'finalized', 'failed', 'unknown']),
    slot: z.number().int().optional(),
    error: z.string().optional(),
  })
  .openapi('TxStatusResponse')

const authSecurity = [{ bearerAuth: [] }]
const umbraEnabled = process.env.UMBRAPRIVACY_ENABLED === 'true'

app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'Privy access token',
})

function stubTx(action: string) {
  return {
    requestId: crypto.randomUUID(),
    network: getSolanaNetwork(),
    action,
    unsignedTransactionBase64: 'TODO_BUILD_SERIALIZED_VERSIONED_TRANSACTION',
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
    requiresUserSignature: true as const,
    broadcastBy: 'ios' as const,
    rpcUrl: getRpcUrl(),
    warnings: [],
  }
}

function umbraUnavailable() {
  const network = getSolanaNetwork()
  if (network === 'mainnet') {
    return {
      error: {
        code: 'UMBRA_MAINNET_BUILDER_DISABLED',
        message:
          'Umbra mainnet is reachable, but HTTP transaction builders are disabled until unsigned transaction building is wired for client-side Privy signing.',
        details: {
          programId: 'UMBRAD2ishebJTcgCLkTkNUx1v3GyoAgpTRPeWoLykh',
          reason: 'BUILDER_DISABLED',
        },
      },
    }
  }

  return {
    error: {
      code: 'UMBRA_DEVNET_UNAVAILABLE',
      message:
        'Umbra devnet is disabled because the published SDK transaction discriminator is rejected by the deployed devnet program.',
      details: {
        programId: 'DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ',
        reason: 'InstructionFallbackNotFound',
      },
    },
  }
}

app.openapi(
  createRoute({
    method: 'post',
    path: '/v1/session/sync',
    tags: ['Session'],
    security: authSecurity,
    request: {
      body: {
        content: { 'application/json': { schema: SessionSyncRequestSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Sync the authenticated Privy user with their embedded Solana wallet',
        content: { 'application/json': { schema: SessionSyncResponseSchema } },
      },
      401: { description: 'Invalid Privy access token', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  (c) => {
    const body = c.req.valid('json')
    return c.json({
      userId: crypto.randomUUID(),
      privyDid: 'did:privy:replace_with_verified_claim',
      walletAddress: body.walletAddress,
      network: getSolanaNetwork(),
    }, 200)
  },
)

app.openapi(
  createRoute({
    method: 'get',
    path: '/v1/balances/{walletAddress}',
    tags: ['Wallet'],
    security: authSecurity,
    request: {
      params: z.object({
        walletAddress: PublicKeySchema.openapi({
          param: { name: 'walletAddress', in: 'path' },
        }),
      }),
    },
    responses: {
      200: {
        description: 'Get public SOL and USDC balances for the configured Solana network',
        content: { 'application/json': { schema: BalanceResponseSchema } },
      },
    },
  }),
  async (c) => {
    const { walletAddress } = c.req.valid('param')
    const balances =
      process.env.NODE_ENV === 'test'
        ? [
            {
              asset: 'SOL' as const,
              mint: 'So11111111111111111111111111111111111111112',
              amount: '0',
              decimals: 9,
              uiAmount: '0',
            },
            {
              asset: 'USDC' as const,
              mint: getUsdcMint() ?? `UNCONFIGURED_${getSolanaNetwork().toUpperCase()}_USDC_MINT`,
              amount: '0',
              decimals: getUsdcDecimals(),
              uiAmount: '0',
            },
          ]
        : await getPublicBalances(walletAddress)

    return c.json({
      walletAddress,
      network: getSolanaNetwork(),
      balances,
    })
  },
)

app.openapi(
  createRoute({
    method: 'post',
    path: '/v1/umbra/register/build',
    tags: ['Umbra'],
    security: authSecurity,
    request: {
      body: { content: { 'application/json': { schema: UmbraRegisterBuildRequestSchema } }, required: true },
    },
    responses: {
      200: { description: 'Build Umbra registration transaction(s)', content: { 'application/json': { schema: TxBuildResponseSchema } } },
      503: { description: 'Umbra builders are unavailable for the configured network', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  (c) => {
    c.req.valid('json')
    if (!umbraEnabled) {
      return c.json(umbraUnavailable(), 503)
    }

    return c.json(stubTx('umbra_register'), 200)
  },
)

app.openapi(
  createRoute({
    method: 'post',
    path: '/v1/umbra/shield/build',
    tags: ['Umbra'],
    security: authSecurity,
    request: {
      body: { content: { 'application/json': { schema: UmbraShieldBuildRequestSchema } }, required: true },
    },
    responses: {
      200: { description: 'Build Umbra shield/deposit transaction', content: { 'application/json': { schema: TxBuildResponseSchema } } },
      503: { description: 'Umbra builders are unavailable for the configured network', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  (c) => {
    c.req.valid('json')
    if (!umbraEnabled) {
      return c.json(umbraUnavailable(), 503)
    }

    return c.json(stubTx('umbra_shield'), 200)
  },
)

app.openapi(
  createRoute({
    method: 'post',
    path: '/v1/umbra/private-send/build',
    tags: ['Umbra'],
    security: authSecurity,
    request: {
      body: { content: { 'application/json': { schema: UmbraPrivateSendBuildRequestSchema } }, required: true },
    },
    responses: {
      200: { description: 'Build Umbra private send transaction', content: { 'application/json': { schema: TxBuildResponseSchema } } },
      503: { description: 'Umbra builders are unavailable for the configured network', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  (c) => {
    c.req.valid('json')
    if (!umbraEnabled) {
      return c.json(umbraUnavailable(), 503)
    }

    return c.json(stubTx('umbra_private_send'), 200)
  },
)

app.openapi(
  createRoute({
    method: 'post',
    path: '/v1/umbra/claim/build',
    tags: ['Umbra'],
    security: authSecurity,
    request: {
      body: { content: { 'application/json': { schema: UmbraClaimBuildRequestSchema } }, required: true },
    },
    responses: {
      200: { description: 'Build Umbra UTXO claim transaction', content: { 'application/json': { schema: TxBuildResponseSchema } } },
      503: { description: 'Umbra builders are unavailable for the configured network', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  (c) => {
    c.req.valid('json')
    if (!umbraEnabled) {
      return c.json(umbraUnavailable(), 503)
    }

    return c.json(stubTx('umbra_claim'), 200)
  },
)

app.openapi(
  createRoute({
    method: 'post',
    path: '/v1/jupiter/quote',
    tags: ['Jupiter'],
    security: authSecurity,
    request: {
      body: { content: { 'application/json': { schema: JupiterQuoteRequestSchema } }, required: true },
    },
    responses: {
      200: { description: 'Get a public Jupiter swap quote', content: { 'application/json': { schema: JupiterQuoteResponseSchema } } },
    },
  }),
  (c) => {
    const body = c.req.valid('json')
    const network = getSolanaNetwork()
    return c.json({
      quoteId: crypto.randomUUID(),
      network,
      inputAsset: body.inputAsset,
      outputAsset: body.outputAsset,
      inAmount: body.amount,
      outAmount: '0',
      priceImpactPct: '0',
      slippageBps: body.slippageBps,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      warning:
        network === 'devnet'
          ? 'Jupiter liquidity is primarily mainnet; devnet swaps may require a mock or test AMM.'
          : 'Jupiter quote integration is stubbed until the live Jupiter API is wired.',
    })
  },
)

app.openapi(
  createRoute({
    method: 'post',
    path: '/v1/jupiter/swap/build',
    tags: ['Jupiter'],
    security: authSecurity,
    request: {
      body: { content: { 'application/json': { schema: JupiterSwapBuildRequestSchema } }, required: true },
    },
    responses: {
      200: { description: 'Build an unsigned public Jupiter swap transaction', content: { 'application/json': { schema: TxBuildResponseSchema } } },
    },
  }),
  (c) => {
    c.req.valid('json')
    return c.json({
      ...stubTx('jupiter_swap'),
      warnings: ['This swap is public and not privacy-preserving.'],
    })
  },
)

app.openapi(
  createRoute({
    method: 'post',
    path: '/v1/tx/record-broadcast',
    tags: ['Transactions'],
    security: authSecurity,
    request: {
      body: { content: { 'application/json': { schema: TxRecordBroadcastRequestSchema } }, required: true },
    },
    responses: {
      200: { description: 'Record a transaction signature after iOS broadcasts it', content: { 'application/json': { schema: TxStatusResponseSchema } } },
    },
  }),
  (c) => {
    const body = c.req.valid('json')
    return c.json({
      requestId: body.requestId,
      signature: body.signature,
      status: 'broadcasted' as const,
    })
  },
)

app.openapi(
  createRoute({
    method: 'get',
    path: '/v1/tx/{requestId}',
    tags: ['Transactions'],
    security: authSecurity,
    request: {
      params: z.object({
        requestId: z.string().uuid().openapi({ param: { name: 'requestId', in: 'path' } }),
      }),
    },
    responses: {
      200: { description: 'Get transaction request status', content: { 'application/json': { schema: TxStatusResponseSchema } } },
    },
  }),
  (c) => {
    const { requestId } = c.req.valid('param')
    return c.json({
      requestId,
      status: 'unknown' as const,
    })
  },
)

app.doc('/openapi.json', {
  openapi: '3.0.3',
  info: {
    title: 'Hexon Backend API',
    version: '0.1.0',
    description: 'Transaction builder API for Privy Solana wallets, Umbra privacy flows, and public Jupiter swaps.',
  },
  servers: [{ url: process.env.API_BASE_URL ?? 'http://127.0.0.1:3010' }],
})

app.get(
  '/docs',
  apiReference({
    url: '/openapi.json',
    theme: 'kepler',
    pageTitle: 'Hexon API Docs',
  }),
)

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'hexon-backend',
    network: getSolanaNetwork(),
  }),
)
