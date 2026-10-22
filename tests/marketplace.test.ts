import assert from "node:assert/strict";
import { test } from "node:test";
import {
  docToConnection,
  secretsFromPayload,
  settingsFromPayload,
  validateCompleteSecrets,
  validateProvider,
} from "../src/lib/marketplaces";
import {
  decryptMarketplaceSecrets,
  encryptMarketplaceSecrets,
} from "../src/lib/marketplaceSecrets";
import { createAdapter } from "../src/lib/marketplaceAdapters";
import type { MarketplaceConnectionDoc } from "../src/types";

test("provider validation only accepts Team A providers", () => {
  assert.equal(validateProvider("shopify"), "shopify");
  assert.throws(() => validateProvider("unsupported"));
});

test("required non-secret settings are validated and normalized", () => {
  assert.deepEqual(
    settingsFromPayload("shopify", { storeUrl: "https://store.example/" }),
    { storeUrl: "https://store.example" },
  );
  assert.throws(() => settingsFromPayload("amazon", { sellerId: "seller" }));
});

test("secret validation supports mock mode and rejects incomplete credential sets", () => {
  const mockSecrets = secretsFromPayload("woocommerce", {});
  assert.deepEqual(mockSecrets, {});
  assert.doesNotThrow(() => validateCompleteSecrets("woocommerce", mockSecrets));
  assert.throws(() =>
    validateCompleteSecrets("woocommerce", { apiKey: "key-only" }),
  );
});

test("connection serialization exposes status metadata but no secret values", () => {
  const response = docToConnection("connection-1", {
    provider: "shopify",
    name: "Demo store",
    settings: { storeUrl: "https://store.example", sellerId: "seller-id" },
    credentialsConfigured: true,
    isEnabled: true,
    isActive: true,
    lastTestSuccess: true,
    lastTestMode: "mock",
    lastTestAt: 123,
    createdAt: 1,
    updatedAt: 2,
    accessToken: "must-not-leak",
  });
  assert.equal(response.status, "mock");
  assert.equal(response.credentialsConfigured, true);
  assert.equal("accessToken" in response, false);
  assert.equal("orgId" in response, false);
});

test("marketplace credential encryption round-trips with the backend key", () => {
  const previousKey = process.env.MARKETPLACE_ENCRYPTION_KEY;
  process.env.MARKETPLACE_ENCRYPTION_KEY = "a".repeat(64);
  try {
    const encrypted = encryptMarketplaceSecrets({ accessToken: "fixture-token" });
    assert.equal(JSON.stringify(encrypted).includes("fixture-token"), false);
    assert.deepEqual(decryptMarketplaceSecrets(encrypted), {
      accessToken: "fixture-token",
    });
  } finally {
    if (previousKey === undefined) delete process.env.MARKETPLACE_ENCRYPTION_KEY;
    else process.env.MARKETPLACE_ENCRYPTION_KEY = previousKey;
  }
});

test("mock adapter explicitly identifies that it does not call a live provider", async () => {
  const connection: MarketplaceConnectionDoc = {
    id: "connection-1",
    orgId: "org-1",
    provider: "shopify",
    name: "Demo store",
    settings: {},
    hasSecret: false,
    isEnabled: true,
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  };
  const result = await createAdapter("shopify").testConnection(connection);
  assert.equal(result.success, true);
  assert.equal(result.mode, "mock");
  assert.match(result.message, /No live marketplace API request was made/);
});
