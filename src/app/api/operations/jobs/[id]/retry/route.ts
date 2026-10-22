import { apiHandler, json, preflight } from "@/lib/api";
import { retryJob } from "@/lib/marketplaceSync";
import { requireMarketplaceOrgAdmin } from "@/lib/marketplaces";

export const OPTIONS = preflight;

export const POST = apiHandler({ roles: ["admin"] }, async ({ auth, params }) => {
  const orgId = await requireMarketplaceOrgAdmin(auth);
  const job = await retryJob(orgId, params.id);
  return json({
    jobId: job.id,
    message: job.status === "completed"
      ? "Mock retry completed. No live marketplace API request was made."
      : job.errorMessage ?? "Mock retry failed.",
  }, 202);
});
