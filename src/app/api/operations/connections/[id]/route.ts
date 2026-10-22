import { apiHandler, json, preflight } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { encryptMarketplaceSecrets, decryptMarketplaceSecrets } from "@/lib/marketplaceSecrets";
import {
  COLLECTION,
  SECRET_COLLECTION,
  docToConnection,
  getOwnedConnection,
  readJsonObject,
  requireMarketplaceOrgAdmin,
  secretsFromPayload,
  settingsFromPayload,
  validateCompleteSecrets,
  validateName,
} from "@/lib/marketplaces";

export const OPTIONS = preflight;

export const GET = apiHandler({ roles: ["admin"] }, async ({ auth, params }) => {
  const orgId = await requireMarketplaceOrgAdmin(auth);
  const { data } = await getOwnedConnection(params.id, orgId);
  return json(docToConnection(params.id, data));
});

export const PUT = apiHandler({ roles: ["admin"] }, async ({ auth, params, request }) => {
  const orgId = await requireMarketplaceOrgAdmin(auth);
  const { ref, data } = await getOwnedConnection(params.id, orgId);
  const body = await readJsonObject(request);
  const updates: Record<string, unknown> = { updatedAt: Date.now() };

  if (body.provider !== undefined && body.provider !== data.provider) {
    throw new HttpError(400, "Create a new connection to change providers");
  }
  if (body.name !== undefined) updates.name = validateName(body.name);
  if (
    body.storeUrl !== undefined ||
    body.sellerId !== undefined ||
    body.marketplaceId !== undefined ||
    body.settings !== undefined
  ) {
    updates.settings = settingsFromPayload(
      data.provider,
      body,
      (data.settings ?? {}) as Record<string, string>,
    );
  }

  if (body.isEnabled !== undefined && typeof body.isEnabled !== "boolean") {
    throw new HttpError(400, "isEnabled must be a boolean");
  }

  const incomingSecrets = secretsFromPayload(data.provider, body);
  if (Object.keys(incomingSecrets).length > 0) {
    const secretRef = getAdminDb().collection(SECRET_COLLECTION).doc(params.id);
    const existing = await secretRef.get();
    const priorSecrets = existing.exists
      ? decryptMarketplaceSecrets(existing.data() as Parameters<typeof decryptMarketplaceSecrets>[0])
      : {};
    const mergedSecrets = { ...priorSecrets, ...incomingSecrets };
    validateCompleteSecrets(data.provider, mergedSecrets);
    updates.credentialsConfigured = true;
    const batch = getAdminDb().batch();
    batch.update(ref, updates);
    batch.set(secretRef, encryptMarketplaceSecrets(mergedSecrets));
    await batch.commit();
    const updated = await ref.get();
    return json(docToConnection(params.id, updated.data()!));
  }

  if (body.isEnabled !== undefined) {
    updates.isEnabled = body.isEnabled;
  }

  await ref.update(updates);
  const updated = await ref.get();
  return json(docToConnection(params.id, updated.data()!));
});

export const PATCH = PUT;

export const DELETE = apiHandler({ roles: ["admin"] }, async ({ auth, params }) => {
  const orgId = await requireMarketplaceOrgAdmin(auth);
  const { ref } = await getOwnedConnection(params.id, orgId);
  const db = getAdminDb();
  const batch = db.batch();
  batch.update(ref, {
    isActive: false,
    isEnabled: false,
    credentialsConfigured: false,
    updatedAt: Date.now(),
  });
  batch.delete(db.collection(SECRET_COLLECTION).doc(params.id));
  await batch.commit();
  return json({ success: true });
});
