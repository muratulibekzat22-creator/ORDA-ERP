import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { forbidden, redirect } from "next/navigation";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import MarketingWorkspace from "@/components/marketing/MarketingWorkspace";

export default async function MarketingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const role = session.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.OPERATIONS_DIRECTOR && role !== Role.MARKETER) forbidden();
  return <MarketingWorkspace />;
}
