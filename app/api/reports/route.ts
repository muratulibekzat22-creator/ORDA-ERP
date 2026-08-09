import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { getReportsReadModel } from "@/lib/services/report.service";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
function toCsv(report: Awaited<ReturnType<typeof getReportsReadModel>>) {
  const rows: unknown[][] = [
    ["ORDA Management Report"],
    ["Период", report.period.dateFrom, report.period.dateTo],
    [], ["Показатель", "Значение"],
    ["Заявки", report.summary.leads.current], ["Замеры", report.summary.measurements.current], ["Заказы", report.summary.orders.current],
    ["Сумма продаж", report.summary.salesAmount.current], ["Получено", report.summary.received.current], ["Остаток", report.summary.remaining],
    ...(report.sales.grossMargin === undefined ? [] : [["Валовая маржа", report.sales.grossMargin]]),
    ...(report.finance ? [
      ["К получению от клиентов", report.finance.customerRemaining],
      ["Согласовано партнёрам", report.finance.partnerAgreed],
      ["Выплачено партнёрам", report.finance.partnerPaid],
      ["К выплате партнёрам", report.finance.partnerRemaining],
      ["Payroll начислено", report.finance.payrollAccrued],
      ["Payroll выплачено", report.finance.payrollPaid],
      ["Payroll к выплате", report.finance.payrollPayable],
    ] : []),
    [], ["Менеджер", "Заявки", "Замеры", "Заказы", "Продажи", "Получено", "Конверсия, %"],
    ...report.managers.map((item) => [item.name, item.leads, item.measurements, item.orders, item.salesAmount, item.received, item.conversion ?? "—"]),
    [], ["№ заказа", "Клиент", "Менеджер", "Сумма", "Получено", "Остаток", "Статус"],
    ...report.orders.map((item) => [item.number, item.client, item.manager, item.amount, item.received, item.remaining, item.status]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}

export async function GET(request: Request) {
  const auth = await requirePermission("reports");
  if (auth.response) return auth.response;
  try {
    const url = new URL(request.url);
    const report = await getReportsReadModel(url.searchParams, { id: Number(auth.session!.user.id), role: auth.session!.user.role as Role });
    if (url.searchParams.get("export") === "csv") {
      const suffix = report.period.preset === "month" ? report.period.dateFrom.slice(0, 7) : `${report.period.dateFrom}_${report.period.dateTo}`;
      return new Response(toCsv(report), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ORDA_Report_${suffix}.csv"`, "cache-control": "no-store" } });
    }
    return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && ["INVALID_PERIOD", "INVALID_CUSTOM_RANGE", "INVALID_MANAGER"].includes(error.message)) return NextResponse.json({ error: "Некорректные параметры отчёта" }, { status: 400 });
    if (error instanceof Error && error.message === "REPORT_ROLE_FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    console.error("Reports API failed", error);
    return NextResponse.json({ error: "Не удалось сформировать отчёт" }, { status: 500 });
  }
}
