"use client";

import { ExternalLink, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { getSession, signIn } from "next-auth/react";
import { FormEvent, useEffect, useState } from "react";

const INVALID_CREDENTIALS = "Не удалось войти. Проверьте данные или обратитесь к администратору.";
const LOCKED = "Слишком много попыток входа. Подождите и попробуйте снова.";
const SESSION_ENDED = "Сессия завершена. Войдите снова.";
const CONNECTION_ERROR = "Не удалось связаться с сервером. Проверьте интернет и повторите.";
const LIVE_URL = process.env.NEXT_PUBLIC_LIVE_APP_URL || "https://orda-erp-staging.vercel.app";
const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_APP_URL || "https://orda-erp-unified-preview.vercel.app";

function authMessage(code?: string | null) {
  const value = decodeURIComponent(code ?? "").toUpperCase();
  if (value.includes("TEMPORARILY_LOCKED") || value.includes("RATE_LIMITED")) return LOCKED;
  if (value.includes("SESSION_INVALID")) return SESSION_ENDED;
  return INVALID_CREDENTIALS;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isDemoHost, setIsDemoHost] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setIsDemoHost(window.location.hostname.includes("unified-preview")),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setSlow(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (!reason) return;
    const timer = window.setTimeout(() => setError(authMessage(reason)), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const normalizedEmail = email.trim().toLowerCase();
    setEmail(normalizedEmail);
    setError("");
    setSlow(false);
    setLoading(true);

    try {
      const callback = new URLSearchParams(window.location.search).get("callbackUrl");
      const callbackUrl = callback?.startsWith("/") && !callback.startsWith("//") ? callback : "/";
      const result = await signIn("credentials", {
        email: normalizedEmail,
        password,
        redirect: false,
        callbackUrl,
      });

      if (!result || result.error) {
        setError(authMessage(result?.error));
        return;
      }

      const session = await getSession();
      window.location.assign(session?.user.role === "PARTNER" ? "/partner" : callbackUrl);
    } catch {
      setError(CONNECTION_ERROR);
    } finally {
      setLoading(false);
      setSlow(false);
    }
  }

  return (
    <main className="flex min-h-dvh w-full items-center justify-center overflow-x-hidden bg-[#0B1120] px-4 py-[max(1rem,env(safe-area-inset-top))] sm:px-6">
      <form
        onSubmit={login}
        aria-busy={loading}
        className="w-full max-w-md space-y-5 rounded-2xl border border-slate-700 bg-[#101827] p-5 shadow-2xl sm:p-8"
      >
        <div className="text-center">
          <h1 className="text-3xl font-bold text-yellow-400 sm:text-4xl">ORDA ERP</h1>
          <p className="mt-2 text-sm text-slate-400 sm:text-base">
            {isDemoHost ? "Вход в демо-кабинет" : "Вход в рабочую компанию"}
          </p>
        </div>

        <label className="block text-sm font-medium text-slate-300">
          Email
          <span className="relative mt-2 block">
            <Mail aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-500" />
            <input
              required
              name="email"
              type="email"
              inputMode="email"
              enterKeyHint="next"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={loading}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => setEmail((value) => value.trim().toLowerCase())}
              placeholder="name@altynsapa.kz"
              className="min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 py-3 pl-11 pr-3 text-base text-white placeholder:text-slate-600 disabled:opacity-60"
            />
          </span>
        </label>

        <label className="block text-sm font-medium text-slate-300">
          Пароль
          <span className="relative mt-2 block">
            <LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-500" />
            <input
              required
              name="password"
              type={showPassword ? "text" : "password"}
              enterKeyHint="go"
              autoComplete="current-password"
              disabled={loading}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Введите пароль"
              className="min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 py-3 pl-11 pr-14 text-base text-white placeholder:text-slate-600 disabled:opacity-60"
            />
            <button
              type="button"
              disabled={loading}
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </span>
        </label>

        {error && (
          <div role="alert" aria-live="assertive" className="rounded-xl border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">
            <p>{error}</p>
            <button type="submit" disabled={loading} className="mt-2 min-h-11 font-semibold text-white underline decoration-red-400 underline-offset-4">
              Повторить
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !email.trim() || !password}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading && <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />}
          {loading ? "Входим…" : "Войти"}
        </button>

        {slow && (
          <p role="status" aria-live="polite" className="text-center text-sm text-amber-200">
            Ответ занимает больше времени. Не закрывайте страницу.
          </p>
        )}

        <a
          href={isDemoHost ? LIVE_URL : DEMO_URL}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
        >
          {isDemoHost ? "Открыть рабочую компанию" : "Открыть демо-кабинет"}
          <ExternalLink aria-hidden="true" size={16} />
        </a>
      </form>
    </main>
  );
}
