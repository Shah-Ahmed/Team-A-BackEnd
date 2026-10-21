import { apiHandler, json, preflight } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { getAdminDb } from "@/lib/firebaseAdmin";
import {
  COLLECTION,
  validateProvider,
  validateSettings,
  validateSecretEnvKey,
  docToConnection,
} from "@/lib/marketplaces";

export const OPTIONS = preflight;

// 📋 LIST: meri organization ki saari active connections
export const GET = apiHandler(
  { roles: ["user", "admin", "super_admin"] },
  async ({ auth }) => {
  const db = getAdminDb();
  const snap = await db.collection(COLLECTION).get();

  const items = snap.docs
    .filter((d) => d.data().orgId === auth.orgId && d.data().isActive === true)
    .sort((a, b) => (b.data().createdAt ?? 0) - (a.data().createdAt ?? 0))
    .map((d) => docToConnection(d.id, d.data()));
  return json({ items });
});

// ➕ CREATE: nayi connection
export const POST = apiHandler({ roles: ["admin", "super_admin"] }, async ({ auth, request }) => {
  const db = getAdminDb();
  const body = await request.json();

  if (typeof body.name !== "string" || body.name.trim().length < 2) {
    throw new HttpError(400, "name is required (min 2 characters)");
  }

  const provider = validateProvider(body.provider);
  const settings = validateSettings(body.settings);
  const secretEnvKey = validateSecretEnvKey(body.secretEnvKey);

  const now = Date.now();
  const ref = db.collection(COLLECTION).doc();

  await ref.set({
    orgId: auth.orgId, // 🔒 token se aya — client ka diya hua trust NAHI
    provider,
    name: body.name.trim(),
    settings,
    secretEnvKey, // sirf naam, asli secret nahi
    isEnabled: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  const doc = await ref.get();
  return json({ item: docToConnection(ref.id, doc.data()!) }, 201);
});