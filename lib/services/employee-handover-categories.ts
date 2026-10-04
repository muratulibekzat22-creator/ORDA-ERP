export const HANDOVER_CATEGORIES = ["clients", "orders", "tasks", "followUps", "approvals", "blockers", "marketingTasks", "recruitment"] as const;
export type HandoverCategory = typeof HANDOVER_CATEGORIES[number];
export type HandoverSelection = Record<HandoverCategory, boolean>;
