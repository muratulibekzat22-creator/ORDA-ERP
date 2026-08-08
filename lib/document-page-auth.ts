import { Role as PrismaRole } from "@prisma/client";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { Role } from "@/lib/roles";
import { getDocumentOrder } from "@/lib/services/document.service";
import { hasPermission } from "@/lib/services/permission.service";

export async function getAuthorizedDocumentOrder(id: number) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const role = session.user.role as Role;
  if (!Object.values(Role).includes(role) || !await hasPermission(role, "documents")) return null;
  return getDocumentOrder(id, { role: role as unknown as PrismaRole, userId: Number(session.user.id), name: session.user.name ?? "" });
}
