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
      {error && <p className="mt-4 text-red-400">{error}</p>}
      <form
        onSubmit={submit}
        className="mt-5 grid gap-3 rounded-2xl bg-[#101827] p-5 md:grid-cols-3"
      >
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
        <button>{edit ? "Сохранить" : "Создать"}</button>
        {edit && (
          <button
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
        <table className="w-full text-left text-slate-300">
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{roleNames[user.role]}</td>
                <td>{user.partnerProfile?.name ?? "—"}</td>
                <td>{user.active ? "Активен" : "Неактивен"}</td>
                <td>
                  <button
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
                    onClick={() => void patch(user, { active: !user.active })}
                  >
                    {user.active ? "Отключить" : "Включить"}
                  </button>
                  <button
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
