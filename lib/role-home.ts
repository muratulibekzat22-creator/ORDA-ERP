import { Role } from "./roles";

export const roleHome: Partial<Record<Role, string>> = {
  [Role.ACCOUNTANT]: "/finance",
  [Role.MEASURER]: "/calendar",
  [Role.PRODUCTION]: "/production",
  [Role.INSTALLER]: "/production",
  [Role.PARTNER]: "/partner",
};
