import { HttpError } from "@/lib/errors";
import { getAdminDb } from "@/lib/firebaseAdmin";
import type { AuthUser, MarketplaceProvider } from "@/types";

export const COLLECTION = "marketplaceConnections";
export const SECRET_COLLECTION = "marketplaceConnectionSecrets";
export const JOB_COLLECTION = "marketplaceSyncJobs";
export const RECORD_COLLECTION = "marketplaceSyncRecords";
export const LOCK_COLLECTION = "marketplaceSyncLocks";

export const ALLOWED_PROVIDERS: MarketplaceProvider[] = [
  "shopify",
  "amazon",
  "ebay",
  "woocommerce",
  "etsy",
  "custom",
];

export const SECRET_FIELDS: Record<MarketplaceProvider, string[]> = {
  shopify: ["accessToken"],
  amazon: ["apiKey", "secretKey", "accessToken"],
  ebay: ["apiKey", "secretKey", "accessToken"],
  woocommerce: ["apiKey", "secretKey"],
  etsy: ["apiKey", "accessToken"],
  custom: ["apiKey", "secretKey", "accessToken"],
};

const REQUIRED_SECRET_FIELDS: Partial<Record<MarketplaceProvider, string[]>> = {
  shopify: ["accessToken"],
  amazon: ["apiKey", "secretKey", "accessToken"],
  ebay: ["apiKey", "secretKey", "accessToken"],
  woocommerce: ["apiKey", "secretKey"],
  etsy: ["apiKey", "accessToken"],
};

const SETTINGS_FIELDS: Record<MarketplaceProvider, string[]> = {
  shopify: ["storeUrl"],
  amazon: ["sellerId", "marketplaceId"],
  ebay: [],
  woocommerce: ["storeUrl"],
  etsy: [],
  custom: ["storeUrl"],
};

const REQUIRED_SETTINGS: Partial<Record<MarketplaceProvider, string[]>> = {
  shopify: ["storeUrl"],
  amazon: ["sellerId", "marketplaceId"],
  woocommerce: ["storeUrl"],
};

export type SafeConnection = {
  id: string;
  provider: MarketplaceProvider;
  name: string;
  enabled: boolean;
  status: "connected" | "disconnected" | "error" | "pending" | "mock";
  credentialsConfigured: boolean;
  storeUrl: string | null;
  sellerId: string | null;
  marketplaceId: string | null;
  lastTestedAt: number | null;
  lastSyncAt: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export async function requireMarketplaceOrgAdmin(auth: AuthUser): Promise<string> {
  if (auth.role !== "admin" || !auth.orgId) {
    throw new HttpError(403, "Marketplace operations require an organization admin");
  }

  const db = getAdminDb();
  const [userSnap, orgSnap] = await Promise.all([
    db.collection("users").doc(auth.uid).get(),
    db.collection("organizations").doc(auth.orgId).get(),
  ]);
  const user = userSnap.data();
  const org = orgSnap.data();

  if (
    !userSnap.exists ||
    user?.isActive !== true ||
    user?.role !== "admin" ||
    user?.orgId !== auth.orgId ||
    !orgSnap.exists ||
    org?.isActive !== true
  ) {
    throw new HttpError(403, "Your organization admin access is not active");
  }

  return auth.orgId;
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    return parseJsonObject(await request.json());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Request body must contain valid JSON");
  }
}

export function validateProvider(provider: unknown): MarketplaceProvider {
  if (
    typeof provider !== "string" ||
    !ALLOWED_PROVIDERS.includes(provider as MarketplaceProvider)
  ) {
    throw new HttpError(400, `Invalid provider. Allowed: ${ALLOWED_PROVIDERS.join(", ")}`);
  }
  return provider as MarketplaceProvider;
}

export function validateName(name: unknown): string {
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120) {
    throw new HttpError(400, "name must be between 2 and 120 characters");
  }
  return name.trim();
}

function validateSettingValue(key: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2048) {
    throw new HttpError(400, `${key} must be a non-empty string of at most 2048 characters`);
  }
  const trimmed = value.trim();
  if (key === "storeUrl") {
    try {
      const url = new URL(trimmed);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new Error("invalid URL");
      }
      return url.toString().replace(/\/$/, "");
    } catch {
      throw new HttpError(400, "storeUrl must be a valid HTTP or HTTPS URL");
    }
  }
  return trimmed;
}

export function settingsFromPayload(
  provider: MarketplaceProvider,
  body: Record<string, unknown>,
  existing: Record<string, string> = {},
): Record<string, string> {
  const incoming = body.settings === undefined ? {} : body.settings;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    throw new HttpError(400, "settings must be an object");
  }

  const merged = { ...existing };
  for (const key of SETTINGS_FIELDS[provider]) {
    const raw = body[key] !== undefined ? body[key] : (incoming as Record<string, unknown>)[key];
    if (raw === undefined) continue;
    if (raw === null || raw === "") {
      delete merged[key];
      continue;
    }
    merged[key] = validateSettingValue(key, raw);
  }
  for (const key of REQUIRED_SETTINGS[provider] ?? []) {
    if (!merged[key]) throw new HttpError(400, `${key} is required for ${provider}`);
  }
  return merged;
}

export function secretsFromPayload(
  provider: MarketplaceProvider,
  body: Record<string, unknown>,
): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const key of SECRET_FIELDS[provider]) {
    const value = body[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || value.length > 8192 || value.trim().length === 0) {
      throw new HttpError(400, `${key} must be a non-empty string of at most 8192 characters`);
    }
    secrets[key] = value.trim();
  }
  return secrets;
}

export function validateCompleteSecrets(
  provider: MarketplaceProvider,
  secrets: Record<string, string>,
): void {
  const required = REQUIRED_SECRET_FIELDS[provider] ?? [];
  const anyRequired = required.some((key) => Boolean(secrets[key]));
  if (anyRequired && required.some((key) => !secrets[key])) {
    throw new HttpError(400, `Provide all required credential fields for ${provider}, or leave them blank for mock mode`);
  }
}

export function docToConnection(id: string, data: FirebaseFirestore.DocumentData): SafeConnection {
  const enabled = data.isEnabled === true;
  const lastTestSuccess = data.lastTestSuccess;
  let status: SafeConnection["status"] = enabled ? "pending" : "disconnected";
  if (enabled && lastTestSuccess === true) {
    status = data.lastTestMode === "mock" ? "mock" : "connected";
  } else if (enabled && lastTestSuccess === false) {
    status = "error";
  }

  return {
    id,
    provider: data.provider as MarketplaceProvider,
    name: typeof data.name === "string" ? data.name : "Marketplace connection",
    enabled,
    status,
    credentialsConfigured: data.credentialsConfigured === true || Boolean(data.secretEnvKey),
    storeUrl: typeof data.settings?.storeUrl === "string" ? data.settings.storeUrl : null,
    sellerId: typeof data.settings?.sellerId === "string" ? data.settings.sellerId : null,
    marketplaceId: typeof data.settings?.marketplaceId === "string" ? data.settings.marketplaceId : null,
    lastTestedAt: typeof data.lastTestAt === "number" ? data.lastTestAt : null,
    lastSyncAt: typeof data.lastSyncAt === "number" ? data.lastSyncAt : null,
    errorMessage: lastTestSuccess === false && typeof data.lastTestMessage === "string"
      ? data.lastTestMessage
      : null,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export async function getOwnedConnection(id: string, orgId: string) {
  const ref = getAdminDb().collection(COLLECTION).doc(id);
  const doc = await ref.get();
  const data = doc.data();
  if (!doc.exists || !data || data.isActive !== true || data.orgId !== orgId) {
    throw new HttpError(404, "Marketplace connection not found");
  }
  return { ref, data };
}

export async function listOwnedConnections(orgId: string) {
  const snap = await getAdminDb().collection(COLLECTION).where("orgId", "==", orgId).get();
  return snap.docs
    .filter((doc) => doc.data().isActive === true)
    .sort((a, b) => (b.data().createdAt ?? 0) - (a.data().createdAt ?? 0))
    .map((doc) => docToConnection(doc.id, doc.data()));
}

export function safeErrorMessage(_error: unknown): string {
  return "The operation could not be completed. Check server configuration and retry.";
}
