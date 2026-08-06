"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

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

  if (online) return null;

  return (
    <div role="status" aria-live="polite" className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[100] mx-auto flex min-h-12 max-w-md items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-950 px-4 py-3 text-sm font-medium text-amber-100 shadow-2xl">
      <WifiOff aria-hidden="true" className="size-5 shrink-0" />
      Нет интернета. Проверьте подключение и повторите действие.
    </div>
  );
}
