import { Role } from "./roles";

export const roleHome: Partial<Record<Role, string>> = {
  [Role.MEASURER]: "/measurements",
  [Role.PARTNER]: "/partner",
};
