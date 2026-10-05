import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import DirectorCockpit from "@/components/dashboard/DirectorCockpit";
import DashboardPage from "@/components/dashboard/page";
import MeasurerHome from "@/components/measurements/MeasurerHome";
import { measurerNeedsMandatoryTraining } from "@/lib/services/training.service";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const role = session.user.role as Role;
  if (role === Role.PARTNER) redirect("/partner");
  if (role === Role.MARKETER) redirect("/marketing");
  if (role === Role.MEASURER) {
    if (await measurerNeedsMandatoryTraining(Number(session.user.id))) redirect("/training");
    return <MeasurerHome />;
  }
  if (role === Role.DIRECTOR || role === Role.OPERATIONS_DIRECTOR || role === Role.MANAGER || role === Role.ACCOUNTANT || role === Role.PRODUCTION || role === Role.INSTALLER)
    return <DirectorCockpit founder={session.user.accountRole === Role.DIRECTOR} />;
  return <DashboardPage />;
}
