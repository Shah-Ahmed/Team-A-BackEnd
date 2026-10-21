
import type {
  MarketplaceConnectionDoc,
  MarketplaceProvider,
} from "@/types";

// Standardized response for every provider
export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs: number;
  provider: MarketplaceProvider;
  checkedAt: number;
}

// Common interface for all marketplace adapters
export interface MarketplaceAdapter {
  readonly provider: MarketplaceProvider;

  testConnection(
    connection: MarketplaceConnectionDoc
  ): Promise<TestConnectionResult>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mock provider adapter
class MockAdapter implements MarketplaceAdapter {
  constructor(readonly provider: MarketplaceProvider) {}

  async testConnection(
    connection: MarketplaceConnectionDoc
  ): Promise<TestConnectionResult> {
    const startedAt = Date.now();

    // Simulate network delay between 300 and 1200 ms
    await sleep(300 + Math.floor(Math.random() * 900));

    // Validate connection settings
    const problems: string[] = [];

    if (!connection.isEnabled) {
      problems.push("connection is disabled");
    }

    if (!connection.secretEnvKey) {
      problems.push(
        "no credential configured (secretEnvKey missing)"
      );
    }

    if (!connection.settings?.shopId) {
      problems.push("missing required setting: shopId");
    }

    const latencyMs = Date.now() - startedAt;
    const checkedAt = Date.now();

    if (problems.length > 0) {
      return {
        success: false,
        message: `Test failed: ${problems.join(", ")}`,
        latencyMs,
        provider: this.provider,
        checkedAt,
      };
    }

    return {
      success: true,
      message: `Mock ${this.provider} connection OK (shopId: ${
        connection.settings!["shopId"]
      })`,
      latencyMs,
      provider: this.provider,
      checkedAt,
    };
  }
}

// Adapter factory
export function createAdapter(
  provider: MarketplaceProvider
): MarketplaceAdapter {
  return new MockAdapter(provider);
}

// Timeout helper
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(`Connection test timed out after ${ms} ms`)
      );
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
