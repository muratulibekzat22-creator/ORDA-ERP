import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import PartnerManagementWorkspace from "@/components/partners/PartnerManagementWorkspace";

export default async function PartnerManagementPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== Role.DIRECTOR) notFound();
  return <PartnerManagementWorkspace />;
}
