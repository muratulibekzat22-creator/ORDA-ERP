import { companyDisplayPhones } from "@/lib/company-contacts";
import type { DocumentOrder } from "./types";

export function DocumentBrandHeader({
  order,
  title,
  documentNumber,
}: {
  order: DocumentOrder;
  title: string;
  documentNumber?: string;
}) {
  const company = order.company;
  return (
    <header className="flex items-start justify-between gap-6 border-b-4 border-amber-500 pb-5">
      <div className="flex items-center gap-4">
        {company?.logoUrl ? (
          // Logo URL is configured by ALTYN SAPA and must remain printable without image optimization.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoUrl}
            alt={`Логотип ${company.name}`}
            className="h-16 w-16 object-contain"
          />
        ) : (
          <div
            aria-label="ALTYN SAPA COMPANY"
            className="grid h-16 w-16 place-items-center rounded-xl bg-slate-950 text-2xl font-black text-amber-400"
          >
            AS
          </div>
        )}
        <div>
          <p className="text-2xl font-black tracking-wide text-slate-950">
            {company?.name || "ALTYN SAPA COMPANY"}
          </p>
          <p className="text-sm text-slate-600">
            Лестницы на заказ · изготовление и монтаж
          </p>
        </div>
      </div>
      <div className="text-right">
        <h1 className="text-xl font-bold uppercase text-slate-950">{title}</h1>
        <p className="mt-1 text-sm">№ {documentNumber || order.number}</p>
        <p className="text-sm">Заказ: {order.number}</p>
      </div>
    </header>
  );
}

export function DocumentBrandFooter({ order }: { order: DocumentOrder }) {
  const company = order.company;
  const phones = companyDisplayPhones(company);
  return (
    <footer className="mt-10 border-t border-slate-300 pt-4 text-xs text-slate-600">
      <div className="flex flex-wrap justify-between gap-3">
        <p>
          {company?.name || "ALTYN SAPA COMPANY"}
          {company?.bin ? ` · БИН ${company.bin}` : ""}
        </p>
        <p>{company?.actualAddress || company?.legalAddress || "Казахстан"}</p>
        <p>
          {phones.join(" · ")}
          {company?.email ? ` · ${company.email}` : ""}
        </p>
      </div>
    </footer>
  );
}
