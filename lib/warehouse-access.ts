import { Role } from "@prisma/client";

export type WarehouseSession = {
  user: {
    id: string;
    role: string;
    accountRole?: string;
    name?: string | null;
  };
};

export function warehouseAccountRole(session: WarehouseSession) {
  return (session.user.accountRole || session.user.role) as Role;
}

export function isInternalWarehouseRole(role: Role) {
  return role !== Role.PARTNER;
}

export function warehouseActorFromSession(session: WarehouseSession) {
  return {
    userId: Number(session.user.id),
    role: warehouseAccountRole(session),
    name: session.user.name ?? null,
  };
}
