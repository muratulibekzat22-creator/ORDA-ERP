"use client";

import { CheckCircle2, ClipboardCopy, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";

type Access = { email: string; password: string; requestMessage: string };

export default function ChatGptOfficeAccessCard({ compact = false }: { compact?: boolean }) {
  const [ownerNotified, setOwnerNotified] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function copy(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(success);
      setError("");
    } catch {
      setError("Не удалось скопировать. Разрешите браузеру доступ к буферу обмена.");
    }
  }

  async function revealAccess() {
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch("/api/training/chatgpt-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerNotified }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось получить рабочий доступ");
    else {
      setAccess(body as Access);
      setMessage("Доступ выдан. Выполните вход и дождитесь подтверждения владельца аккаунта.");
    }
    setBusy(false);
  }

  const requestMessage = access?.requestMessage ?? "Здравствуйте! Я сейчас выполняю вход в рабочий ChatGPT для замера ALTYN SAPA. Пожалуйста, подтвердите вход и отправьте код, если он появится.";
  return (
    <section className={`rounded-2xl border border-blue-700/50 bg-blue-950/20 ${compact ? "p-4" : "p-4 md:p-6"}`}>
      <div className="flex items-start gap-3"><span className="rounded-xl bg-blue-500/15 p-2 text-blue-200"><KeyRound size={21} /></span><div><p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Рабочий ChatGPT ALTYN SAPA</p><h2 className={`${compact ? "text-base" : "text-xl"} mt-1 font-semibold text-white`}>Проверьте вход до выезда к клиенту</h2><p className="mt-1 text-sm text-slate-400">Пароль выдаётся только активному замерщику и не сохраняется на этой странице. Каждый просмотр доступа фиксируется.</p></div></div>
      <ol className="mt-4 space-y-2 text-sm text-slate-300"><li><b className="text-white">1.</b> Скопируйте сообщение и заранее отправьте владельцу аккаунта.</li><li><b className="text-white">2.</b> Получите доступ, откройте ChatGPT и введите данные.</li><li><b className="text-white">3.</b> Если появится код или подтверждение входа — дождитесь ответа владельца. Не начинайте это перед клиентом.</li></ol>
      <button type="button" onClick={() => void copy(requestMessage, "Сообщение владельцу скопировано")} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-blue-600 px-4 text-sm font-semibold text-blue-100"><ClipboardCopy size={17} />Скопировать сообщение владельцу</button>
      <label className="mt-3 flex min-h-12 items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-sm text-slate-200"><input type="checkbox" checked={ownerNotified} onChange={(event) => setOwnerNotified(event.target.checked)} className="mt-0.5 size-5 shrink-0" /><span>Я заранее предупредил владельца рабочего аккаунта о входе и готов дождаться подтверждения.</span></label>
      {!access ? <button type="button" disabled={!ownerNotified || busy} onClick={() => void revealAccess()} className="mt-3 min-h-12 w-full rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:opacity-40">{busy ? "Получаем доступ…" : "Получить рабочий логин и пароль"}</button> : <div className="mt-4 space-y-3 rounded-xl border border-emerald-700/50 bg-emerald-950/20 p-4">
        <p className="flex items-center gap-2 font-semibold text-emerald-200"><CheckCircle2 size={18} />Рабочий доступ получен</p>
        <Credential label="Логин" value={access.email} shown onCopy={() => void copy(access.email, "Логин скопирован")} />
        <Credential label="Пароль" value={access.password} shown={showPassword} onToggle={() => setShowPassword((value) => !value)} onCopy={() => void copy(access.password, "Пароль скопирован")} />
        <a href="https://chatgpt.com/" target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center rounded-xl bg-emerald-700 px-4 font-semibold text-white">Открыть ChatGPT</a>
      </div>}
      <p className="mt-3 flex items-start gap-2 text-xs text-amber-200"><ShieldCheck className="mt-0.5 shrink-0" size={16} />Не фотографируйте пароль, не пересылайте его посторонним и не сохраняйте в личном браузере. В ChatGPT не загружайте телефон, точный адрес или документы клиента.</p>
      {message && <p role="status" className="mt-3 text-sm text-emerald-300">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  );
}

function Credential({ label, value, shown, onCopy, onToggle }: { label: string; value: string; shown: boolean; onCopy: () => void; onToggle?: () => void }) {
  return <div className="rounded-xl bg-slate-950 p-3"><p className="text-xs text-slate-500">{label}</p><div className="mt-1 flex min-w-0 items-center gap-2"><code className="min-w-0 flex-1 break-all text-sm text-white">{shown ? value : "••••••••••••"}</code>{onToggle && <button type="button" onClick={onToggle} aria-label={shown ? "Скрыть пароль" : "Показать пароль"} className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-800 text-slate-200">{shown ? <EyeOff size={17} /> : <Eye size={17} />}</button>}<button type="button" onClick={onCopy} aria-label={`Скопировать ${label.toLocaleLowerCase("ru")}`} className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-800 text-blue-200"><ClipboardCopy size={17} /></button></div></div>;
}
