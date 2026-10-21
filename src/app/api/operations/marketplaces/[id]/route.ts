import { apiHandler, json, preflight } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import {
  validateProvider,
  validateSettings,
  validateSecretEnvKey,
  docToConnection,
  getOwnedConnection,
} from "@/lib/marketplaces";

export const OPTIONS = preflight;

// ✏️ UPDATE (name/settings/provider/secretEnvKey) + 🔌 ENABLE/DISABLE (isEnabled)
export const PATCH = apiHandler(
  { roles: ["admin", "super_admin"] },
  async ({ auth, request, params }) => {
    const { id } = params;
    const { ref } = await getOwnedConnection(id, auth.orgId);

    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length < 2) {
        throw new HttpError(400, "name must be at least 2 characters");
      }
      updates.name = body.name.trim();
    }
    if (body.provider !== undefined) {
      updates.provider = validateProvider(body.provider);
    }
    if (body.settings !== undefined) {
      updates.settings = validateSettings(body.settings);
    }
    if (body.secretEnvKey !== undefined) {
      updates.secretEnvKey = validateSecretEnvKey(body.secretEnvKey);
    }
    // 🔌 enable / disable — bas true/false bhejo
    if (body.isEnabled !== undefined) {
      if (typeof body.isEnabled !== "boolean") {
        throw new HttpError(400, "isEnabled must be true or false");
      }
      updates.isEnabled = body.isEnabled;
    }

    await ref.update(updates);
    const doc = await ref.get();
    return json({ item: docToConnection(id, doc.data()!) });
  }
);

// 🗑️ DELETE (soft — record rehta hai, sirf isActive false)
export const DELETE = apiHandler(
  { roles: ["admin", "super_admin"] },
  async ({ auth, params }) => {
    const { id } = params;
    const { ref } = await getOwnedConnection(id, auth.orgId);

    await ref.update({
      isActive: false,
      isEnabled: false,
      updatedAt: Date.now(),
    });

    return json({ success: true });
  }
);