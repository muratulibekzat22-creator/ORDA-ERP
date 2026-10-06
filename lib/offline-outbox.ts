"use client";

export type OfflineMutationKind = "MEASUREMENT_NOTE" | "WORK_COMMENT" | "TASK_CREATE" | "TASK_UPDATE" | "PRODUCTION_NOTE" | "MEASUREMENT_PHOTO";
export type OfflineMutationState = "pending" | "syncing" | "synced" | "error" | "conflict";

export type OfflineMutation = {
  id: string;
  idempotencyKey: string;
  tenantId: number;
  userId: number;
  kind: OfflineMutationKind;
  payload: Record<string, unknown>;
  createdAtLocal: string;
  state: OfflineMutationState;
  attempts: number;
  serverAcknowledgement?: string;
  error?: string;
};

const DB = "orda-offline-v1";
const STORE = "outbox";
const changed = () => window.dispatchEvent(new Event("orda:outbox-changed"));

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    run(tx.objectStore(STORE), resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

export async function enqueueOfflineMutation(input: Omit<OfflineMutation, "id" | "idempotencyKey" | "createdAtLocal" | "state" | "attempts">) {
  if (!Number.isInteger(input.tenantId) || !Number.isInteger(input.userId)) throw new Error("SESSION_REQUIRED");
  const mutation: OfflineMutation = { ...input, id: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), createdAtLocal: new Date().toISOString(), state: "pending", attempts: 0 };
  await transaction<void>("readwrite", (store, resolve, reject) => { const request = store.add(mutation); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  changed();
  return mutation;
}

export async function listOfflineMutations() {
  return transaction<OfflineMutation[]>("readonly", (store, resolve, reject) => { const request = store.getAll(); request.onsuccess = () => resolve(request.result as OfflineMutation[]); request.onerror = () => reject(request.error); });
}

async function put(mutation: OfflineMutation) {
  await transaction<void>("readwrite", (store, resolve, reject) => { const request = store.put(mutation); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
}

async function remove(id: string) {
  await transaction<void>("readwrite", (store, resolve, reject) => { const request = store.delete(id); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
}

export async function pendingOfflineCount() {
  return (await listOfflineMutations()).filter((item) => item.state !== "synced").length;
}

export async function syncOfflineOutbox() {
  if (!navigator.onLine) return { synced: 0, pending: await pendingOfflineCount() };
  const mutations = (await listOfflineMutations()).filter((item) => item.state === "pending" || item.state === "error");
  let synced = 0;
  for (const mutation of mutations) {
    const current: OfflineMutation = { ...mutation, state: "syncing", attempts: mutation.attempts + 1 };
    await put(current); changed();
    try {
      const response = await fetch("/api/offline/sync", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": mutation.idempotencyKey }, body: JSON.stringify({ tenantId: mutation.tenantId, userId: mutation.userId, kind: mutation.kind, payload: mutation.payload, createdAtLocal: mutation.createdAtLocal }) });
      const body = await response.json().catch(() => ({})) as { acknowledgement?: string; error?: string };
      if (response.ok) { current.state = "synced"; current.serverAcknowledgement = body.acknowledgement; await put(current); await remove(current.id); synced += 1; }
      else { current.state = response.status === 409 ? "conflict" : "error"; current.error = body.error ?? "SYNC_FAILED"; await put(current); }
    } catch { current.state = "error"; current.error = "NETWORK_ERROR"; await put(current); }
    changed();
  }
  return { synced, pending: await pendingOfflineCount() };
}

export async function clearOfflineOutbox() {
  await transaction<void>("readwrite", (store, resolve, reject) => { const request = store.clear(); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
  changed();
}

export async function prepareOfflineLogout() {
  const pending = await pendingOfflineCount();
  if (pending > 0 && !window.confirm(`Есть несинхронизированные записи: ${pending}. Выход удалит их с этого устройства. Продолжить?`)) return false;
  await clearOfflineOutbox();
  const registration = await navigator.serviceWorker?.ready.catch(() => undefined);
  registration?.active?.postMessage({ type: "CLEAR_PRIVATE_DATA" });
  return true;
}
