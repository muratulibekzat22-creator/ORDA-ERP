"use client";

import { getSession, signIn } from "next-auth/react";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  async function login(event: FormEvent) {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const callback = new URLSearchParams(window.location.search).get("callbackUrl"), callbackUrl = callback?.startsWith("/") && !callback.startsWith("//") ? callback : "/";
      const result = await signIn("credentials", { email: email.trim().toLowerCase(), password, redirect: false, callbackUrl });
      if (!result || result.error) setError("Неверный email, пароль или пользователь отключён.");
      else {
        const session = await getSession();
        window.location.assign(session?.user.role === "PARTNER" ? "/partner" : callbackUrl);
      }
    } catch { setError("Не удалось выполнить вход. Проверьте подключение и попробуйте ещё раз."); }
    finally { setLoading(false); }
  }
  return <main className="flex min-h-dvh items-center justify-center bg-[#0B1120] p-4"><form onSubmit={login} className="w-full max-w-md space-y-5 rounded-2xl border border-slate-700 bg-[#101827] p-6 shadow-2xl sm:p-8"><div className="text-center"><h1 className="text-4xl font-bold text-yellow-400">ORDA ERP</h1><p className="mt-2 text-slate-400">Вход для сотрудников ALTYN SAPA</p></div><label className="block text-sm text-slate-300">Email<input required name="email" type="email" inputMode="email" autoComplete="username email" autoCapitalize="none" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@altynsapa.kz" className="mt-1 min-h-12 w-full rounded-xl bg-slate-900 p-3 text-base text-white" /></label><label className="block text-sm text-slate-300">Пароль<input required name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Введите пароль" className="mt-1 min-h-12 w-full rounded-xl bg-slate-900 p-3 text-base text-white" /></label>{error && <p role="alert" aria-live="polite" className="rounded-xl bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}<button disabled={loading} className="min-h-12 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white disabled:cursor-wait disabled:opacity-60">{loading ? "Вход…" : "Войти"}</button></form></main>;
}
