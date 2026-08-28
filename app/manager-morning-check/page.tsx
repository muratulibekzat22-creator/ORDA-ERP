import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import ManagerMorningCheck from "@/components/orders/ManagerMorningCheck";
import { getManagerMorningReviewState } from "@/lib/services/manager-morning-review.service";
import { enterTenantFromSession } from "@/lib/tenant-context";

export default async function ManagerMorningCheckPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !enterTenantFromSession(session)) redirect("/login");
  if (session.user.role !== Role.MANAGER) redirect("/");
  const state = await getManagerMorningReviewState(Number(session.user.id));
  if (state.reviewedToday || state.bypassReason === "NO_ASSIGNED_ORDERS")
    redirect("/");
  return <ManagerMorningCheck initialState={state} />;
}
