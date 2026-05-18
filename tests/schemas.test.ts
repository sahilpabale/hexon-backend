import { describe, expect, it } from 'vitest'
import {
  JupiterQuoteRequestSchema,
  PublicKeySchema,
  SessionSyncRequestSchema,
  TxRecordBroadcastRequestSchema,
  UmbraPrivateSendBuildRequestSchema,
} from '../src/app.js'

describe('api schemas', () => {
  const walletAddress = '11111111111111111111111111111111'
  const recipientWalletAddress = 'So11111111111111111111111111111111111111112'

  it('accepts valid Solana public keys', () => {
    expect(PublicKeySchema.safeParse(walletAddress).success).toBe(true)
  })

  it('rejects malformed wallet addresses', () => {
    expect(PublicKeySchema.safeParse('not-a-solana-address').success).toBe(false)
  })

  it('validates session sync requests', () => {
    const parsed = SessionSyncRequestSchema.parse({
      walletAddress,
      deviceId: 'ios-device-1',
    })

    expect(parsed.walletAddress).toBe(walletAddress)
  })

  it('rejects Jupiter quotes for the same input and output asset', () => {
    const result = JupiterQuoteRequestSchema.safeParse({
      walletAddress,
      inputAsset: 'USDC',
      outputAsset: 'USDC',
      amount: '1000000',
      slippageBps: 50,
    })

    expect(result.success).toBe(false)
  })

  it('applies default slippage for Jupiter quotes', () => {
    const parsed = JupiterQuoteRequestSchema.parse({
      walletAddress,
      inputAsset: 'SOL',
      outputAsset: 'USDC',
      amount: '1000000',
    })

    expect(parsed.slippageBps).toBe(50)
  })

  it('validates Umbra private send payloads', () => {
    const parsed = UmbraPrivateSendBuildRequestSchema.parse({
      senderWalletAddress: walletAddress,
      recipientWalletAddress,
      asset: 'USDC',
      amount: '2500000',
      memo: 'test payment',
    })

    expect(parsed.asset).toBe('USDC')
    expect(parsed.amount).toBe('2500000')
  })

  it('rejects short transaction signatures', () => {
    const result = TxRecordBroadcastRequestSchema.safeParse({
      requestId: crypto.randomUUID(),
      signature: 'too-short',
    })

    expect(result.success).toBe(false)
  })
})
