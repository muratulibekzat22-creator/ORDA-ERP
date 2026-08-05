"use client";
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
  partnerProfile: Partner | null;
};
type Form = {
  name: string;
  email: string;
  password: string;
  phone: string;
  role: Role;
  partnerId: string;
};
const blank: Form = {
  name: "",
  email: "",
  password: "",
  phone: "",
  role: Role.MANAGER,
  partnerId: "",
};
export default function EmployeesPage() {
  const [users, setUsers] = useState<User[]>([]),
    [partners, setPartners] = useState<Partner[]>([]),
    [form, setForm] = useState(blank),
    [edit, setEdit] = useState<User | null>(null),
    [error, setError] = useState("");
  const load = async () => {
    const [u, p] = await Promise.all([
      fetch("/api/employees"),
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
        void load().catch((e) =>
          setError(e instanceof Error ? e.message : "Ошибка"),
        ),
      0,
    );
    return () => window.clearTimeout(id);
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.role === Role.PARTNER && !form.partnerId)
      return setError("Выберите цех");
    const r = await fetch(
      edit ? `/api/employees/${edit.id}` : "/api/employees",
      {
        method: edit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
    await load();
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
    await load();
  };
  return (
    <section className="flex-1 overflow-auto p-8">
      <h1 className="text-3xl font-bold text-white">Сотрудники</h1>
      <p className="mt-2 text-slate-400">
        Доступы, роли и контактные данные команды ALTYN SAPA
      </p>
      {error && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
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
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Имя"
        />
        <input
          required={!edit}
          type="email"
          value={form.email}
          disabled={!!edit}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="Email"
        />
        <input
          required={!edit}
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="Пароль"
        />
        <input
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="Телефон"
        />
        <select
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
      <div className="mt-5 overflow-auto rounded-2xl bg-[#101827]">
        <table className="w-full min-w-[760px] text-left text-slate-300 [&_td]:border-t [&_td]:border-slate-800 [&_td]:p-4">
          <thead>
            <tr className="text-slate-400">
              <th className="p-4">Сотрудник</th>
              <th>Роль</th>
              <th>Цех</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {!users.length && (
              <tr>
                <td colSpan={5} className="p-10 text-center text-slate-400">
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
                        else await load();
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
    </section>
  );
}
