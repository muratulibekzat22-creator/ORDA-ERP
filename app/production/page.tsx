"use client";

import { useEffect, useState } from "react";

import ProductionKanban, {
  type ProductionKanbanItem,
} from "@/components/production/ProductionKanban";
import ProductionTable from "@/components/production/ProductionTable";

type Production = ProductionKanbanItem & { masterUserId?: number | null; masterUser?: { id:number; name:string } | null };

export default function ProductionPage() {
  const [productions, setProductions] = useState<Production[]>([]);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void fetch("/api/production")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить производство");
        return response.json() as Promise<Production[]>;
      })
      .then((data) => {
        if (active) setProductions(data);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Не удалось загрузить производство"
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function changeStage(id: number, stage: string) {
    const current = productions.find((production) => production.id === id);

    if (!current || current.stage === stage) return;

    setUpdatingId(id);
    setError("");

    try {
      const response = await fetch("/api/production", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, stage, ...(current.masterUserId ? { masterUserId: current.masterUserId } : {}) }),
      });
      const result: unknown = await response.json();

      if (!response.ok) {
        const message =
          result && typeof result === "object" && "error" in result && typeof result.error === "string"
            ? result.error
            : "Не удалось обновить этап";

        throw new Error(message);
      }

      const updatedProduction = result as Production;

      setProductions((currentProductions) =>
        currentProductions.map((production) =>
          production.id === updatedProduction.id ? updatedProduction : production
        )
      );
    } catch (updateError) {
      console.error(updateError);
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Не удалось обновить этап"
      );
    } finally {
      setUpdatingId(null);
    }
  }

  const completed = productions.filter((item) => item.stage === "Сдано").length;
  const inProgress = productions.length - completed;
  const averagePercent = productions.length
    ? Math.round(
        productions.reduce((sum, item) => sum + item.percent, 0) / productions.length
      )
    : 0;

  return (
    <section className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Производство</h1>
        <p className="text-slate-400">Контроль выполнения заказов</p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
        <Stat title="Всего заказов" value={productions.length} color="text-white" />
        <Stat title="В работе" value={inProgress} color="text-yellow-400" />
        <Stat title="Сдано" value={completed} color="text-green-400" />
        <Stat title="Средняя готовность" value={`${averagePercent}%`} color="text-blue-400" />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <ProductionKanban
        productions={productions}
        onStageChange={changeStage}
        updatingId={updatingId}
      />

      <ProductionTable productions={productions} />
    </section>
  );
}

function Stat({ title, value, color }: { title: string; value: string | number; color: string }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
      <p className="text-slate-400">{title}</p>
      <h2 className={`mt-3 text-4xl font-bold ${color}`}>{value}</h2>
    </div>
  );
}
