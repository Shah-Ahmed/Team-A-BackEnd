import { apiHandler, json, preflight } from "@/lib/api";
import { requireMarketplaceOrgAdmin } from "@/lib/marketplaces";
import { getLatestSyncStatus } from "@/lib/marketplaceSync";

export const OPTIONS = preflight;

export const GET = apiHandler({ roles: ["admin"] }, async ({ auth }) => {
  const orgId = await requireMarketplaceOrgAdmin(auth);
  return json(await getLatestSyncStatus(orgId));
});
