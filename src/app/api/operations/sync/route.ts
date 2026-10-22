import { apiHandler, json, preflight } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { readJsonObject, requireMarketplaceOrgAdmin } from "@/lib/marketplaces";
import { runMockSync } from "@/lib/marketplaceSync";

export const OPTIONS = preflight;

export const POST = apiHandler({ roles: ["admin"] }, async ({ auth, request }) => {
  const orgId = await requireMarketplaceOrgAdmin(auth);
  const body = await readJsonObject(request);
  if (typeof body.connectionId !== "string" || body.connectionId.trim().length === 0) {
    throw new HttpError(400, "connectionId is required");
  }
  const job = await runMockSync(orgId, body.connectionId.trim());
  return json({
    jobId: job.id,
    status: job.status,
    message: job.status === "completed"
      ? "Mock sync completed. No live marketplace API request was made."
      : job.errorMessage ?? "Mock sync failed.",
  }, 202);
});
