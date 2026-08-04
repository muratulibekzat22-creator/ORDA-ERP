"use client";

import { useState } from "react";

interface Props {
  orderId: number;
}

export default function ProjectMeasurement({ orderId }: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    measurer: "",
    visitDate: "",
    floorHeight: "",
    staircaseWidth: "",
    stepsCount: "",
    comment: "",
  });

  async function saveMeasurement() {
    setLoading(true);

    const res = await fetch("/api/measurements", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId,

        measurer: form.measurer,
        visitDate: form.visitDate,

        floorHeight: Number(form.floorHeight),
        staircaseWidth: Number(form.staircaseWidth),
        stepsCount: Number(form.stepsCount),

        comment: form.comment,
      }),
    });

    if (res.ok) {
      alert("Замер успешно сохранён.");

      setForm({
        measurer: "",
        visitDate: "",
        floorHeight: "",
        staircaseWidth: "",
        stepsCount: "",
        comment: "",
      });
    } else {
      alert("Ошибка сохранения.");
    }

    setLoading(false);
  }

  return (
    <div className="bg-white rounded-xl shadow p-6 space-y-4">

      <h2 className="text-xl font-bold">
        Замер объекта
      </h2>

      <input
        className="border rounded-lg p-3 w-full"
        placeholder="Замерщик"
        value={form.measurer}
        onChange={(e) =>
          setForm({ ...form, measurer: e.target.value })
        }
      />

      <input
        type="date"
        className="border rounded-lg p-3 w-full"
        value={form.visitDate}
        onChange={(e) =>
          setForm({ ...form, visitDate: e.target.value })
        }
      />

      <input
        className="border rounded-lg p-3 w-full"
        placeholder="Высота этажа"
        value={form.floorHeight}
        onChange={(e) =>
          setForm({ ...form, floorHeight: e.target.value })
        }
      />

      <input
        className="border rounded-lg p-3 w-full"
        placeholder="Ширина лестницы"
        value={form.staircaseWidth}
        onChange={(e) =>
          setForm({ ...form, staircaseWidth: e.target.value })
        }
      />

      <input
        className="border rounded-lg p-3 w-full"
        placeholder="Количество ступеней"
        value={form.stepsCount}
        onChange={(e) =>
          setForm({ ...form, stepsCount: e.target.value })
        }
      />

      <textarea
        className="border rounded-lg p-3 w-full h-32"
        placeholder="Комментарий"
        value={form.comment}
        onChange={(e) =>
          setForm({ ...form, comment: e.target.value })
        }
      />

      <button
        onClick={saveMeasurement}
        disabled={loading}
        className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-6 py-3"
      >
        {loading ? "Сохранение..." : "Сохранить замер"}
      </button>

    </div>
  );
}