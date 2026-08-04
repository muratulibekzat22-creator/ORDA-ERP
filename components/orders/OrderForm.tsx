"use client";

import { useEffect, useState } from "react";

interface Client {
  id: number;
  name: string;
}

interface Props {
  onSave: () => void;
}

export default function OrderForm({ onSave }: Props) {
  const [clients, setClients] = useState<Client[]>([]);

  const [clientId, setClientId] = useState("");
  const [address, setAddress] = useState("");

  const [staircase, setStaircase] = useState("П-образная");
  const [material, setMaterial] = useState("Карагач");

  const [steps, setSteps] = useState(20);
  const [platforms, setPlatforms] = useState(1);

  const [railing, setRailing] = useState("Нет");

  const [led, setLed] = useState(false);
  const [painting, setPainting] = useState(true);
  const [installation, setInstallation] = useState(true);

  const [amount, setAmount] = useState(0);

  useEffect(() => {
    async function loadClients() {
      try {
        const response = await fetch("/api/clients");

        if (!response.ok) {
          throw new Error("Ошибка загрузки клиентов");
        }

        const result = await response.json();

        setClients(Array.isArray(result.data) ? result.data : []);
      } catch (error) {
        console.error(error);
        setClients([]);
      }
    }

    loadClients();
  }, []);

  useEffect(() => {
    calculate();
  }, [
    steps,
    platforms,
    material,
    railing,
    led,
    painting,
    installation,
  ]);

  function calculate() {
    let stepPrice = 85000;

    if (material === "Сосна") stepPrice = 65000;
    if (material === "Карагач") stepPrice = 85000;
    if (material === "Дуб") stepPrice = 110000;

    const totalSteps = steps + platforms * 3;

    let total = totalSteps * stepPrice;

    if (railing === "Дерево") total += 650000;
    if (railing === "Стекло") total += 900000;
    if (railing === "Латунь") total += 1800000;

    if (led) total += 250000;
    if (painting) total += 300000;
    if (installation) total += 350000;

    setAmount(total);
  }

  async function save() {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: Number(clientId),
        address,
        staircase,
        material,
        steps,
        platforms,
        railing,
        led,
        painting,
        installation,
      }),
    });

    if (response.ok) {
      onSave();

      setClientId("");
      setAddress("");

      setSteps(20);
      setPlatforms(1);

      setMaterial("Карагач");
      setStaircase("П-образная");

      setRailing("Нет");

      setLed(false);
      setPainting(true);
      setInstallation(true);

      setAmount(0);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
      <h2 className="mb-6 text-2xl font-bold text-white">
        Новый заказ
      </h2>

      <div className="grid grid-cols-2 gap-4">
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="rounded-xl bg-slate-900 p-3 text-white"
        >
          <option value="">Выберите клиента</option>

          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>

        <input
          placeholder="Адрес объекта"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="rounded-xl bg-slate-900 p-3 text-white"
        />

        <select
          value={staircase}
          onChange={(e) => setStaircase(e.target.value)}
          className="rounded-xl bg-slate-900 p-3 text-white"
        >
          <option>П-образная</option>
          <option>Г-образная</option>
          <option>Прямая</option>
          <option>Винтовая</option>
        </select>

        <select
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          className="rounded-xl bg-slate-900 p-3 text-white"
        >
          <option>Сосна</option>
          <option>Карагач</option>
          <option>Дуб</option>
        </select>

        <input
          type="number"
          placeholder="Количество ступеней"
          value={steps}
          onChange={(e) => setSteps(Number(e.target.value))}
          className="rounded-xl bg-slate-900 p-3 text-white"
        />

        <input
          type="number"
          placeholder="Количество площадок"
          value={platforms}
          onChange={(e) => setPlatforms(Number(e.target.value))}
          className="rounded-xl bg-slate-900 p-3 text-white"
        />

        <select
          value={railing}
          onChange={(e) => setRailing(e.target.value)}
          className="rounded-xl bg-slate-900 p-3 text-white"
        >
          <option>Нет</option>
          <option>Дерево</option>
          <option>Стекло</option>
          <option>Латунь</option>
        </select>

        <div className="flex items-center gap-3 text-white">
          <input
            type="checkbox"
            checked={led}
            onChange={(e) => setLed(e.target.checked)}
          />
          LED подсветка
        </div>

        <div className="flex items-center gap-3 text-white">
          <input
            type="checkbox"
            checked={painting}
            onChange={(e) => setPainting(e.target.checked)}
          />
          Покраска
        </div>

        <div className="flex items-center gap-3 text-white">
          <input
            type="checkbox"
            checked={installation}
            onChange={(e) => setInstallation(e.target.checked)}
          />
          Монтаж
        </div>
      </div>

      <div className="mt-8 rounded-xl bg-slate-900 p-5">
        <p className="text-slate-400">
          Предварительная стоимость
        </p>

        <h2 className="mt-2 text-4xl font-bold text-green-400">
          {amount.toLocaleString()} ₸
        </h2>
      </div>

      <button
        onClick={save}
        className="mt-6 w-full rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white hover:bg-blue-700"
      >
        Создать заказ
      </button>
    </div>
  );
}