import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import DirectorTrainingReport from "@/components/training/DirectorTrainingReport";
import TrainingWorkspace from "@/components/training/TrainingWorkspace";
import { MEASURER_COURSE, MEASURER_KNOWLEDGE, MEASURER_QUESTIONS } from "@/lib/training-course";

export default async function TrainingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role === Role.MEASURER) return <TrainingWorkspace />;
  if (session.user.role === Role.DIRECTOR || session.user.role === Role.OPERATIONS_DIRECTOR)
    return <DirectorTrainingReport course={{
      title: MEASURER_COURSE.title,
      version: MEASURER_COURSE.version,
      passScorePercent: MEASURER_COURSE.passScorePercent,
      requiredCoverage: MEASURER_COURSE.requiredCoverage,
      questionCount: MEASURER_QUESTIONS.length,
      lessons: MEASURER_COURSE.videoLessons.map((lesson) => ({
        key: lesson.key,
        title: lesson.title,
        description: lesson.description,
        youtubeVideoId: lesson.youtubeVideoId,
      })),
      knowledge: MEASURER_KNOWLEDGE.map((section) => ({ title: section.title, items: [...section.items] })),
    }} />;
  redirect("/");
}
