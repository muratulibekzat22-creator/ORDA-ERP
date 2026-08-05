"use client";

import { FormEvent, useState } from "react";
import { signOut } from "next-auth/react";

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState(""), [newPassword, setNewPassword] = useState(""), [confirmation, setConfirmation] = useState(""), [message, setMessage] = useState(""), [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage("");
    if (newPassword !== confirmation) return setMessage("Новые пароли не совпадают");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось изменить пароль");
      await signOut({ callbackUrl: "/login" });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось изменить пароль"); }
    finally { setLoading(false); }
  }
  return <main className="flex min-h-dvh items-center justify-center bg-[#0B1120] p-4"><form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-[#101827] p-6"><h1 className="text-2xl font-bold text-white">Смена временного пароля</h1><p className="text-sm text-slate-400">Перед началом работы установите личный пароль длиной не менее 12 символов.</p><input aria-label="Текущий пароль" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Текущий пароль" className="input w-full"/><input aria-label="Новый пароль" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Новый пароль" className="input w-full"/><input aria-label="Повтор нового пароля" type="password" autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="Повторите новый пароль" className="input w-full"/>{message && <p role="alert" className="rounded-xl bg-red-950/40 p-3 text-red-300">{message}</p>}<button disabled={loading} className="min-h-12 w-full rounded-xl bg-blue-600 font-semibold text-white disabled:opacity-60">{loading ? "Сохраняем…" : "Изменить пароль"}</button></form></main>;
}
