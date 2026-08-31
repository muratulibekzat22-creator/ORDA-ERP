import { getServerSession } from "next-auth";
import { forbidden, redirect } from "next/navigation";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import OperationsWorkspace from "@/components/operations/OperationsWorkspace";
import { Role } from "@/lib/roles";
import { enterTenantFromSession } from "@/lib/tenant-context";

export default async function OperationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !enterTenantFromSession(session)) redirect("/login");
  const role = session.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.OPERATIONS_DIRECTOR) forbidden();
  if (session.user.companyId !== 1 || session.user.isDemo) forbidden();
  return <OperationsWorkspace role={role} />;
}
