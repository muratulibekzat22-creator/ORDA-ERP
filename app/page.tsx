import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import DirectorCockpit from "@/components/dashboard/DirectorCockpit";
import DashboardPage from "@/components/dashboard/page";
import MeasurerHome from "@/components/measurements/MeasurerHome";
import { getManagerMorningReviewState } from "@/lib/services/manager-morning-review.service";
import { enterTenantFromSession } from "@/lib/tenant-context";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const role = session.user.role as Role;
  if (role === Role.MARKETER) redirect("/marketing");
  if (role === Role.OPERATIONS_DIRECTOR) redirect("/operations");
  if (role === Role.PARTNER) redirect("/partner");
  if (role === Role.MEASURER) return <MeasurerHome />;
  if (role === Role.MANAGER) {
    if (!enterTenantFromSession(session)) redirect("/login");
    const morning = await getManagerMorningReviewState(Number(session.user.id));
    if (morning.mustReview) redirect("/manager-morning-check");
    return <DirectorCockpit />;
  }
  if (role === Role.DIRECTOR || role === Role.ACCOUNTANT || role === Role.PRODUCTION || role === Role.INSTALLER) return <DirectorCockpit />;
  return <DashboardPage />;
}
