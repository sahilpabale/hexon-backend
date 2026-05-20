import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { RouteHandler } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import {
  getPublicBalances,
  getRpcUrl,
  getSolanaNetwork,
  getUsdcDecimals,
  getUsdcMint,
} from "./services/balances.js";
import {
  buildJupiterSwapTransaction,
  fetchJupiterQuote,
  formatOutAmount,
  getMintForAsset,
} from "./services/jupiter.js";
import {
  buildUmbraRegisterTransactions,
  buildUmbraShieldTransaction,
  buildUmbraWithdrawTransaction,
  UMBRA_MESSAGE_TO_SIGN,
} from "./services/umbra.js";
import {
  buildWrapSolTransaction,
  buildUnwrapSolTransaction,
} from "./services/wsol.js";
import {
  cacheQuote,
  createTx,
  getCachedQuote,
  getTx,
  recordBroadcast as storeBroadcast,
} from "./store/transactions.js";

export const app = new OpenAPIHono();

export const NetworkSchema = z.enum(["devnet", "mainnet"]).openapi("Network");
export const AssetSchema = z.enum(["SOL", "USDC"]).openapi("Asset");
export const PublicKeySchema = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/)
  .openapi({
    example: "7sM2V3iVY7uWZK9YpHk2Q38w5JN9wYpFhG4WD4X8A9mQ",
  });

const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "VALIDATION_ERROR" }),
      message: z.string().openapi({ example: "Invalid request body" }),
      requestId: z.string().uuid().optional(),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ErrorResponse");

const TxBuildResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    network: NetworkSchema,
    action: z.string().openapi({ example: "jupiter_swap" }),
    unsignedTransactionBase64: z.string().openapi({
      description:
        "Serialized unsigned Solana VersionedTransaction encoded as base64",
    }),
    lastValidBlockHeight: z.number().int().positive().optional(),
    expiresAt: z.string().datetime().optional(),
    requiresUserSignature: z.literal(true),
    broadcastBy: z.literal("ios"),
    rpcUrl: z
      .string()
      .url()
      .openapi({ example: "https://mainnet.helius-rpc.com/?api-key=..." }),
    warnings: z.array(z.string()).default([]),
  })
  .openapi("TxBuildResponse");

export const SessionSyncRequestSchema = z
  .object({
    walletAddress: PublicKeySchema,
    deviceId: z.string().min(8).max(128),
  })
  .openapi("SessionSyncRequest");

const SessionSyncResponseSchema = z
  .object({
    userId: z.string().uuid(),
    privyDid: z.string().openapi({ example: "did:privy:cm123..." }),
    walletAddress: PublicKeySchema,
    network: NetworkSchema,
  })
  .openapi("SessionSyncResponse");

const BalanceResponseSchema = z
  .object({
    walletAddress: PublicKeySchema,
    network: NetworkSchema,
    balances: z.array(
      z.object({
        asset: AssetSchema,
        mint: z.string(),
        amount: z
          .string()
          .openapi({ description: "Native token units as a decimal string" }),
        decimals: z.number().int(),
        uiAmount: z.string(),
      }),
    ),
  })
  .openapi("BalanceResponse");

const UmbraSignatureSchema = z
  .string()
  .min(86)
  .max(88)
  .openapi({
    description:
      "Base64-encoded 64-byte Ed25519 signature of UMBRA_MESSAGE_TO_SIGN",
  });

const UmbraRegisterBuildRequestSchema = z
  .object({
    walletAddress: PublicKeySchema,
    umbraSignature: UmbraSignatureSchema,
    confidential: z.boolean().default(true),
    anonymous: z.boolean().default(false),
  })
  .openapi("UmbraRegisterBuildRequest");

const UmbraMultiTxBuildResponseSchema = z
  .object({
    requestIds: z.array(z.string().uuid()),
    network: NetworkSchema,
    action: z.string(),
    unsignedTransactionsBase64: z.array(z.string()),
    rpcUrl: z.string().url(),
    warnings: z.array(z.string()).default([]),
  })
  .openapi("UmbraMultiTxBuildResponse");

export const UmbraShieldBuildRequestSchema = z
  .object({
    walletAddress: PublicKeySchema,
    umbraSignature: UmbraSignatureSchema,
    asset: AssetSchema,
    amount: z
      .string()
      .regex(/^\d+$/)
      .openapi({ description: "Native token units" }),
  })
  .openapi("UmbraShieldBuildRequest");

export const UmbraPrivateSendBuildRequestSchema = z
  .object({
    senderWalletAddress: PublicKeySchema,
    umbraSignature: UmbraSignatureSchema,
    recipientWalletAddress: PublicKeySchema,
    asset: AssetSchema,
    amount: z
      .string()
      .regex(/^\d+$/)
      .openapi({ description: "Native token units" }),
    memo: z.string().max(140).optional(),
  })
  .openapi("UmbraPrivateSendBuildRequest");

const UmbraClaimBuildRequestSchema = z
  .object({
    walletAddress: PublicKeySchema,
    umbraSignature: UmbraSignatureSchema,
    asset: AssetSchema,
    amount: z
      .string()
      .regex(/^\d+$/)
      .openapi({ description: "Native token units to withdraw" }),
    destinationAddress: PublicKeySchema.optional().openapi({
      description: "Recipient public key. Defaults to walletAddress.",
    }),
  })
  .openapi("UmbraClaimBuildRequest");

export const JupiterQuoteBaseSchema = z.object({
  walletAddress: PublicKeySchema,
  inputAsset: AssetSchema,
  outputAsset: AssetSchema,
  amount: z
    .string()
    .regex(/^\d+$/)
    .openapi({ description: "Input amount in native token units" }),
  slippageBps: z.number().int().min(1).max(500).default(50),
});

export const JupiterQuoteRequestSchema = JupiterQuoteBaseSchema.refine(
  (value) => value.inputAsset !== value.outputAsset,
  {
    message: "inputAsset and outputAsset must be different",
  },
).openapi("JupiterQuoteRequest");

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
  .openapi("JupiterQuoteResponse");

export const JupiterSwapBuildRequestSchema = JupiterQuoteBaseSchema.extend({
  quoteId: z.string().uuid().optional(),
})
  .refine((value) => value.inputAsset !== value.outputAsset, {
    message: "inputAsset and outputAsset must be different",
  })
  .openapi("JupiterSwapBuildRequest");

export const TxRecordBroadcastRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    signature: z.string().min(64).max(128),
    signedTransactionBase64: z.string().optional(),
  })
  .openapi("TxRecordBroadcastRequest");

const TxStatusResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    signature: z.string().optional(),
    status: z.enum([
      "created",
      "built",
      "signed",
      "broadcasted",
      "confirmed",
      "finalized",
      "failed",
      "unknown",
    ]),
    slot: z.number().int().optional(),
    error: z.string().optional(),
  })
  .openapi("TxStatusResponse");

const authSecurity = [{ bearerAuth: [] }];
const umbraEnabled = process.env.UMBRAPRIVACY_ENABLED === "true";

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "Privy access token",
});

function _stubTx(action: string) {
  return {
    requestId: crypto.randomUUID(),
    network: getSolanaNetwork(),
    action,
    unsignedTransactionBase64: "TODO_BUILD_SERIALIZED_VERSIONED_TRANSACTION",
    expiresAt: new Date(Date.now() + 90_000).toISOString(),
    requiresUserSignature: true as const,
    broadcastBy: "ios" as const,
    rpcUrl: getRpcUrl(),
    warnings: [],
  };
}

function umbraUnavailable() {
  const network = getSolanaNetwork();
  if (network === "mainnet") {
    return {
      error: {
        code: "UMBRA_MAINNET_BUILDER_DISABLED",
        message:
          "Umbra mainnet is reachable, but HTTP transaction builders are disabled until unsigned transaction building is wired for client-side Privy signing.",
        details: {
          programId: "UMBRAD2ishebJTcgCLkTkNUx1v3GyoAgpTRPeWoLykh",
          reason: "BUILDER_DISABLED",
        },
      },
    };
  }

  return {
    error: {
      code: "UMBRA_DEVNET_UNAVAILABLE",
      message:
        "Umbra devnet is disabled because the published SDK transaction discriminator is rejected by the deployed devnet program.",
      details: {
        programId: "DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ",
        reason: "InstructionFallbackNotFound",
      },
    },
  };
}

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/session/sync",
    tags: ["Session"],
    security: authSecurity,
    request: {
      body: {
        content: { "application/json": { schema: SessionSyncRequestSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        description:
          "Sync the authenticated Privy user with their embedded Solana wallet",
        content: { "application/json": { schema: SessionSyncResponseSchema } },
      },
      401: {
        description: "Invalid Privy access token",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  }),
  (c) => {
    const body = c.req.valid("json");
    return c.json(
      {
        userId: crypto.randomUUID(),
        privyDid: "did:privy:replace_with_verified_claim",
        walletAddress: body.walletAddress,
        network: getSolanaNetwork(),
      },
      200,
    );
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/umbra/message-to-sign",
    tags: ["Umbra"],
    responses: {
      200: {
        description:
          "Returns the exact UTF-8 string that the user must sign with their Solana wallet to derive the Umbra master seed.",
        content: {
          "application/json": {
            schema: z
              .object({ message: z.string() })
              .openapi("UmbraMessageToSign"),
          },
        },
      },
    },
  }),
  (c) => c.json({ message: UMBRA_MESSAGE_TO_SIGN }),
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/balances/{walletAddress}",
    tags: ["Wallet"],
    security: authSecurity,
    request: {
      params: z.object({
        walletAddress: PublicKeySchema.openapi({
          param: { name: "walletAddress", in: "path" },
        }),
      }),
    },
    responses: {
      200: {
        description:
          "Get public SOL and USDC balances for the configured Solana network",
        content: { "application/json": { schema: BalanceResponseSchema } },
      },
    },
  }),
  async (c) => {
    const { walletAddress } = c.req.valid("param");
    const balances =
      process.env.NODE_ENV === "test"
        ? [
            {
              asset: "SOL" as const,
              mint: "So11111111111111111111111111111111111111112",
              amount: "0",
              decimals: 9,
              uiAmount: "0",
            },
            {
              asset: "USDC" as const,
              mint:
                getUsdcMint() ??
                `UNCONFIGURED_${getSolanaNetwork().toUpperCase()}_USDC_MINT`,
              amount: "0",
              decimals: getUsdcDecimals(),
              uiAmount: "0",
            },
          ]
        : await getPublicBalances(walletAddress);

    return c.json({
      walletAddress,
      network: getSolanaNetwork(),
      balances,
    });
  },
);

const registerBuildRoute = createRoute({
  method: "post",
  path: "/v1/umbra/register/build",
  tags: ["Umbra"],
  security: authSecurity,
  request: {
    body: {
      content: {
        "application/json": { schema: UmbraRegisterBuildRequestSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Build Umbra registration transaction(s)",
      content: {
        "application/json": { schema: UmbraMultiTxBuildResponseSchema },
      },
    },
    500: {
      description: "Build failed",
      content: { "application/json": { schema: ErrorSchema } },
    },
    503: {
      description: "Umbra builders are unavailable for the configured network",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});
const registerBuildHandler: RouteHandler<typeof registerBuildRoute> = async (
  c,
) => {
  const body = c.req.valid("json");
  if (!umbraEnabled) {
    return c.json(umbraUnavailable(), 503);
  }
  try {
    const txs = await buildUmbraRegisterTransactions(
      body.walletAddress,
      body.umbraSignature,
      body.confidential,
      body.anonymous,
    );
    const requestIds = txs.map(() => crypto.randomUUID());
    for (const [i, requestId] of requestIds.entries()) {
      createTx({
        requestId,
        action: "umbra_register",
        network: getSolanaNetwork(),
      });
      void i;
    }
    return c.json(
      {
        requestIds,
        network: getSolanaNetwork(),
        action: "umbra_register",
        unsignedTransactionsBase64: txs,
        rpcUrl: getRpcUrl(),
        warnings: [] as string[],
      },
      200,
    );
  } catch (err) {
    return c.json(
      {
        error: {
          code: "UMBRA_REGISTER_BUILD_FAILED",
          message:
            err instanceof Error ? err.message : "Umbra register build failed",
        },
      },
      500,
    );
  }
};
app.openapi(registerBuildRoute, registerBuildHandler);

const shieldBuildRoute = createRoute({
  method: "post",
  path: "/v1/umbra/shield/build",
  tags: ["Umbra"],
  security: authSecurity,
  request: {
    body: {
      content: {
        "application/json": { schema: UmbraShieldBuildRequestSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Build Umbra shield/deposit transaction",
      content: { "application/json": { schema: TxBuildResponseSchema } },
    },
    500: {
      description: "Build failed",
      content: { "application/json": { schema: ErrorSchema } },
    },
    503: {
      description: "Umbra builders are unavailable for the configured network",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});
const shieldBuildHandler: RouteHandler<typeof shieldBuildRoute> = async (c) => {
  const body = c.req.valid("json");
  if (!umbraEnabled) {
    return c.json(umbraUnavailable(), 503);
  }
  try {
    const unsignedTx = await buildUmbraShieldTransaction(
      body.walletAddress,
      body.umbraSignature,
      body.asset,
      BigInt(body.amount),
    );
    const requestId = crypto.randomUUID();
    createTx({
      requestId,
      action: "umbra_shield",
      network: getSolanaNetwork(),
    });
    return c.json(
      {
        requestId,
        network: getSolanaNetwork(),
        action: "umbra_shield",
        unsignedTransactionBase64: unsignedTx,
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
        requiresUserSignature: true as const,
        broadcastBy: "ios" as const,
        rpcUrl: getRpcUrl(),
        warnings: ["This deposits tokens into your private Umbra balance."],
      },
      200,
    );
  } catch (err) {
    return c.json(
      {
        error: {
          code: "UMBRA_SHIELD_BUILD_FAILED",
          message:
            err instanceof Error ? err.message : "Umbra shield build failed",
        },
      },
      500,
    );
  }
};
app.openapi(shieldBuildRoute, shieldBuildHandler);

const privateSendBuildRoute = createRoute({
  method: "post",
  path: "/v1/umbra/private-send/build",
  tags: ["Umbra"],
  security: authSecurity,
  request: {
    body: {
      content: {
        "application/json": { schema: UmbraPrivateSendBuildRequestSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Build Umbra private send transaction",
      content: { "application/json": { schema: TxBuildResponseSchema } },
    },
    503: {
      description: "Umbra builders are unavailable for the configured network",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});
const privateSendBuildHandler: RouteHandler<typeof privateSendBuildRoute> = (
  c,
) => {
  c.req.valid("json");
  if (!umbraEnabled) {
    return c.json(umbraUnavailable(), 503);
  }
  return c.json(
    {
      error: {
        code: "UMBRA_PRIVATE_SEND_ZK_PROVER_UNAVAILABLE",
        message:
          "Private send requires a Groth16 ZK proof that must be generated client-side. Server-side ZK proving is not yet available. This feature requires a dedicated proving service.",
        details: { reason: "ZK_PROVER_NOT_BUNDLED" },
      },
    },
    503,
  );
};
app.openapi(privateSendBuildRoute, privateSendBuildHandler);

const claimBuildRoute = createRoute({
  method: "post",
  path: "/v1/umbra/claim/build",
  tags: ["Umbra"],
  security: authSecurity,
  request: {
    body: {
      content: { "application/json": { schema: UmbraClaimBuildRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Build Umbra UTXO claim transaction",
      content: { "application/json": { schema: TxBuildResponseSchema } },
    },
    500: {
      description: "Build failed",
      content: { "application/json": { schema: ErrorSchema } },
    },
    503: {
      description: "Umbra builders are unavailable for the configured network",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});
const claimBuildHandler: RouteHandler<typeof claimBuildRoute> = async (c) => {
  const body = c.req.valid("json");
  if (!umbraEnabled) {
    return c.json(umbraUnavailable(), 503);
  }
  try {
    const unsignedTx = await buildUmbraWithdrawTransaction(
      body.walletAddress,
      body.umbraSignature,
      body.asset,
      BigInt(body.amount),
      body.destinationAddress,
    );
    const requestId = crypto.randomUUID();
    createTx({ requestId, action: "umbra_claim", network: getSolanaNetwork() });
    return c.json(
      {
        requestId,
        network: getSolanaNetwork(),
        action: "umbra_claim",
        unsignedTransactionBase64: unsignedTx,
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
        requiresUserSignature: true as const,
        broadcastBy: "ios" as const,
        rpcUrl: getRpcUrl(),
        warnings: [
          "Arcium MPC will finalize the withdrawal after broadcast. This may take a few minutes.",
        ],
      },
      200,
    );
  } catch (err) {
    return c.json(
      {
        error: {
          code: "UMBRA_CLAIM_BUILD_FAILED",
          message:
            err instanceof Error ? err.message : "Umbra claim build failed",
        },
      },
      500,
    );
  }
};
app.openapi(claimBuildRoute, claimBuildHandler);

const jupiterQuoteRoute = createRoute({
  method: "post",
  path: "/v1/jupiter/quote",
  tags: ["Jupiter"],
  security: authSecurity,
  request: {
    body: {
      content: { "application/json": { schema: JupiterQuoteRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Get a public Jupiter swap quote",
      content: { "application/json": { schema: JupiterQuoteResponseSchema } },
    },
    500: {
      description: "Quote request failed",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});
const jupiterQuoteHandler: RouteHandler<typeof jupiterQuoteRoute> = async (
  c,
) => {
  const body = c.req.valid("json");
  const network = getSolanaNetwork();

  if (network === "devnet") {
    return c.json(
      {
        quoteId: crypto.randomUUID(),
        network,
        inputAsset: body.inputAsset,
        outputAsset: body.outputAsset,
        inAmount: body.amount,
        outAmount: "0",
        priceImpactPct: "0",
        slippageBps: body.slippageBps,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        warning: "Jupiter swap is only available on mainnet.",
      },
      200,
    );
  }

  try {
    const inputMint = getMintForAsset(body.inputAsset, network);
    const outputMint = getMintForAsset(body.outputAsset, network);
    const jupQuote = await fetchJupiterQuote({
      inputMint,
      outputMint,
      amount: body.amount,
      slippageBps: body.slippageBps,
    });

    const quoteId = crypto.randomUUID();
    cacheQuote(quoteId, jupQuote);

    return c.json(
      {
        quoteId,
        network,
        inputAsset: body.inputAsset,
        outputAsset: body.outputAsset,
        inAmount: jupQuote.inAmount,
        outAmount: formatOutAmount(jupQuote.outAmount, body.outputAsset),
        priceImpactPct: jupQuote.priceImpactPct,
        slippageBps: jupQuote.slippageBps,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        warning: undefined,
      },
      200,
    );
  } catch (err) {
    return c.json(
      {
        error: {
          code: "JUPITER_QUOTE_FAILED",
          message:
            err instanceof Error ? err.message : "Jupiter quote request failed",
        },
      },
      500,
    );
  }
};
app.openapi(jupiterQuoteRoute, jupiterQuoteHandler);

const jupiterSwapBuildRoute = createRoute({
  method: "post",
  path: "/v1/jupiter/swap/build",
  tags: ["Jupiter"],
  security: authSecurity,
  request: {
    body: {
      content: {
        "application/json": { schema: JupiterSwapBuildRequestSchema },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Build an unsigned public Jupiter swap transaction",
      content: { "application/json": { schema: TxBuildResponseSchema } },
    },
    500: {
      description: "Build failed",
      content: { "application/json": { schema: ErrorSchema } },
    },
    503: {
      description: "Jupiter swap unavailable on this network",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});
const jupiterSwapBuildHandler: RouteHandler<
  typeof jupiterSwapBuildRoute
> = async (c) => {
  const body = c.req.valid("json");
  const network = getSolanaNetwork();
  const requestId = crypto.randomUUID();

  if (network === "devnet") {
    return c.json(
      {
        error: {
          code: "JUPITER_DEVNET_UNAVAILABLE",
          message:
            "Jupiter swap is only available on mainnet. Switch to mainnet to use swaps.",
        },
      },
      503,
    );
  }

  try {
    // Use cached quote if quoteId provided and still valid, otherwise fetch fresh
    let jupQuote: unknown;
    if (body.quoteId) {
      const cached = getCachedQuote(body.quoteId);
      jupQuote = cached?.jupiterResponse;
    }

    if (!jupQuote) {
      const inputMint = getMintForAsset(body.inputAsset, network);
      const outputMint = getMintForAsset(body.outputAsset, network);
      jupQuote = await fetchJupiterQuote({
        inputMint,
        outputMint,
        amount: body.amount,
        slippageBps: body.slippageBps,
      });
    }

    const swapResult = await buildJupiterSwapTransaction({
      quoteResponse: jupQuote as Parameters<
        typeof buildJupiterSwapTransaction
      >[0]["quoteResponse"],
      userPublicKey: body.walletAddress,
    });

    const tx = createTx({ requestId, action: "jupiter_swap", network });

    return c.json(
      {
        requestId: tx.requestId,
        network,
        action: "jupiter_swap",
        unsignedTransactionBase64: swapResult.swapTransaction,
        lastValidBlockHeight: swapResult.lastValidBlockHeight,
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
        requiresUserSignature: true as const,
        broadcastBy: "ios" as const,
        rpcUrl: getRpcUrl(),
        warnings: ["This swap is public and not privacy-preserving."],
      },
      200,
    );
  } catch (err) {
    return c.json(
      {
        error: {
          code: "JUPITER_SWAP_BUILD_FAILED",
          message:
            err instanceof Error
              ? err.message
              : "Jupiter swap transaction build failed",
        },
      },
      500,
    );
  }
};
app.openapi(jupiterSwapBuildRoute, jupiterSwapBuildHandler);

const WrapSolBuildRequestSchema = z
  .object({
    walletAddress: PublicKeySchema,
    lamports: z
      .string()
      .regex(/^\d+$/)
      .openapi({ description: "Amount of SOL to wrap in lamports (1 SOL = 1_000_000_000)" }),
  })
  .openapi("WrapSolBuildRequest");

const WrapSolBuildResponseSchema = TxBuildResponseSchema.extend({
  ataAddress: z.string().openapi({ description: "wSOL associated token account address" }),
}).openapi("WrapSolBuildResponse");

const UnwrapSolBuildRequestSchema = z
  .object({
    walletAddress: PublicKeySchema,
  })
  .openapi("UnwrapSolBuildRequest");

const wrapSolBuildRoute = createRoute({
  method: "post",
  path: "/v1/sol/wrap/build",
  tags: ["SOL"],
  security: authSecurity,
  request: {
    body: {
      content: { "application/json": { schema: WrapSolBuildRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Build a transaction that wraps native SOL into wSOL",
      content: { "application/json": { schema: WrapSolBuildResponseSchema } },
    },
    500: {
      description: "Build failed",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});
const wrapSolBuildHandler: RouteHandler<typeof wrapSolBuildRoute> = async (c) => {
  const body = c.req.valid("json");
  try {
    const result = await buildWrapSolTransaction(body.walletAddress, BigInt(body.lamports));
    const requestId = crypto.randomUUID();
    createTx({ requestId, action: "sol_wrap", network: getSolanaNetwork() });
    return c.json(
      {
        requestId,
        network: getSolanaNetwork(),
        action: "sol_wrap",
        unsignedTransactionBase64: result.transactionBase64,
        lastValidBlockHeight: result.lastValidBlockHeight,
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
        requiresUserSignature: true as const,
        broadcastBy: "ios" as const,
        rpcUrl: getRpcUrl(),
        warnings: [] as string[],
        ataAddress: result.ataAddress,
      },
      200,
    );
  } catch (err) {
    return c.json(
      {
        error: {
          code: "SOL_WRAP_BUILD_FAILED",
          message: err instanceof Error ? err.message : "wSOL wrap build failed",
        },
      },
      500,
    );
  }
};
app.openapi(wrapSolBuildRoute, wrapSolBuildHandler);

const unwrapSolBuildRoute = createRoute({
  method: "post",
  path: "/v1/sol/unwrap/build",
  tags: ["SOL"],
  security: authSecurity,
  request: {
    body: {
      content: { "application/json": { schema: UnwrapSolBuildRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Build a transaction that closes the wSOL ATA and reclaims SOL",
      content: { "application/json": { schema: TxBuildResponseSchema } },
    },
    500: {
      description: "Build failed",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});
const unwrapSolBuildHandler: RouteHandler<typeof unwrapSolBuildRoute> = async (c) => {
  const body = c.req.valid("json");
  try {
    const result = await buildUnwrapSolTransaction(body.walletAddress);
    const requestId = crypto.randomUUID();
    createTx({ requestId, action: "sol_unwrap", network: getSolanaNetwork() });
    return c.json(
      {
        requestId,
        network: getSolanaNetwork(),
        action: "sol_unwrap",
        unsignedTransactionBase64: result.transactionBase64,
        lastValidBlockHeight: result.lastValidBlockHeight,
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
        requiresUserSignature: true as const,
        broadcastBy: "ios" as const,
        rpcUrl: getRpcUrl(),
        warnings: [] as string[],
      },
      200,
    );
  } catch (err) {
    return c.json(
      {
        error: {
          code: "SOL_UNWRAP_BUILD_FAILED",
          message: err instanceof Error ? err.message : "wSOL unwrap build failed",
        },
      },
      500,
    );
  }
};
app.openapi(unwrapSolBuildRoute, unwrapSolBuildHandler);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/tx/record-broadcast",
    tags: ["Transactions"],
    security: authSecurity,
    request: {
      body: {
        content: {
          "application/json": { schema: TxRecordBroadcastRequestSchema },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Record a transaction signature after iOS broadcasts it",
        content: { "application/json": { schema: TxStatusResponseSchema } },
      },
    },
  }),
  (c) => {
    const body = c.req.valid("json");
    const tx = storeBroadcast(body.requestId, body.signature);
    return c.json({
      requestId: tx.requestId,
      signature: tx.signature,
      status: tx.status,
    });
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/tx/{requestId}",
    tags: ["Transactions"],
    security: authSecurity,
    request: {
      params: z.object({
        requestId: z
          .string()
          .uuid()
          .openapi({ param: { name: "requestId", in: "path" } }),
      }),
    },
    responses: {
      200: {
        description: "Get transaction request status",
        content: { "application/json": { schema: TxStatusResponseSchema } },
      },
    },
  }),
  (c) => {
    const { requestId } = c.req.valid("param");
    const tx = getTx(requestId);
    return c.json({
      requestId,
      signature: tx?.signature ?? undefined,
      status: (tx ? tx.status : "unknown") as "unknown",
    });
  },
);

app.doc("/openapi.json", {
  openapi: "3.0.3",
  info: {
    title: "Hexon Backend API",
    version: "0.1.0",
    description:
      "Transaction builder API for Privy Solana wallets, Umbra privacy flows, and public Jupiter swaps.",
  },
  servers: [{ url: process.env.API_BASE_URL ?? "http://127.0.0.1:3010" }],
});

app.get(
  "/docs",
  apiReference({
    url: "/openapi.json",
    theme: "kepler",
    pageTitle: "Hexon API Docs",
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "hexon-backend",
    network: getSolanaNetwork(),
  }),
);
