import { Role } from "./roles";
export type Permission="employees"|"clients"|"orders"|"measurements"|"calendar"|"documents"|"finance"|"partners"|"reports"|"settings"|"design"|"production"|"installation";
const all:Permission[]=["employees","clients","orders","measurements","calendar","documents","finance","partners","reports","settings","design","production","installation"];
export const permissions:Record<Role,Permission[]>={DIRECTOR:all,MANAGER:["clients","orders","measurements","calendar","documents"],ACCOUNTANT:["finance","partners","reports"],MEASURER:["measurements","calendar"],DESIGNER:["design","orders"],PRODUCTION:["production"],INSTALLER:["production","installation"],PARTNER:["orders","finance","partners","documents"]};
export const hasPermission=(role:Role,permission:Permission)=>permissions[role].includes(permission);
