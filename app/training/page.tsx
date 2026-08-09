import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import DirectorTrainingReport from "@/components/training/DirectorTrainingReport";
import TrainingWorkspace from "@/components/training/TrainingWorkspace";

export default async function TrainingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role === Role.MEASURER) return <TrainingWorkspace />;
  if (session.user.role === Role.DIRECTOR) return <DirectorTrainingReport />;
  redirect("/");
}
