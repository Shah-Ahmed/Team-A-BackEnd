import { HttpError } from "@/lib/errors";
import { getAdminDb } from "@/lib/firebaseAdmin";
import type { MarketplaceConnectionDoc, MarketplaceProvider } from "@/types";

export const COLLECTION = "marketplaceConnections";

export const ALLOWED_PROVIDERS: MarketplaceProvider[] = [
  "daraz",
  "shopify",
  "amazon",
  "ebay",
];

export function validateProvider(provider: unknown): MarketplaceProvider {
  if (
    typeof provider !== "string" ||
    !ALLOWED_PROVIDERS.includes(provider as MarketplaceProvider)
  ) {
    throw new HttpError(400, `Invalid provider. Allowed: ${ALLOWED_PROVIDERS.join(", ")}`);
  }
  return provider as MarketplaceProvider;
}

export function validateSettings(settings: unknown): Record<string, string> {
  if (settings === undefined || settings === null) return {};
  if (typeof settings !== "object" || Array.isArray(settings)) {
    throw new HttpError(400, "settings must be an object like { shopId: '123' }");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
    if (typeof value !== "string") {
      throw new HttpError(400, `Setting "${key}" must be a string`);
    }
    out[key] = value;
  }
  return out;
}

// ✅ SECURITY RULE: asli secret yahan KABHI nahi aata.
// Sirf secretEnvKey (reference naam) save hota hai.
export function validateSecretEnvKey(key: unknown): string | null {
  if (key === undefined || key === null || key === "") return null;
  if (typeof key !== "string" || !/^[A-Z0-9_]+$/.test(key)) {
    throw new HttpError(400, "secretEnvKey must be UPPERCASE letters/numbers/underscore e.g. DARAZ_SECRET_TEAM_A");
  }
  return key;
}

export function docToConnection(
  id: string,
  data: FirebaseFirestore.DocumentData
): MarketplaceConnectionDoc {
  return {
    id,
    orgId: data.orgId,
    provider: data.provider,
    name: data.name,
    settings: data.settings ?? {},
    secretEnvKey: data.secretEnvKey ?? null,
    // 🔑 masked state — saved secret value kabhi wapas nahi bhejte
    hasSecret: Boolean(data.secretEnvKey),
    isEnabled: data.isEnabled,
    isActive: data.isActive,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

// 🔒 helper: sirf MERI org ki, active connection lao (404 agar nahi mili)
// 🔒 helper: sirf MERI org ki, active connection lao (404 agar nahi mili)
export async function getOwnedConnection(id: string, orgId: string | null) {
  const db = getAdminDb();
  const ref = db.collection(COLLECTION).doc(id);
  const doc = await ref.get();
  if (!doc.exists || doc.data()!.isActive !== true || doc.data()!.orgId !== orgId) {
    throw new HttpError(404, "Marketplace connection not found");
  }
  return { ref, data: doc.data()! };
}