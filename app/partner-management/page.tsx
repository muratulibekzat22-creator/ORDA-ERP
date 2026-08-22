import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { forbidden, redirect } from "next/navigation";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import PartnerSettlementWorkspace from "@/components/partners/PartnerSettlementWorkspace";

export default async function PartnerManagementPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== Role.DIRECTOR) forbidden();
  return <PartnerSettlementWorkspace />;
}
