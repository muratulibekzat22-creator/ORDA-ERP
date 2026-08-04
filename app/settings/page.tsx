"use client";

import { useCallback, useEffect, useState } from "react";

type SettingsValues = {
  pinePrice: number; elmPrice: number; oakPrice: number; woodRailing: number;
  glassRailing: number; brassRailing: number; ledPrice: number; paintingPrice: number; installationPrice: number;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsValues>({
    pinePrice: 65000,
    elmPrice: 85000,
    oakPrice: 110000,

    woodRailing: 650000,
    glassRailing: 900000,
    brassRailing: 1800000,

    ledPrice: 250000,
    paintingPrice: 300000,
    installationPrice: 350000,
  });

  const loadSettings = useCallback(async () => {
    const response = await fetch("/api/settings");

    if (!response.ok) return;

    const data = await response.json() as SettingsValues;

    setSettings(data);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSettings(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSettings]);

  async function saveSettings() {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    });

    if (response.ok) {
      alert("Настройки успешно сохранены.");
    }
  }

  function update(name: keyof SettingsValues, value: number) {
    setSettings((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  return (
    <section className="space-y-8 p-8">

      <div>

        <h1 className="text-4xl font-bold text-white">
          Настройки ORDA
        </h1>

        <p className="text-slate-400">
          Цены и параметры расчета
        </p>

      </div>

      <div className="grid grid-cols-2 gap-6">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-5 text-xl font-bold text-white">
            Стоимость ступеней
          </h2>

          <div className="space-y-4">

            <input
              type="number"
              value={settings.pinePrice}
              onChange={(e) =>
                update("pinePrice", Number(e.target.value))
              }
              placeholder="Сосна"
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
            />

            <input
              type="number"
              value={settings.elmPrice}
              onChange={(e) =>
                update("elmPrice", Number(e.target.value))
              }
              placeholder="Карагач"
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
            />

            <input
              type="number"
              value={settings.oakPrice}
              onChange={(e) =>
                update("oakPrice", Number(e.target.value))
              }
              placeholder="Дуб"
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
            />

          </div>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-5 text-xl font-bold text-white">
            Ограждения
          </h2>

          <div className="space-y-4">

            <input
              type="number"
              value={settings.woodRailing}
              onChange={(e) =>
                update("woodRailing", Number(e.target.value))
              }
              placeholder="Дерево"
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
            />

            <input
              type="number"
              value={settings.glassRailing}
              onChange={(e) =>
                update("glassRailing", Number(e.target.value))
              }
              placeholder="Стекло"
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
            />

            <input
              type="number"
              value={settings.brassRailing}
              onChange={(e) =>
                update("brassRailing", Number(e.target.value))
              }
              placeholder="Латунь"
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
            />

          </div>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-5 text-xl font-bold text-white">
            Дополнительные услуги
          </h2>

          <div className="space-y-4">

            <input
              type="number"
              value={settings.ledPrice}
              onChange={(e) =>
                update("ledPrice", Number(e.target.value))
              }
              placeholder="LED"
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
            />

            <input
              type="number"
              value={settings.paintingPrice}
              onChange={(e) =>
                update("paintingPrice", Number(e.target.value))
              }
              placeholder="Покраска"
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
            />

            <input
              type="number"
              value={settings.installationPrice}
              onChange={(e) =>
                update("installationPrice", Number(e.target.value))
              }
              placeholder="Монтаж"
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
            />

          </div>

        </div>

      </div>

      <button
        onClick={saveSettings}
        className="rounded-xl bg-blue-600 px-8 py-4 text-lg font-semibold text-white hover:bg-blue-700"
      >
        💾 Сохранить настройки
      </button>

    </section>
  );
}
