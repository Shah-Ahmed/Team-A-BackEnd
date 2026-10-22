import { apiHandler, json, preflight } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { requireMarketplaceOrgAdmin } from "@/lib/marketplaces";
import { listOrgJobs } from "@/lib/marketplaceSync";

const ALLOWED_STATUSES = new Set(["running", "completed", "failed", "partial", "retrying"]);

function positiveInteger(value: string | null, fallback: number, max: number): number {
  if (value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) {
    throw new HttpError(400, `Query value must be an integer between 1 and ${max}`);
  }
  return number;
}

function parseDate(value: string | null, endOfDay = false): number | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, "Dates must use YYYY-MM-DD");
  const ms = Date.parse(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (!Number.isFinite(ms)) throw new HttpError(400, "Date filter is invalid");
  return ms;
}

export const OPTIONS = preflight;

export const GET = apiHandler({ roles: ["admin"] }, async ({ auth, request }) => {
  const orgId = await requireMarketplaceOrgAdmin(auth);
  const url = new URL(request.url);
  const page = positiveInteger(url.searchParams.get("page"), 1, 1_000_000);
  const pageSize = positiveInteger(url.searchParams.get("pageSize"), 20, 100);
  const status = url.searchParams.get("status") || "";
  const connectionId = url.searchParams.get("connectionId") || "";
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  if (status && !ALLOWED_STATUSES.has(status)) throw new HttpError(400, "status filter is invalid");
  if (search.length > 120) throw new HttpError(400, "search must be at most 120 characters");
  const dateFrom = parseDate(url.searchParams.get("dateFrom"));
  const dateTo = parseDate(url.searchParams.get("dateTo"), true);
  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
    throw new HttpError(400, "dateFrom must be on or before dateTo");
  }

  let jobs = await listOrgJobs(orgId);
  jobs = jobs.filter((job) => {
    if (status && job.status !== status) return false;
    if (connectionId && job.connectionId !== connectionId) return false;
    if (dateFrom !== null && job.startedAt < dateFrom) return false;
    if (dateTo !== null && job.startedAt > dateTo) return false;
    if (search && ![
      job.id,
      job.connectionName,
      job.provider,
      job.errorMessage ?? "",
    ].some((field) => field.toLowerCase().includes(search))) return false;
    return true;
  }).sort((a, b) => b.startedAt - a.startedAt);

  const total = jobs.length;
  const start = (page - 1) * pageSize;
  return json({ jobs: jobs.slice(start, start + pageSize), total, page, pageSize });
});
