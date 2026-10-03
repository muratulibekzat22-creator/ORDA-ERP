export type MetaAction = { action_type?: string; value?: string };

const CONVERSATION_ACTION_TYPES = [
  "onsite_conversion.messaging_conversation_started_7d",
  "messaging_conversation_started_7d",
];
const LEAD_ACTION_TYPES = ["onsite_conversion.lead_grouped", "lead"];

export function campaignIdsFromEnv(value: string) {
  const ids = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (!ids.every((id) => /^\d+$/.test(id))) return [];
  return [...new Set(ids)];
}

export function onlySelectedCampaigns<T extends { campaign_id?: string }>(rows: T[], campaignIds: string[]) {
  const selectedIds = new Set(campaignIds);
  return rows.filter((row) => row.campaign_id && selectedIds.has(row.campaign_id));
}

function actionCount(actions: MetaAction[] | undefined, types: string[]) {
  const values = new Map((actions ?? []).map((action) => [action.action_type ?? "", Number(action.value ?? 0)]));
  return Math.max(0, ...types.map((type) => {
    const value = values.get(type) ?? 0;
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }));
}

export function metaActionCounts(actions: MetaAction[] | undefined) {
  return {
    conversations: actionCount(actions, CONVERSATION_ACTION_TYPES),
    leadActions: actionCount(actions, LEAD_ACTION_TYPES),
  };
}
