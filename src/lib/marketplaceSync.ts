import { createHash } from "node:crypto";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { HttpError } from "@/lib/errors";
import {
  COLLECTION,
  JOB_COLLECTION,
  LOCK_COLLECTION,
  RECORD_COLLECTION,
  getOwnedConnection,
  safeErrorMessage,
} from "@/lib/marketplaces";
import type { MarketplaceProvider } from "@/types";

type SyncStatus = "running" | "completed" | "failed" | "partial";
type TriggeredBy = "manual" | "retry";

interface SampleRecord {
  type: "order" | "inventory";
  externalId: string;
  orderId: string | null;
  sku: string;
  quantity: number;
  status: string;
}

const MOCK_RECORDS: SampleRecord[] = [
  { type: "order", externalId: "mock-order-1001", orderId: "ORD-1001", sku: "DEMO-TEE-BLK-M", quantity: 2, status: "processing" },
  { type: "order", externalId: "mock-order-1002", orderId: "ORD-1002", sku: "DEMO-MUG-WHT", quantity: 1, status: "shipped" },
  { type: "order", externalId: "mock-order-1003", orderId: "ORD-1003", sku: "DEMO-BAG-NAT", quantity: 3, status: "pending" },
  { type: "inventory", externalId: "mock-stock-2001", orderId: null, sku: "DEMO-TEE-BLK-M", quantity: 18, status: "in_stock" },
  { type: "inventory", externalId: "mock-stock-2002", orderId: null, sku: "DEMO-MUG-WHT", quantity: 4, status: "low_stock" },
  { type: "inventory", externalId: "mock-stock-2003", orderId: null, sku: "DEMO-BAG-NAT", quantity: 0, status: "out_of_stock" },
];

function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export interface SafeSyncJob {
  id: string;
  connectionId: string;
  connectionName: string;
  provider: MarketplaceProvider;
  status: SyncStatus;
  startedAt: number;
  completedAt: number | null;
  processedCount: number;
  successCount: number;
  failedCount: number;
  duplicateCount: number;
  errorMessage: string | null;
  triggeredBy: TriggeredBy;
  retryOfJobId: string | null;
}

export function jobToResponse(id: string, data: FirebaseFirestore.DocumentData): SafeSyncJob {
  return {
    id,
    connectionId: String(data.connectionId ?? ""),
    connectionName: String(data.connectionName ?? ""),
    provider: data.provider as MarketplaceProvider,
    status: data.status as SyncStatus,
    startedAt: Number(data.startedAt ?? 0),
    completedAt: typeof data.completedAt === "number" ? data.completedAt : null,
    processedCount: Number(data.processedCount ?? 0),
    successCount: Number(data.successCount ?? 0),
    failedCount: Number(data.failedCount ?? 0),
    duplicateCount: Number(data.duplicateCount ?? 0),
    errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : null,
    triggeredBy: data.triggeredBy === "retry" ? "retry" : "manual",
    retryOfJobId: typeof data.retryOfJobId === "string" ? data.retryOfJobId : null,
  };
}

function normalizeRecord(record: SampleRecord) {
  return {
    recordType: record.type,
    externalId: record.externalId,
    orderId: record.orderId ? record.orderId.trim().toUpperCase() : null,
    sku: record.sku.trim().toUpperCase(),
    quantity: Math.max(0, Math.trunc(record.quantity)),
    status: record.status.trim().toLowerCase(),
  };
}

export async function runMockSync(
  orgId: string,
  connectionId: string,
  triggeredBy: TriggeredBy = "manual",
  retryOfJobId: string | null = null,
): Promise<SafeSyncJob> {
  const db = getAdminDb();
  const { ref: connectionRef, data: connection } = await getOwnedConnection(connectionId, orgId);
  if (connection.isEnabled !== true) {
    throw new HttpError(400, "Enable the marketplace connection before syncing");
  }

  const jobRef = db.collection(JOB_COLLECTION).doc();
  const lockRef = db.collection(LOCK_COLLECTION).doc(stableId([orgId, connectionId]));
  const startedAt = Date.now();

  await db.runTransaction(async (transaction) => {
    const lock = await transaction.get(lockRef);
    const lockData = lock.data();
    if (lock.exists && Number(lockData?.expiresAt ?? 0) > startedAt) {
      throw new HttpError(409, "A sync is already running for this connection");
    }
    transaction.create(jobRef, {
      orgId,
      connectionId,
      connectionName: connection.name,
      provider: connection.provider,
      status: "running",
      startedAt,
      completedAt: null,
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      duplicateCount: 0,
      errorMessage: null,
      triggeredBy,
      retryOfJobId,
    });
    transaction.set(lockRef, {
      orgId,
      connectionId,
      jobId: jobRef.id,
      expiresAt: startedAt + 5 * 60 * 1000,
    });
  });

  try {
    const records = MOCK_RECORDS.map(normalizeRecord);
    const recordRefs = records.map((record) =>
      db.collection(RECORD_COLLECTION).doc(stableId([
        orgId,
        connectionId,
        record.recordType,
        record.externalId,
      ])),
    );

    const duplicateCount = await db.runTransaction(async (transaction) => {
      const snapshots = [];
      for (const ref of recordRefs) snapshots.push(await transaction.get(ref));
      let duplicates = 0;
      for (let index = 0; index < records.length; index += 1) {
        if (snapshots[index].exists) {
          duplicates += 1;
          continue;
        }
        transaction.create(recordRefs[index], {
          orgId,
          connectionId,
          provider: connection.provider,
          ...records[index],
          importedAt: Date.now(),
        });
      }
      return duplicates;
    });

    const completedAt = Date.now();
    await jobRef.update({
      status: "completed",
      completedAt,
      processedCount: records.length,
      successCount: records.length,
      failedCount: 0,
      duplicateCount,
      errorMessage: null,
    });
    await connectionRef.update({ lastSyncAt: completedAt, updatedAt: completedAt });
  } catch (error) {
    const completedAt = Date.now();
    const message = safeErrorMessage(error);
    await jobRef.update({
      status: "failed",
      completedAt,
      processedCount: 0,
      successCount: 0,
      failedCount: MOCK_RECORDS.length,
      errorMessage: message,
    }).catch(() => undefined);
  } finally {
    await db.runTransaction(async (transaction) => {
      const lock = await transaction.get(lockRef);
      if (lock.data()?.jobId === jobRef.id) transaction.delete(lockRef);
    }).catch(() => undefined);
  }

  const job = await jobRef.get();
  return jobToResponse(jobRef.id, job.data()!);
}

export async function getLatestSyncStatus(orgId: string) {
  const snap = await getAdminDb().collection(JOB_COLLECTION).where("orgId", "==", orgId).get();
  const newest = snap.docs.sort(
    (a, b) => Number(b.data().startedAt ?? 0) - Number(a.data().startedAt ?? 0),
  )[0];
  if (!newest) {
    return {
      status: "idle" as const,
      connectionId: null,
      connectionName: null,
      startedAt: null,
      completedAt: null,
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      errorMessage: null,
    };
  }
  const job = jobToResponse(newest.id, newest.data());
  return {
    status: job.status,
    connectionId: job.connectionId,
    connectionName: job.connectionName,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    processedCount: job.processedCount,
    successCount: job.successCount,
    failedCount: job.failedCount,
    errorMessage: job.errorMessage,
  };
}

export async function listOrgJobs(orgId: string) {
  const snap = await getAdminDb().collection(JOB_COLLECTION).where("orgId", "==", orgId).get();
  return snap.docs.map((doc) => jobToResponse(doc.id, doc.data()));
}

export async function retryJob(orgId: string, jobId: string): Promise<SafeSyncJob> {
  const db = getAdminDb();
  const ref = db.collection(JOB_COLLECTION).doc(jobId);
  const snap = await ref.get();
  const original = snap.data();
  if (!snap.exists || !original || original.orgId !== orgId) {
    throw new HttpError(404, "Sync job not found");
  }
  if (!["failed", "partial"].includes(String(original.status))) {
    throw new HttpError(409, "Only failed or partial jobs can be retried");
  }
  return runMockSync(orgId, String(original.connectionId), "retry", jobId);
}

export async function ensureConnectionStillOwned(orgId: string, connectionId: string) {
  const ref = getAdminDb().collection(COLLECTION).doc(connectionId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.orgId !== orgId || snap.data()?.isActive !== true) {
    throw new HttpError(404, "Marketplace connection not found");
  }
  return ref;
}
