export type ControlIssue = {
  key: string; title: string; reason: string; action: string; href: string;
  assigneeId: number | null; clientId: number; orderId?: number;
  priority: "URGENT" | "IMPORTANT";
};
export type ControlLead = {
  id: number; name: string; managerUserId: number | null; createdAt: Date;
  nextContactAt: Date | null;
  nextActions: { nextActionAt: Date; completedAt?: Date | null; resultComment?: string | null; nextActionType?: string }[];
  interactions: { createdAt: Date }[];
};
export type ControlOrder = {
  id: number; number: string; clientId: number; managerUserId: number | null;
  partnerId: number | null; partnerPrice: unknown; partnerAgreedAt: Date | null;
  promisedAt: Date | null; productionDeadline: Date | null; lifecycle: string;
  client: { phone: string; city: string };
};

export function detectControlIssues(leads: ControlLead[], orders: ControlOrder[], now: Date): ControlIssue[] {
  const issues: ControlIssue[] = [];
  for (const lead of leads) {
    const pending = lead.nextActions.filter(a => !a.completedAt);
    const recordedContact = lead.nextActions.some(a => a.completedAt && a.resultComment?.trim() && ["CALL", "WHATSAPP", "FOLLOW_UP", "MEETING"].includes(a.nextActionType ?? "") && a.resultComment !== "Заменено новым действием");
    const overdue = (lead.nextContactAt && lead.nextContactAt < now) || pending.some(a => a.nextActionAt < now);
    const noPlan = !lead.nextContactAt && !pending.length;
    const noContact = !lead.interactions.length && !recordedContact && now.getTime() - lead.createdAt.getTime() >= 86400000;
    if (!overdue && !noPlan && !noContact && lead.managerUserId) continue;
    const reasons = [!lead.managerUserId && "Не назначен менеджер", overdue && "Просрочено следующее действие", noPlan && "Не назначено следующее действие", noContact && "В карточке нет записи о контакте за первые 24 часа"].filter(Boolean);
    issues.push({ key: `lead:${lead.id}`, clientId: lead.id, assigneeId: lead.managerUserId,
      title: `Связь с клиентом: ${lead.name}`, reason: reasons.join(". "),
      action: "Проверьте историю общения. Свяжитесь с клиентом, если контакт ещё не выполнен. Запишите фактический результат и назначьте следующее действие с датой; закройте просроченные действия с результатом.",
      href: `/clients/${lead.id}`, priority: overdue || noContact ? "URGENT" : "IMPORTANT" });
  }
  for (const order of orders) {
    const gaps: string[] = [];
    if (!order.managerUserId) gaps.push("ответственный менеджер");
    if (!order.client.phone.trim()) gaps.push("телефон клиента");
    if (!order.client.city.trim()) gaps.push("город клиента");
    const deadline = order.promisedAt ?? order.productionDeadline;
    if (!deadline) gaps.push("срок заказа");
    // Production pricing is mandatory once preparation has finished, not for a fresh draft.
    if (!["CREATED", "PREPARATION"].includes(order.lifecycle)) {
      if (!order.partnerId) gaps.push("цех");
      if (!(Number(order.partnerPrice) >= 2) || !order.partnerAgreedAt) gaps.push("подтверждённая цена производства для расчёта маржи");
    }
    if (gaps.length) issues.push({ key: `order:${order.id}:data`, clientId: order.clientId, orderId: order.id,
      assigneeId: order.managerUserId, title: `${order.number}: заполнить данные`, reason: `Не заполнены: ${gaps.join(", ")}.`,
      action: "Заполните недостающие поля подтверждёнными данными. Если требуется решение директора, укажите конкретный вопрос и срок.",
      href: `/orders/${order.id}`, priority: "IMPORTANT" });
    if (deadline && deadline < now) issues.push({ key: `order:${order.id}:deadline`, clientId: order.clientId, orderId: order.id,
      assigneeId: order.managerUserId, title: `${order.number}: просрочен срок`, reason: `Срок в карточке: ${deadline.toISOString().slice(0,10)}.`,
      action: "Проверьте фактический этап. Зафиксируйте причину задержки, согласованный с клиентом план и подтверждённый срок. Не переносите дату без согласования.",
      href: `/orders/${order.id}`, priority: "URGENT" });
  }
  return issues.sort((a,b) => Number(b.priority === "URGENT") - Number(a.priority === "URGENT") || a.key.localeCompare(b.key));
}
