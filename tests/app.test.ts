import { describe, expect, it, vi } from "vitest";

vi.mock("../src/services/umbra.js", async () => {
  const { masterSeedSchemeCurrent } =
    await import("@umbra-privacy/sdk/master-seed-schemes");
  return {
    UMBRA_MESSAGE_TO_SIGN: masterSeedSchemeCurrent.messageToSign,
    buildUmbraRegisterTransactions: vi.fn(),
    buildUmbraShieldTransaction: vi.fn(),
    buildUmbraWithdrawTransaction: vi.fn(),
  };
});

import { app } from "../src/app.js";

async function withSolanaNetwork<T>(
  network: "devnet" | "mainnet",
  callback: () => Promise<T>,
) {
  const previous = process.env.SOLANA_NETWORK;
  process.env.SOLANA_NETWORK = network;

  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.SOLANA_NETWORK;
    } else {
      process.env.SOLANA_NETWORK = previous;
    }
  }
}

function jsonRequest(body: unknown) {
  return {
    method: "POST",
    headers: {
      authorization: "Bearer test-privy-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

describe("Hexon API app", () => {
  const walletAddress = "11111111111111111111111111111111";
  const recipientWalletAddress = "So11111111111111111111111111111111111111112";

  it("serves health checks", async () => {
    const response = await app.request("/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      service: "hexon-backend",
      network: "devnet",
    });
  });

  it("serves OpenAPI JSON with expected paths and bearer auth", async () => {
    const response = await app.request("/openapi.json");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.openapi).toBe("3.0.3");
    expect(body.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(body.components.schemas.Network.enum).toEqual(["devnet", "mainnet"]);
    expect(body.paths["/v1/umbra/private-send/build"]).toBeDefined();
    expect(body.paths["/v1/jupiter/swap/build"]).toBeDefined();
  });

  it("serves the Umbra message-to-sign endpoint", async () => {
    const response = await app.request("/v1/umbra/message-to-sign");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(typeof body.message).toBe("string");
    expect(body.message).toContain("Umbra Protocol");
    expect(body.message.length).toBeGreaterThan(100);
  });

  it("serves Scalar docs HTML", async () => {
    const response = await app.request("/docs");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Hexon API Docs");
  });

  it("syncs a valid session payload", async () => {
    const response = await app.request(
      "/v1/session/sync",
      jsonRequest({
        walletAddress,
        deviceId: "ios-device-1",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.walletAddress).toBe(walletAddress);
    expect(body.network).toBe("devnet");
    expect(body.userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects invalid session payloads", async () => {
    const response = await app.request(
      "/v1/session/sync",
      jsonRequest({
        walletAddress: "bad",
        deviceId: "short",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("returns public SOL and USDC balance placeholders", async () => {
    const response = await app.request(`/v1/balances/${walletAddress}`, {
      headers: { authorization: "Bearer test-privy-token" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.walletAddress).toBe(walletAddress);
    expect(
      body.balances.map((balance: { asset: string }) => balance.asset),
    ).toEqual(["SOL", "USDC"]);
  });

  it("returns a structured unavailable response for Umbra while devnet is blocked", async () => {
    const umbraSignature = "A".repeat(86) + "==";
    const response = await app.request(
      "/v1/umbra/private-send/build",
      jsonRequest({
        senderWalletAddress: walletAddress,
        umbraSignature,
        recipientWalletAddress,
        asset: "USDC",
        amount: "1000000",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toMatch(/^UMBRA_/);
  });

  it("returns mainnet metadata when SOLANA_NETWORK is mainnet", async () => {
    await withSolanaNetwork("mainnet", async () => {
      const healthResponse = await app.request("/health");
      const health = await healthResponse.json();
      expect(health.network).toBe("mainnet");

      const sessionResponse = await app.request(
        "/v1/session/sync",
        jsonRequest({
          walletAddress,
          deviceId: "ios-device-1",
        }),
      );
      const session = await sessionResponse.json();
      expect(session.network).toBe("mainnet");

      const balanceResponse = await app.request(
        `/v1/balances/${walletAddress}`,
        {
          headers: { authorization: "Bearer test-privy-token" },
        },
      );
      const balances = await balanceResponse.json();
      expect(balances.network).toBe("mainnet");
      expect(
        balances.balances.find(
          (balance: { asset: string }) => balance.asset === "USDC",
        ).mint,
      ).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

      const umbraSignature = "A".repeat(86) + "==";
      const umbraResponse = await app.request(
        "/v1/umbra/private-send/build",
        jsonRequest({
          senderWalletAddress: walletAddress,
          umbraSignature,
          recipientWalletAddress,
          asset: "USDC",
          amount: "1000000",
        }),
      );
      const umbra = await umbraResponse.json();
      expect(umbraResponse.status).toBe(503);
      expect(umbra.error.code).toMatch(/^UMBRA_/);
    });
  });

  it("rejects same-asset Jupiter quotes", async () => {
    const response = await app.request(
      "/v1/jupiter/quote",
      jsonRequest({
        walletAddress,
        inputAsset: "SOL",
        outputAsset: "SOL",
        amount: "1000",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects Jupiter swap on devnet with structured error", async () => {
    const response = await app.request(
      "/v1/jupiter/swap/build",
      jsonRequest({
        walletAddress,
        inputAsset: "SOL",
        outputAsset: "USDC",
        amount: "10000000",
        slippageBps: 50,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("JUPITER_DEVNET_UNAVAILABLE");
  });

  it("returns privacy warning in Jupiter swap response on mainnet", async () => {
    await withSolanaNetwork("mainnet", async () => {
      const response = await app.request(
        "/v1/jupiter/swap/build",
        jsonRequest({
          walletAddress,
          inputAsset: "SOL",
          outputAsset: "USDC",
          amount: "10000000",
          slippageBps: 50,
        }),
      );
      const body = await response.json();

      // Real Jupiter is called on mainnet — may succeed (200) or fail (500) depending on network.
      // Either way the privacy warning must be present on success, or an error code on failure.
      if (response.status === 200) {
        expect(body.warnings).toContain(
          "This swap is public and not privacy-preserving.",
        );
        expect(body.action).toBe("jupiter_swap");
      } else {
        expect(body.error.code).toMatch(/^JUPITER_/);
      }
    });
  });
});
