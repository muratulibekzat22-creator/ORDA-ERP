import { ReactNode } from "react";
import { TrendingUp } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  color?: string;
  icon?: ReactNode;
  description?: string;
}

export default function StatCard({
  title,
  value,
  color = "text-white",
  icon,
  description,
}: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-700 bg-[#101827] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-500/10">

      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-blue-500/10 blur-2xl transition-all group-hover:bg-blue-500/20" />

      <div className="relative flex items-start justify-between">

        <div className="flex-1">

          <p className="text-sm font-medium text-slate-400">
            {title}
          </p>

          <h2 className={`mt-3 text-3xl font-bold ${color}`}>
            {value}
          </h2>

          {description && (
            <p className="mt-2 text-xs text-slate-500">
              {description}
            </p>
          )}

        </div>

        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800 text-blue-400">

          {icon ?? <TrendingUp size={28} />}

        </div>

      </div>

      <div className="mt-6 h-1 overflow-hidden rounded-full bg-slate-800">

        <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-green-400" />

      </div>

    </div>
  );
}