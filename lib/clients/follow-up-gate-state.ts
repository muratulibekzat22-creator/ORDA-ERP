export type FollowUpGateMode = "initial-loading" | "passthrough" | "overlay";

export function followUpGateMode(input: {
  sessionLoading: boolean;
  manager: boolean;
  checked: boolean;
  itemCount: number;
}): FollowUpGateMode {
  if (input.sessionLoading || (input.manager && !input.checked)) return "initial-loading";
  if (input.manager && input.itemCount > 0) return "overlay";
  return "passthrough";
}
