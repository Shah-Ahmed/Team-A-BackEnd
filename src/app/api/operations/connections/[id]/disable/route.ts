import { apiHandler, json, preflight } from "@/lib/api";
import { docToConnection, getOwnedConnection, requireMarketplaceOrgAdmin } from "@/lib/marketplaces";

export const OPTIONS = preflight;

export const POST = apiHandler({ roles: ["admin"] }, async ({ auth, params }) => {
  const orgId = await requireMarketplaceOrgAdmin(auth);
  const { ref } = await getOwnedConnection(params.id, orgId);
  await ref.update({ isEnabled: false, updatedAt: Date.now() });
  const updated = await ref.get();
  return json(docToConnection(params.id, updated.data()!));
});
