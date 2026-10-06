"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { pendingOfflineCount, syncOfflineOutbox } from "@/lib/offline-outbox";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export default function NetworkStatus() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const refresh = () => void pendingOfflineCount().then(setPending).catch(() => setPending(0));
    refresh();
    window.addEventListener("orda:outbox-changed", refresh);
    return () => window.removeEventListener("orda:outbox-changed", refresh);
  }, []);

  useEffect(() => {
    if (!online) return;
    void syncOfflineOutbox().then((result) => setPending(result.pending));
  }, [online]);

  async function retry() {
    setSyncing(true);
    try { const result = await syncOfflineOutbox(); setPending(result.pending); } finally { setSyncing(false); }
  }

  if (online && pending === 0) return null;

  return (
    <div role="status" aria-live="polite" className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[100] mx-auto flex min-h-12 max-w-md items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-950 px-4 py-3 text-sm font-medium text-amber-100 shadow-2xl">
      {!online && <WifiOff aria-hidden="true" className="size-5 shrink-0" />}
      <span>{online ? `Ожидают синхронизации: ${pending}` : `Нет интернета${pending ? `. Не синхронизировано: ${pending}` : ""}.`}</span>
      {pending > 0 && <button type="button" disabled={!online || syncing} onClick={() => void retry()} className="ml-auto flex min-h-9 items-center gap-1 rounded-lg bg-amber-300 px-3 font-semibold text-slate-950 disabled:opacity-50"><RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"}/>Повторить</button>}
    </div>
  );
}
