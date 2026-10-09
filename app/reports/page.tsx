import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import ReportsPage from "@/components/pages/ReportsPage";

export default async function ReportsRoutePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if ((session.user.accountRole || session.user.role) === Role.OPERATIONS_DIRECTOR)
    notFound();
  return <ReportsPage />;
}
