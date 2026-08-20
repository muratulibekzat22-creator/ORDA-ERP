import { Role } from "./roles";

export const roleHome: Partial<Record<Role, string>> = {
  [Role.PARTNER]: "/partner",
  [Role.MARKETER]: "/marketing",
};
