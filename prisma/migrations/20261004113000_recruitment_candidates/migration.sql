-- CreateEnum
CREATE TYPE "RecruitmentCandidateStatus" AS ENUM ('NEW', 'CONTACTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED');

-- CreateTable
CREATE TABLE "RecruitmentCandidate" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "vacancyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "status" "RecruitmentCandidateStatus" NOT NULL DEFAULT 'NEW',
    "note" TEXT,
    "responsibleUserId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_companyId_vacancyId_status_idx" ON "RecruitmentCandidate"("companyId", "vacancyId", "status");

-- CreateIndex
CREATE INDEX "RecruitmentCandidate_responsibleUserId_status_idx" ON "RecruitmentCandidate"("responsibleUserId", "status");

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "RecruitmentVacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruitmentCandidate" ADD CONSTRAINT "RecruitmentCandidate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
