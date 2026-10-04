import { Suspense } from "react";

import EmployeeKpiPage from "@/components/pages/EmployeeKpiPage";

export default function Page() {
  return <Suspense fallback={<div className="p-8 text-slate-400">Загрузка KPI…</div>}><EmployeeKpiPage /></Suspense>;
}
