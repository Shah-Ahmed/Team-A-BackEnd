import type { MarketplaceConnectionDoc, MarketplaceProvider } from "@/types";

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs: number;
  provider: MarketplaceProvider;
  checkedAt: number;
  mode: "mock";
}

export interface MarketplaceAdapter {
  readonly provider: MarketplaceProvider;
  testConnection(connection: MarketplaceConnectionDoc): Promise<TestConnectionResult>;
}

class MockAdapter implements MarketplaceAdapter {
  constructor(readonly provider: MarketplaceProvider) {}

  async testConnection(connection: MarketplaceConnectionDoc): Promise<TestConnectionResult> {
    const startedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const enabled = connection.isEnabled;
    return {
      success: enabled,
      message: enabled
        ? "Mock validation passed. No live marketplace API request was made."
        : "Enable this connection before testing it.",
      latencyMs: Date.now() - startedAt,
      provider: this.provider,
      checkedAt: Date.now(),
      mode: "mock",
    };
  }
}

export function createAdapter(provider: MarketplaceProvider): MarketplaceAdapter {
  return new MockAdapter(provider);
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
