import { apiHandler, json, preflight } from "@/lib/api";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { encryptMarketplaceSecrets } from "@/lib/marketplaceSecrets";
import {
  COLLECTION,
  SECRET_COLLECTION,
  docToConnection,
  listOwnedConnections,
  readJsonObject,
  requireMarketplaceOrgAdmin,
  secretsFromPayload,
  settingsFromPayload,
  validateCompleteSecrets,
  validateName,
  validateProvider,
} from "@/lib/marketplaces";

export const OPTIONS = preflight;

export const GET = apiHandler({ roles: ["admin"] }, async ({ auth }) => {
  const orgId = await requireMarketplaceOrgAdmin(auth);
  return json(await listOwnedConnections(orgId));
});

export const POST = apiHandler({ roles: ["admin"] }, async ({ auth, request }) => {
  const orgId = await requireMarketplaceOrgAdmin(auth);
  const body = await readJsonObject(request);
  const provider = validateProvider(body.provider);
  const name = validateName(body.name);
  const settings = settingsFromPayload(provider, body);
  const secrets = secretsFromPayload(provider, body);
  validateCompleteSecrets(provider, secrets);

  const db = getAdminDb();
  const connectionRef = db.collection(COLLECTION).doc();
  const now = Date.now();
  const connectionData = {
    orgId,
    provider,
    name,
    settings,
    credentialsConfigured: Object.keys(secrets).length > 0,
    isEnabled: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  const batch = db.batch();
  batch.set(connectionRef, connectionData);
  if (Object.keys(secrets).length > 0) {
    batch.set(
      db.collection(SECRET_COLLECTION).doc(connectionRef.id),
      encryptMarketplaceSecrets(secrets),
    );
  }
  await batch.commit();
  return json(docToConnection(connectionRef.id, connectionData), 201);
});
