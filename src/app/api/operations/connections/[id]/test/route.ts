import { apiHandler, json, preflight } from "@/lib/api";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { createAdapter, withTimeout } from "@/lib/marketplaceAdapters";
import {
  getOwnedConnection,
  requireMarketplaceOrgAdmin,
} from "@/lib/marketplaces";
import type { MarketplaceConnectionDoc } from "@/types";

export const OPTIONS = preflight;

export const POST = apiHandler({ roles: ["admin"] }, async ({ auth, params }) => {
  const orgId = await requireMarketplaceOrgAdmin(auth);
  const { ref, data } = await getOwnedConnection(params.id, orgId);
  const provider = data.provider;
  const connection: MarketplaceConnectionDoc = {
    id: params.id,
    orgId,
    provider,
    name: data.name,
    settings: data.settings ?? {},
    hasSecret: data.credentialsConfigured === true,
    isEnabled: data.isEnabled === true,
    isActive: data.isActive === true,
    createdAt: data.createdAt ?? 0,
    updatedAt: data.updatedAt ?? 0,
  };
  const adapter = createAdapter(provider);
  let result;
  try {
    result = await withTimeout(adapter.testConnection(connection), 10_000);
  } catch {
    result = {
      success: false,
      message: "Mock connection test timed out. No live marketplace API request was made.",
      latencyMs: 10_000,
      provider,
      checkedAt: Date.now(),
      mode: "mock" as const,
    };
  }

  await ref.update({
    lastTestAt: result.checkedAt,
    lastTestSuccess: result.success,
    lastTestMode: result.mode,
    lastTestMessage: result.message,
    updatedAt: Date.now(),
  });

  return json(result);
});
