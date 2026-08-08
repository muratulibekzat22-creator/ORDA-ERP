"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import EmployeesPage from "@/components/pages/EmployeesPage";
import { permissionKeys, type Permission } from "@/lib/permissions";
import { Role, roleNames } from "@/lib/roles";

type Material = {
  id: number;
  name: string;
  category: string;
  unit: string;
  purchasePrice: string;
  active: boolean;
  _count: { movements: number };
};
type SettingsData = {
  company: Record<string, string>;
  system: Record<string, string | number>;
  calculator: Record<string, number>;
  materials: Material[];
  rolePermissions: Record<Role, Permission[]>;
};
type Tab = "company" | "materials" | "users" | "permissions" | "system";
const tabs: Array<[Tab, string]> = [
  ["company", "Компания"],
  ["materials", "Материалы и цены"],
  ["users", "Пользователи"],
  ["permissions", "Роли и права"],
  ["system", "Системные параметры"],
];
const emptyMaterial = {
  name: "",
  category: "",
  unit: "шт",
  purchasePrice: "0",
  active: true,
};

function Input({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      <input
        disabled={disabled}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white disabled:opacity-60"
      />
    </label>
  );
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [tab, setTab] = useState<Tab>("company");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [materialForm, setMaterialForm] = useState(emptyMaterial);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings");
      const payload = (await response.json()) as SettingsData & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось загрузить настройки");
      setData(payload);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось загрузить настройки",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function request(url: string, init: RequestInit, ok = "Сохранено") {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(url, init);
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось сохранить изменения");
      setSuccess(ok);
      await load();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось сохранить изменения",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  function updateSection(
    section: "company" | "system" | "calculator",
    key: string,
    value: string,
  ) {
    setData((current) =>
      current
        ? {
            ...current,
            [section]: {
              ...current[section],
              [key]:
                section === "company"
                  ? value
                  : Number.isFinite(Number(value)) && value !== ""
                    ? Number(value)
                    : value,
            },
          }
        : current,
    );
  }

  async function saveSection(section: "company" | "system" | "calculator") {
    if (!data) return;
    await request("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [section]: data[section] }),
    });
  }

  async function savePermissions() {
    if (!data) return;
    await request(
      "/api/settings",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rolePermissions: data.rolePermissions }),
      },
      "Права ролей сохранены",
    );
  }

  function togglePermission(role: Role, permission: Permission) {
    setData((current) => {
      if (!current) return current;
      const currentPermissions = current.rolePermissions[role];
      const next = currentPermissions.includes(permission)
        ? currentPermissions.filter((item) => item !== permission)
        : [...currentPermissions, permission];
      return {
        ...current,
        rolePermissions: { ...current.rolePermissions, [role]: next },
      };
    });
  }

  async function saveMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = editingMaterial
      ? `/api/settings/materials/${editingMaterial.id}`
      : "/api/settings/materials";
    const ok = await request(
      target,
      {
        method: editingMaterial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(materialForm),
      },
      editingMaterial ? "Материал обновлён" : "Материал создан",
    );
    if (ok) {
      setMaterialForm(emptyMaterial);
      setEditingMaterial(null);
    }
  }

  async function patchMaterial(
    material: Material,
    patch: Record<string, unknown>,
  ) {
    await request(
      `/api/settings/materials/${material.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
      "Материал обновлён",
    );
  }

  async function deleteMaterial(material: Material) {
    if (!window.confirm(`Удалить материал «${material.name}»?`)) return;
    await request(
      `/api/settings/materials/${material.id}`,
      { method: "DELETE" },
      "Материал удалён",
    );
  }

  if (loading && !data)
    return <section className="p-8 text-slate-300">Загрузка настроек…</section>;
  if (!data)
    return (
      <section className="p-8 text-red-300">
        {error || "Настройки недоступны"}
      </section>
    );

  return (
    <section className="flex-1 overflow-auto p-5 md:p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white">Настройки ORDA</h1>
        <p className="mt-2 text-slate-400">
          Компания, материалы, сотрудники, права и системные параметры
        </p>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {tabs.map(([value, title]) => (
          <button
            type="button"
            key={value}
            disabled={saving}
            onClick={() => setTab(value)}
            className={`rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-60 ${tab === value ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
          >
            {title}
          </button>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200"
        >
          {error}
        </p>
      )}
      {success && (
        <p className="mb-4 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-green-200">
          {success}
        </p>
      )}
      {tab === "company" && (
        <div className="space-y-5 rounded-2xl border border-slate-700 bg-[#101827] p-5">
          <h2 className="text-xl font-bold text-white">Компания</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              ["name", "Название"],
              ["bin", "БИН / ИИН"],
              ["legalAddress", "Юридический адрес"],
              ["actualAddress", "Фактический адрес"],
              ["phone", "Телефон"],
              ["whatsapp", "WhatsApp"],
              ["email", "Email"],
              ["bankDetails", "Банковские реквизиты"],
              ["directorName", "Директор"],
              ["logoUrl", "Logo URL"],
            ].map(([key, label]) => (
              <Input
                key={key}
                label={label}
                value={data.company[key] ?? ""}
                disabled={saving}
                onChange={(value) => updateSection("company", key, value)}
              />
            ))}
          </div>
          <button
            disabled={saving}
            onClick={() => void saveSection("company")}
            className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-60"
          >
            Сохранить компанию
          </button>
        </div>
      )}
      {tab === "system" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
            <h2 className="mb-4 text-xl font-bold text-white">
              Системные параметры
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Валюта"
                value={data.system.currency}
                disabled
                onChange={() => {}}
              />
              <Input
                label="Часовой пояс"
                value={data.system.timezone}
                disabled
                onChange={() => {}}
              />
              <Input
                label="Формат даты"
                value={data.system.dateFormat}
                disabled={saving}
                onChange={(value) =>
                  updateSection("system", "dateFormat", value)
                }
              />
              {[
                ["minimumPrepayment", "Минимальная предоплата"],
                ["measurementLeadDays", "Срок замера, дней"],
                ["measurerOrderBonus", "Бонус замерщику за оформленный заказ, ₸"],
                ["productionLeadDays", "Срок производства, дней"],
                ["installationLeadDays", "Срок монтажа, дней"],
                ["nextDocumentNumber", "Следующий номер документа"],
              ].map(([key, label]) => (
                <Input
                  key={key}
                  label={label}
                  type="number"
                  value={data.system[key] ?? 0}
                  disabled={saving}
                  onChange={(value) => updateSection("system", key, value)}
                />
              ))}
              {[
                ["offerPrefix", "Префикс КП"],
                ["contractPrefix", "Префикс договора"],
                ["actPrefix", "Префикс акта"],
                ["invoicePrefix", "Префикс счёта"],
              ].map(([key, label]) => (
                <Input
                  key={key}
                  label={label}
                  value={data.system[key] ?? ""}
                  disabled={saving}
                  onChange={(value) => updateSection("system", key, value)}
                />
              ))}
            </div>
            <button
              disabled={saving}
              onClick={() => void saveSection("system")}
              className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-60"
            >
              Сохранить параметры
            </button>
          </div>
        </div>
      )}
      {tab === "materials" && (
        <div className="space-y-5">
          <form
            onSubmit={saveMaterial}
            className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-5 md:grid-cols-3"
          >
            <Input
              label="Название"
              value={materialForm.name}
              disabled={saving}
              onChange={(value) =>
                setMaterialForm({ ...materialForm, name: value })
              }
            />
            <Input
              label="Категория"
              value={materialForm.category}
              disabled={saving}
              onChange={(value) =>
                setMaterialForm({ ...materialForm, category: value })
              }
            />
            <Input
              label="Единица"
              value={materialForm.unit}
              disabled={saving}
              onChange={(value) =>
                setMaterialForm({ ...materialForm, unit: value })
              }
            />
            <Input
              label="Базовая цена"
              type="number"
              value={materialForm.purchasePrice}
              disabled={saving}
              onChange={(value) =>
                setMaterialForm({ ...materialForm, purchasePrice: value })
              }
            />
            <label className="flex items-end gap-2 pb-3 text-slate-200">
              <input
                checked={materialForm.active}
                disabled={saving}
                type="checkbox"
                onChange={(event) =>
                  setMaterialForm({
                    ...materialForm,
                    active: event.target.checked,
                  })
                }
              />
              Активен
            </label>
            <div className="flex items-end gap-2">
              <button
                disabled={saving}
                className="rounded-xl bg-blue-600 px-4 py-3 text-white disabled:opacity-60"
              >
                {editingMaterial ? "Сохранить" : "Создать"}
              </button>
              {editingMaterial && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setEditingMaterial(null);
                    setMaterialForm(emptyMaterial);
                  }}
                  className="rounded-xl bg-slate-700 px-4 py-3 text-white"
                >
                  Отмена
                </button>
              )}
            </div>
          </form>
          <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827]">
            <table className="w-full min-w-[720px] text-left">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="p-4">Материал</th>
                  <th className="p-4">Категория</th>
                  <th className="p-4">Цена</th>
                  <th className="p-4">Статус</th>
                  <th className="p-4">Действия</th>
                </tr>
              </thead>
              <tbody>
                {data.materials.map((material) => (
                  <tr
                    className="border-t border-slate-800 text-slate-200"
                    key={material.id}
                  >
                    <td className="p-4">
                      {material.name} · {material.unit}
                    </td>
                    <td className="p-4">{material.category}</td>
                    <td className="p-4">
                      {Number(material.purchasePrice).toLocaleString("ru-RU")} ₸
                    </td>
                    <td className="p-4">
                      {material.active ? "Активен" : "Отключён"}
                    </td>
                    <td className="p-4">
                      <div className="flex gap-2">
                        <button
                          disabled={saving}
                          onClick={() => {
                            setEditingMaterial(material);
                            setMaterialForm({
                              name: material.name,
                              category: material.category,
                              unit: material.unit,
                              purchasePrice: String(material.purchasePrice),
                              active: material.active,
                            });
                          }}
                          className="rounded-lg bg-slate-700 px-3 py-2"
                        >
                          Изменить
                        </button>
                        <button
                          disabled={saving}
                          onClick={() =>
                            void patchMaterial(material, {
                              active: !material.active,
                            })
                          }
                          className="rounded-lg bg-slate-700 px-3 py-2"
                        >
                          {material.active ? "Отключить" : "Включить"}
                        </button>
                        <button
                          disabled={saving || material._count.movements > 0}
                          onClick={() => void deleteMaterial(material)}
                          className="rounded-lg bg-red-600 px-3 py-2 disabled:opacity-40"
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === "users" && <EmployeesPage />}
      {tab === "permissions" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827] p-5">
          <h2 className="mb-4 text-xl font-bold text-white">
            Матрица ролей и прав
          </h2>
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-slate-400">Право</th>
                {Object.values(Role).map((role) => (
                  <th key={role} className="p-2 text-slate-400">
                    {roleNames[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissionKeys.map((permission) => (
                <tr key={permission} className="border-t border-slate-800">
                  <td className="p-2 text-slate-200">{permission}</td>
                  {Object.values(Role).map((role) => (
                    <td key={role} className="p-2 text-center">
                      <input
                        aria-label={`${role} ${permission}`}
                        disabled={
                          saving ||
                          (role === Role.DIRECTOR &&
                            (permission === "settings" ||
                              permission === "employees"))
                        }
                        checked={data.rolePermissions[role]?.includes(
                          permission,
                        )}
                        type="checkbox"
                        onChange={() => togglePermission(role, permission)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button
            disabled={saving}
            onClick={() => void savePermissions()}
            className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-60"
          >
            Сохранить права
          </button>
        </div>
      )}
    </section>
  );
}
