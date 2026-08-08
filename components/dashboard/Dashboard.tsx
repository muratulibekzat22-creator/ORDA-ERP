"use client";

import { useSession } from "next-auth/react";
import DashboardPage from "@/components/dashboard/page";
import DirectorCockpit from "@/components/dashboard/DirectorCockpit";
import MeasurerHome from "@/components/measurements/MeasurerHome";

export default function Dashboard() {
  const { data: session, status } = useSession();
  if (status === "loading")
    return (
      <div role="status" className="space-y-4 p-4 md:p-8">
        <div className="h-20 animate-pulse rounded-2xl bg-slate-900" />
        <div className="h-64 animate-pulse rounded-2xl bg-slate-900" />
      </div>
    );
  if (
    ["DIRECTOR", "MANAGER", "ACCOUNTANT", "PRODUCTION", "INSTALLER"].includes(
      session?.user.role ?? "",
    )
  )
    return <DirectorCockpit />;
  if (session?.user.role === "MEASURER") return <MeasurerHome />;
  return <DashboardPage />;
}
