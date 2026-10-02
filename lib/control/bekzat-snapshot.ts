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
      return {
        key: issue.key,
        title: issue.title,
        reason: issue.reason,
        action: issue.action,
        href: issue.href,
        assigneeId: issue.assigneeId,
        assignee: issue.assigneeId ? `Ответственный ORDA №${issue.assigneeId}` : "Требуется назначить ответственного",
        task: null,
      };
    }),
  };
}
