import type { getFounderControl } from "@/lib/services/founder-control.service";

type Control = Awaited<ReturnType<typeof getFounderControl>>;
export function toBekzatFinance(finance: { netProfit: number; dataComplete: boolean } | null) {
  if (!finance || finance.dataComplete !== true || !Number.isFinite(finance.netProfit)) {
    return { finance: null, financeStatus: finance ? "incomplete" as const : "unavailable" as const };
  }
  return { finance: { netProfit: finance.netProfit, dataComplete: true as const }, financeStatus: "complete" as const };
}

// Explicit allowlist: client/employee names, free text and payroll never cross this boundary.
export function toBekzatSnapshot(control: Control) {
  return {
    checkedAt: control.checkedAt,
    summary: {
      overdue: control.summary.overdue,
      verified: control.summary.verified,
      unacknowledged: control.summary.unacknowledged,
    },
    issues: control.issues.map(issue => {
      const lead = issue.key.startsWith("lead:");
      const deadline = issue.key.endsWith(":deadline");
      return {
        key: issue.key,
        title: lead ? "Проверить работу с заявкой" : deadline ? "Проверить срок заказа" : "Заполнить данные заказа",
        reason: "Автопроверка обнаружила незавершённое действие или недостаток данных в ORDA.",
        action: "Откройте карточку ORDA для подробностей. Исполнение проверяется по исходным данным.",
        href: lead ? `/clients/${issue.clientId}` : `/orders/${issue.orderId}`,
        assigneeId: issue.assigneeId,
        assignee: issue.assigneeId ? `Ответственный ORDA №${issue.assigneeId}` : "Требуется назначить ответственного",
        task: issue.task ? {
          status: issue.task.status,
          dueAt: issue.task.dueAt,
          acknowledgedAt: issue.task.acknowledgedAt,
          resultSubmittedAt: issue.task.resultSubmittedAt,
        } : null,
      };
    }),
  };
}
