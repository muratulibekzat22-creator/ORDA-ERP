"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

type Enrollment = { secret: string; provisioningUri: string; qrDataUrl: string };

export default function MfaSetupPage() {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function begin() {
    setBusy(true); setError("");
    const response = await fetch("/api/auth/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "begin" }) });
    const body = await response.json().catch(() => ({})) as Enrollment & { error?: string };
    if (!response.ok) setError(body.error ?? "Не удалось начать настройку"); else setEnrollment(body);
    setBusy(false);
  }

  async function confirm() {
    if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) { setError("Введите шестизначный код"); return; }
    setBusy(true); setError("");
    const response = await fetch("/api/auth/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm", code }) });
    const body = await response.json().catch(() => ({})) as { recoveryCodes?: string[]; error?: string };
    if (!response.ok) setError(body.error ?? "Не удалось подтвердить код"); else setRecoveryCodes(body.recoveryCodes ?? []);
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 sm:p-8">
      <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h1 className="text-2xl font-bold">Двухфакторная защита</h1>
        <p className="mt-2 text-slate-300">Подключите любой TOTP-аутентификатор. Действующий доступ не отключается, пока вы не подтвердите первый код и не получите recovery-коды.</p>
        {!enrollment && !recoveryCodes.length && <button type="button" disabled={busy} onClick={() => void begin()} className="mt-5 rounded-xl bg-blue-600 px-4 py-3 font-semibold disabled:opacity-50">Создать защищённый ключ</button>}
        {enrollment && !recoveryCodes.length && (
          <div className="mt-5 space-y-4">
            {/* The QR is generated locally by the authenticated ORDA endpoint and is never loaded from a third party. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrollment.qrDataUrl} alt="QR-код MFA" width={240} height={240} className="rounded-xl bg-white p-2" />
            <p className="break-all rounded-lg bg-slate-950 p-3 font-mono text-sm">{enrollment.secret}</p>
            <label className="block">Код из приложения<input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3" /></label>
            <button type="button" disabled={busy} onClick={() => void confirm()} className="rounded-xl bg-emerald-600 px-4 py-3 font-semibold disabled:opacity-50">Подтвердить и включить MFA</button>
          </div>
        )}
        {recoveryCodes.length > 0 && (
          <div className="mt-5 space-y-4">
            <p className="font-semibold text-amber-300">Сохраните recovery-коды сейчас. На сервере остаются только их хеши.</p>
            <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-sm">{recoveryCodes.join("\n")}</pre>
            <button type="button" onClick={() => void signOut({ callbackUrl: "/login" })} className="rounded-xl bg-blue-600 px-4 py-3 font-semibold">Я сохранил коды — войти заново</button>
          </div>
        )}
        {error && <p role="alert" className="mt-4 text-red-300">{error}</p>}
      </div>
    </main>
  );
}
