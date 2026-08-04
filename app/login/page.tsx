"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    await signIn("credentials", {
      email,
      password,
      callbackUrl: "/",
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B1120]">

      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#101827] p-8">

        <div className="mb-8 text-center">

          <h1 className="text-4xl font-bold text-yellow-400">
            ORDA ERP
          </h1>

          <p className="mt-2 text-slate-400">
            ALTYN SAPA COMPANY
          </p>

        </div>

        <form
          onSubmit={handleLogin}
          className="space-y-5"
        >

          <div>

            <label className="mb-2 block text-slate-300">
              Email
            </label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl bg-slate-900 p-3 text-white outline-none"
              placeholder="admin@orda.kz"
            />

          </div>

          <div>

            <label className="mb-2 block text-slate-300">
              Пароль
            </label>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl bg-slate-900 p-3 text-white outline-none"
              placeholder="******"
            />

          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white hover:bg-blue-700"
          >
            Войти
          </button>

        </form>

      </div>

    </main>
  );
}