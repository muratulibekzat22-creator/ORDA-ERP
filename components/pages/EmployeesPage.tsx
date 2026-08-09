"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Role, roleNames } from "@/lib/roles";
type Partner = { id: number; name: string; active: boolean };
type User = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
  createdAt: string;
  lastLogin: string | null;
  partnerProfile: Partner | null;
};
type Form = {
  name: string;
  email: string;
  password: string;
  phone: string;
  role: Role;
  partnerId: string;
  active: boolean;
};
type EmployeeFilter = "active" | "inactive" | "all";
const blank: Form = {
  name: "",
  email: "",
  password: "",
  phone: "",
  role: Role.MANAGER,
  partnerId: "",
  active: true,
};
export default function EmployeesPage() {
  const [users, setUsers] = useState<User[]>([]),
    [partners, setPartners] = useState<Partner[]>([]),
    [employeeFilter, setEmployeeFilter] = useState<EmployeeFilter>("active"),
    [form, setForm] = useState(blank),
    [edit, setEdit] = useState<User | null>(null),
    [passwordUser, setPasswordUser] = useState<User | null>(null),
    [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" }),
    [error, setError] = useState("");
  const load = async (filter: EmployeeFilter) => {
    const [u, p] = await Promise.all([
      fetch(`/api/employees?status=${filter}`, { cache: "no-store" }),
      fetch("/api/partners"),
    ]);
    if (!u.ok || !p.ok) throw new Error("Не удалось загрузить данные");
    const [nextUsers, nextPartners] = await Promise.all([
      u.json() as Promise<User[]>,
      p.json() as Promise<Partner[]>,
    ]);
    setUsers(nextUsers);
    setPartners(nextPartners.filter((x) => x.active));
  };
  useEffect(() => {
    const id = window.setTimeout(
      () =>
        void load(employeeFilter).catch((e) =>
          setError(e instanceof Error ? e.message : "Ошибка"),
        ),
      0,
    );
    return () => window.clearTimeout(id);
  }, [employeeFilter]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.role === Role.PARTNER && !form.partnerId)
      return setError("Выберите цех");
    const r = await fetch(
      edit ? `/api/employees/${edit.id}` : "/api/employees",
      {
        method: edit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edit ? {
          name: form.name,
          phone: form.phone,
          role: form.role,
          active: form.active,
          partnerId: form.partnerId ? Number(form.partnerId) : undefined,
        } : {
          ...form,
          partnerId: form.partnerId ? Number(form.partnerId) : undefined,
        }),
      },
    );
    if (!r.ok)
      return setError(
        ((await r.json()) as { error?: string }).error ?? "Ошибка сохранения",
      );
    setForm(blank);
    setEdit(null);
    await load(employeeFilter);
  };
  const patch = async (user: User, data: Record<string, unknown>) => {
    const r = await fetch(`/api/employees/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!r.ok)
      return setError(
        ((await r.json()) as { error?: string }).error ?? "Ошибка",
      );
    await load(employeeFilter);
  };
  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordUser) return;
    if (passwordForm.newPassword !== passwordForm.confirmPassword) return setError("Пароли не совпадают");
    const response = await fetch(`/api/employees/${passwordUser.id}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(passwordForm),
    });
    if (!response.ok) return setError(((await response.json()) as { error?: string }).error ?? "Не удалось изменить пароль");
    setPasswordUser(null);
    setPasswordForm({ newPassword: "", confirmPassword: "" });
  };
  return (
    <section className="flex-1 overflow-auto p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-white">Сотрудники</h1>
        <Link href="/training" className="flex min-h-11 items-center rounded-xl bg-blue-700 px-4 font-semibold text-white">Обучение замерщиков</Link>
      </div>
      <p className="mt-2 text-slate-400">
        Доступы, роли и контактные данные команды ALTYN SAPA
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          {error}
        </p>
      )}
      <form
        onSubmit={submit}
        className="mt-5 grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-5 md:grid-cols-3 [&_input]:rounded-xl [&_input]:border [&_input]:border-slate-700 [&_input]:bg-slate-900 [&_input]:p-3 [&_input]:text-white [&_select]:rounded-xl [&_select]:border [&_select]:border-slate-700 [&_select]:bg-slate-900 [&_select]:p-3 [&_select]:text-white"
      >
        <h2 className="text-xl font-semibold text-white md:col-span-3">
          {edit ? `Редактирование: ${edit.name}` : "Добавить сотрудника"}
        </h2>
        <input
          aria-label="Имя сотрудника"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Имя"
        />
        <input
          aria-label="Email сотрудника"
          required={!edit}
          type="email"
          value={form.email}
          disabled={!!edit}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="Email"
        />
        {!edit && <input
          aria-label={edit ? "Новый пароль (необязательно)" : "Пароль"}
          required={!edit}
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="Пароль"
        />}
        <input
          aria-label="Телефон сотрудника"
          type="tel"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="Телефон"
        />
        <select
          aria-label="Роль сотрудника"
          value={form.role}
          onChange={(e) =>
            setForm({
              ...form,
              role: e.target.value as Role,
              partnerId: e.target.value === Role.PARTNER ? form.partnerId : "",
            })
          }
        >
          {Object.entries(roleNames).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
        {form.role === Role.PARTNER && (
          <select
            aria-label="Цех сотрудника"
            required
            value={form.partnerId}
            onChange={(e) => setForm({ ...form, partnerId: e.target.value })}
          >
            <option value="">Выберите цех</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-3 text-slate-200"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Активный сотрудник</label>
        <button className="rounded-xl bg-blue-600 p-3 font-semibold text-white hover:bg-blue-700">
          {edit ? "Сохранить изменения" : "Добавить сотрудника"}
        </button>
        {edit && (
          <button
            className="rounded-xl bg-slate-700 p-3 text-white"
            type="button"
            onClick={() => {
              setEdit(null);
              setForm(blank);
            }}
          >
            Отмена
          </button>
        )}
      </form>
      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Фильтр сотрудников">
        {([
          ["active", "Активные"],
          ["inactive", "Неактивные"],
          ["all", "Все"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setEmployeeFilter(value)}
            className={`min-h-11 rounded-xl px-4 font-medium ${employeeFilter === value ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            aria-pressed={employeeFilter === value}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-5 space-y-3 md:hidden">{!users.length ? <p className="rounded-2xl bg-[#101827] p-8 text-center text-slate-400">Сотрудники пока не добавлены.</p> : users.map((user) => <article key={user.id} className="rounded-2xl border border-slate-700 bg-[#101827] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-semibold text-white">{user.name}</h2><p className="truncate text-sm text-slate-400">{user.email}</p><p className="text-sm text-slate-400">{user.phone ?? "Телефон не указан"}</p></div><span className={`rounded-full px-3 py-1 text-xs ${user.active ? "bg-green-700 text-white" : "bg-slate-700 text-slate-300"}`}>{user.active ? "Активен" : "Неактивен"}</span></div><p className="mt-3 text-sm text-slate-300">{roleNames[user.role]}{user.partnerProfile ? ` · ${user.partnerProfile.name}` : ""}</p><p className="mt-2 text-xs text-slate-500">Последний вход: {user.lastLogin ? new Date(user.lastLogin).toLocaleString("ru-RU") : "ещё не входил"}</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" className="min-h-11 rounded-lg bg-slate-700 px-3 text-white" onClick={() => { setEdit(user); setForm({ name: user.name, email: user.email, password: "", phone: user.phone ?? "", role: user.role, partnerId: user.partnerProfile ? String(user.partnerProfile.id) : "", active: user.active }); }}>Изменить</button><button type="button" className="min-h-11 rounded-lg bg-blue-700 px-3 text-white" onClick={() => setPasswordUser(user)}>Изменить пароль</button><button type="button" className="col-span-2 min-h-11 rounded-lg bg-amber-700 px-3 text-white" onClick={() => void patch(user, { active: !user.active })}>{user.active ? "Отключить" : "Включить"}</button></div></article>)}</div>
      <div className="mt-5 hidden overflow-auto rounded-2xl bg-[#101827] md:block">
        <table className="w-full min-w-[1050px] text-left text-slate-300 [&_td]:border-t [&_td]:border-slate-800 [&_td]:p-4">
          <thead>
            <tr className="text-slate-400">
              <th className="p-4">Сотрудник</th>
              <th>Роль</th>
              <th>Цех</th>
              <th>Статус</th>
              <th>Создан</th>
              <th>Последний вход</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {!users.length && (
              <tr>
                <td colSpan={7} className="p-10 text-center text-slate-400">
                  Сотрудники пока не добавлены.
                </td>
              </tr>
            )}
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{roleNames[user.role]}</td>
                <td>{user.partnerProfile?.name ?? "—"}</td>
                <td>{user.active ? "Активен" : "Неактивен"}</td>
                <td>{new Date(user.createdAt).toLocaleDateString("ru-RU")}</td>
                <td>{user.lastLogin ? new Date(user.lastLogin).toLocaleString("ru-RU") : "Ещё не входил"}</td>
                <td className="space-x-2">
                  <button
                    className="rounded-lg bg-slate-700 px-3 py-2 text-white"
                    onClick={() => {
                      setEdit(user);
                      setForm({
                        name: user.name,
                        email: user.email,
                        password: "",
                        phone: user.phone ?? "",
                        role: user.role,
                        partnerId: user.partnerProfile
                          ? String(user.partnerProfile.id)
                          : "",
                        active: user.active,
                      });
                    }}
                  >
                    Изменить
                  </button>
                  <button
                    className="rounded-lg bg-amber-700 px-3 py-2 text-white"
                    onClick={() => void patch(user, { active: !user.active })}
                  >
                    {user.active ? "Отключить" : "Включить"}
                  </button>
                  <button type="button" className="rounded-lg bg-blue-700 px-3 py-2 text-white" onClick={() => setPasswordUser(user)}>
                    Изменить пароль
                  </button>
                  <button
                    className="rounded-lg bg-red-800 px-3 py-2 text-white"
                    onClick={async () => {
                      if (confirm(`Удалить ${user.name}?`)) {
                        const r = await fetch(`/api/employees/${user.id}`, {
                          method: "DELETE",
                        });
                        if (!r.ok)
                          setError(
                            ((await r.json()) as { error?: string }).error ??
                              "Ошибка",
                          );
                        else await load(employeeFilter);
                      }
                    }}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {passwordUser && <div role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" className="fixed inset-0 z-50 grid place-items-end bg-black/70 sm:place-items-center sm:p-4">
        <form onSubmit={resetPassword} className="w-full max-w-md space-y-4 rounded-t-2xl border border-slate-700 bg-[#101827] p-5 sm:rounded-2xl">
          <div><h2 id="password-dialog-title" className="text-xl font-semibold text-white">Изменить пароль</h2><p className="mt-1 text-sm text-slate-400">{passwordUser.name}. Старый пароль не отображается.</p></div>
          <label className="block text-sm text-slate-300">Новый пароль<input autoFocus required minLength={10} maxLength={128} type="password" className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({...passwordForm,newPassword:event.target.value})}/></label>
          <label className="block text-sm text-slate-300">Повторить пароль<input required minLength={10} maxLength={128} type="password" className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({...passwordForm,confirmPassword:event.target.value})}/></label>
          <div className="grid grid-cols-2 gap-2"><button type="button" className="min-h-12 rounded-xl bg-slate-700 text-white" onClick={() => { setPasswordUser(null); setPasswordForm({newPassword:"",confirmPassword:""}); }}>Отмена</button><button className="min-h-12 rounded-xl bg-blue-600 font-semibold text-white">Сохранить</button></div>
        </form>
      </div>}
    </section>
  );
}
