import { Suspense } from "react";

import SalesPlanPage from "@/components/pages/SalesPlanPage";

export default function Page() {
  return <Suspense fallback={<div className="p-8 text-slate-400">Загрузка плана…</div>}><SalesPlanPage /></Suspense>;
}
