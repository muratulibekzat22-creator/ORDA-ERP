"use client";

import { KeyRound, ShieldCheck } from "lucide-react";

export default function ChatGptOfficeAccessCard({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`rounded-2xl border border-blue-700/50 bg-blue-950/20 ${compact ? "p-4" : "p-4 md:p-6"}`}>
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-blue-500/15 p-2 text-blue-200"><KeyRound size={21} /></span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Рабочий ChatGPT ALTYN SAPA</p>
          <h2 className={`${compact ? "text-base" : "text-xl"} mt-1 font-semibold text-white`}>Используйте только персональный доступ</h2>
          <p className="mt-1 text-sm text-slate-400">Общие логины и пароли отключены. Для доступа обратитесь к директору: аккаунт должен быть закреплён за конкретным сотрудником.</p>
        </div>
      </div>
      <a href="https://chatgpt.com/" target="_blank" rel="noreferrer" className="mt-4 flex min-h-12 items-center justify-center rounded-xl bg-blue-700 px-4 font-semibold text-white">Открыть персональный ChatGPT</a>
      <p className="mt-3 flex items-start gap-2 text-xs text-amber-200"><ShieldCheck className="mt-0.5 shrink-0" size={16} />Не передавайте коды входа и не загружайте телефон, точный адрес, документы или финансовые данные клиента.</p>
    </section>
  );
}
