"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { Role, roleNames } from "@/lib/roles";

type Employee = {
  id: number;
  employeeId: number;
  userId: number | null;
  name: string;
  position: string;
  email: string | null;
  phone: string | null;
  role: Role | null;
  active: boolean;
  hasOrdaAccess: boolean;
  accountActive: boolean;
  createdAt: string;
  lastLogin: string | null;
};
type Form = {
  name: string;
  position: string;
  phone: string;
  email: string;
  hasOrdaAccess: boolean;
  role: Role;
  password: string;
  active: boolean;
};
type EmployeeFilter = "active" | "inactive" | "all";

const employeeRoles = Object.values(Role).filter((role) => role !== Role.PARTNER);
const blank: Form = {
  name: "",
  position: "",
  phone: "",
  email: "",
  hasOrdaAccess: false,
  role: Role.MANAGER,
  password: "",
  active: true,
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeFilter, setEmployeeFilter] = useState<EmployeeFilter>("active");
  const [form, setForm] = useState<Form>(blank);
  const [edit, setEdit] = useState<Employee | null>(null);
  const [accessEmployee, setAccessEmployee] = useState<Employee | null>(null);
  const [accessForm, setAccessForm] = useState({ email: "", password: "", role: Role.MANAGER });
  const [passwordEmployee, setPasswordEmployee] = useState<Employee | null>(null);
  const [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async (filter: EmployeeFilter) => {
    const response = await fetch(`/api/employees?status=${filter}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось загрузить сотрудников");
    setEmployees(await response.json() as Employee[]);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(employeeFilter).catch((cause) => setError(cause instanceof Error ? cause.message : "Ошибка"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [employeeFilter]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const response = await fetch(edit ? `/api/employees/profile/${edit.employeeId}` : "/api/employees", {
      method: edit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(edit ? {
        name: form.name,
        position: form.position,
        phone: form.phone,
        email: form.email,
        active: form.active,
      } : form),
    });
    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      return setError(payload.error ?? "Не удалось сохранить сотрудника");
    }
    setNotice(edit ? "Данные сотрудника сохранены" : "Сотрудник добавлен");
    setForm(blank);
    setEdit(null);
    await load(employeeFilter);
  };

  const updateProfile = async (employee: Employee, data: Record<string, unknown>) => {
    const response = await fetch(`/api/employees/profile/${employee.employeeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) return setError(((await response.json()) as { error?: string }).error ?? "Не удалось изменить сотрудника");
    await load(employeeFilter);
  };

  const updateAccess = async (employee: Employee) => {
    if (!employee.userId) return;
    const response = await fetch(`/api/employees/${employee.userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !employee.accountActive }),
    });
    if (!response.ok) return setError(((await response.json()) as { error?: string }).error ?? "Не удалось изменить доступ");
    await load(employeeFilter);
  };

  const createAccess = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessEmployee) return;
    const response = await fetch(`/api/employees/${accessEmployee.employeeId}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accessForm),
    });
    if (!response.ok) return setError(((await response.json()) as { error?: string }).error ?? "Не удалось создать доступ");
    setAccessEmployee(null);
    setAccessForm({ email: "", password: "", role: Role.MANAGER });
    setNotice("Доступ в ORDA создан без изменения Payroll-истории");
    await load(employeeFilter);
  };

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordEmployee?.userId) return;
    if (passwordForm.newPassword !== passwordForm.confirmPassword)
      return setError("Пароли не совпадают");
    const response = await fetch(`/api/employees/${passwordEmployee.userId}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(passwordForm),
    });
    if (!response.ok) return setError(((await response.json()) as { error?: string }).error ?? "Не удалось изменить пароль");
    setPasswordEmployee(null);
    setPasswordForm({ newPassword: "", confirmPassword: "" });
    setNotice("Пароль обновлён");
  };

  const startEdit = (employee: Employee) => {
    setEdit(employee);
    setForm({
      name: employee.name,
      position: employee.position,
      phone: employee.phone ?? "",
      email: employee.email ?? "",
      hasOrdaAccess: employee.hasOrdaAccess,
      role: employee.role ?? Role.MANAGER,
      password: "",
      active: employee.active,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <section className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">Сотрудники</h1>
          <p className="mt-1 text-slate-400">Состав команды и доступ в ORDA управляются отдельно</p>
        </div>
        <Link href="/training" className="flex min-h-11 items-center rounded-xl bg-blue-700 px-4 font-semibold text-white">Обучение замерщиков</Link>
      </header>

      {error && <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300">{notice}</p>}

      <form onSubmit={submit} className="mt-5 grid min-w-0 gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-4 md:grid-cols-2 lg:grid-cols-3 [&_input]:min-w-0 [&_input]:rounded-xl [&_input]:border [&_input]:border-slate-700 [&_input]:bg-slate-900 [&_input]:p-3 [&_input]:text-white [&_select]:min-w-0 [&_select]:rounded-xl [&_select]:border [&_select]:border-slate-700 [&_select]:bg-slate-900 [&_select]:p-3 [&_select]:text-white">
        <h2 className="text-xl font-semibold text-white md:col-span-2 lg:col-span-3">{edit ? `Редактирование: ${edit.name}` : "Добавить сотрудника"}</h2>
        <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="ФИО" aria-label="ФИО" />
        <input required value={form.position} onChange={(event) => setForm({ ...form, position: event.target.value })} placeholder="Должность" aria-label="Должность" />
        <input type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Телефон — необязательно" aria-label="Телефон" />
        <input type="email" required={!edit && form.hasOrdaAccess} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email — необязательно" aria-label="Email" />
        {!edit && <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-3 text-slate-200"><input type="checkbox" checked={form.hasOrdaAccess} onChange={(event) => setForm({ ...form, hasOrdaAccess: event.target.checked })} />Доступ в ORDA</label>}
        {!edit && form.hasOrdaAccess && <>
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })} aria-label="Роль ORDA">{employeeRoles.map((role) => <option key={role} value={role}>{roleNames[role]}</option>)}</select>
          <input required minLength={12} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Пароль — минимум 12 символов" aria-label="Пароль" />
        </>}
        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-3 text-slate-200"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} />Активный сотрудник</label>
        <button className="min-h-12 rounded-xl bg-blue-600 p-3 font-semibold text-white hover:bg-blue-700">{edit ? "Сохранить изменения" : "Добавить сотрудника"}</button>
        {edit && <button type="button" onClick={() => { setEdit(null); setForm(blank); }} className="min-h-12 rounded-xl bg-slate-700 p-3 text-white">Отмена</button>}
      </form>

      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Фильтр сотрудников">
        {([["active", "Активные"], ["inactive", "Неактивные"], ["all", "Все"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setEmployeeFilter(value)} className={`min-h-11 rounded-xl px-4 font-medium ${employeeFilter === value ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}>{label}</button>)}
      </div>

      <div className="mt-5 grid min-w-0 gap-3 lg:grid-cols-2">
        {!employees.length && <p className="rounded-2xl bg-[#101827] p-8 text-center text-slate-400 lg:col-span-2">Сотрудники пока не добавлены.</p>}
        {employees.map((employee) => <article key={employee.employeeId} className="min-w-0 rounded-2xl border border-slate-700 bg-[#101827] p-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0"><h2 className="break-words font-semibold text-white">{employee.name}</h2><p className="break-words text-sm text-slate-300">{employee.position}</p><p className="mt-1 break-all text-xs text-slate-500">{employee.email || "Email не указан"}{employee.phone ? ` · ${employee.phone}` : ""}</p></div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs ${employee.active ? "bg-green-700 text-white" : "bg-slate-700 text-slate-300"}`}>{employee.active ? "Активен" : "Неактивен"}</span>
          </div>
          <div className="mt-3 rounded-xl bg-slate-900 p-3 text-sm"><p className={employee.hasOrdaAccess && employee.accountActive ? "text-emerald-300" : "text-slate-400"}>{!employee.hasOrdaAccess ? "Без доступа в ORDA" : employee.accountActive ? `Доступ активен · ${employee.role ? roleNames[employee.role] : ""}` : "Доступ в ORDA отключён"}</p>{employee.hasOrdaAccess && <p className="mt-1 text-xs text-slate-500">Последний вход: {employee.lastLogin ? new Date(employee.lastLogin).toLocaleString("ru-RU") : "ещё не входил"}</p>}</div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => startEdit(employee)} className="min-h-11 rounded-lg bg-slate-700 px-3 text-white">Изменить</button>
            <button type="button" onClick={() => void updateProfile(employee, { active: !employee.active })} className="min-h-11 rounded-lg bg-amber-800 px-3 text-white">{employee.active ? "Деактивировать" : "Активировать"}</button>
            {!employee.hasOrdaAccess ? <button type="button" onClick={() => { setAccessEmployee(employee); setAccessForm({ email: employee.email ?? "", password: "", role: Role.MANAGER }); }} className="col-span-2 min-h-11 rounded-lg bg-blue-700 px-3 text-white">Создать доступ в ORDA</button> : <>
              <button type="button" onClick={() => setPasswordEmployee(employee)} className="min-h-11 rounded-lg bg-blue-700 px-3 text-white">Изменить пароль</button>
              <button type="button" onClick={() => void updateAccess(employee)} className="min-h-11 rounded-lg border border-slate-600 px-3 text-white">{employee.accountActive ? "Отключить доступ" : "Включить доступ"}</button>
            </>}
          </div>
        </article>)}
      </div>

      {accessEmployee && <Modal title="Создать доступ в ORDA" subtitle={`${accessEmployee.name}. Payroll-история останется без изменений.`} onClose={() => setAccessEmployee(null)}>
        <form onSubmit={createAccess} className="space-y-4">
          <label className="block text-sm text-slate-300">Email<input autoFocus required type="email" className="control mt-1" value={accessForm.email} onChange={(event) => setAccessForm({ ...accessForm, email: event.target.value })} /></label>
          <label className="block text-sm text-slate-300">Роль<select className="control mt-1" value={accessForm.role} onChange={(event) => setAccessForm({ ...accessForm, role: event.target.value as Role })}>{employeeRoles.map((role) => <option key={role} value={role}>{roleNames[role]}</option>)}</select></label>
          <label className="block text-sm text-slate-300">Пароль<input required minLength={12} type="password" className="control mt-1" value={accessForm.password} onChange={(event) => setAccessForm({ ...accessForm, password: event.target.value })} /></label>
          <button className="min-h-12 w-full rounded-xl bg-blue-600 font-semibold text-white">Создать доступ</button>
        </form>
      </Modal>}

      {passwordEmployee && <Modal title="Изменить пароль" subtitle={`${passwordEmployee.name}. Старый пароль не отображается.`} onClose={() => setPasswordEmployee(null)}>
        <form onSubmit={resetPassword} className="space-y-4">
          <label className="block text-sm text-slate-300">Новый пароль<input autoFocus required minLength={10} maxLength={128} type="password" className="control mt-1" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} /></label>
          <label className="block text-sm text-slate-300">Повторить пароль<input required minLength={10} maxLength={128} type="password" className="control mt-1" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} /></label>
          <button className="min-h-12 w-full rounded-xl bg-blue-600 font-semibold text-white">Сохранить</button>
        </form>
      </Modal>}
    </section>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-end overflow-y-auto bg-black/70 sm:place-items-center sm:p-4"><div className="w-full max-w-md rounded-t-2xl border border-slate-700 bg-[#101827] p-5 sm:rounded-2xl"><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-white">{title}</h2><p className="mt-1 text-sm text-slate-400">{subtitle}</p></div><button type="button" onClick={onClose} aria-label="Закрыть" className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-800 text-white">×</button></div>{children}</div></div>;
}
