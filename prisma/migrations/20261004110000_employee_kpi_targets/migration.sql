-- CreateEnum
CREATE TYPE "EmployeeKpiKind" AS ENUM ('AUTO', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EmployeeKpiUnit" AS ENUM ('COUNT', 'MONEY', 'PERCENT');

-- CreateEnum
CREATE TYPE "EmployeeKpiRequestStatus" AS ENUM ('OPEN', 'FULFILLED');

-- CreateTable
CREATE TABLE "EmployeeKpiTarget" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "metricCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "EmployeeKpiKind" NOT NULL DEFAULT 'AUTO',
    "unit" "EmployeeKpiUnit" NOT NULL DEFAULT 'COUNT',
    "target" DECIMAL(14,2) NOT NULL,
    "manualActual" DECIMAL(14,2),
    "evidence" TEXT,
    "updatedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeKpiTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeKpiRequest" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "EmployeeKpiRequestStatus" NOT NULL DEFAULT 'OPEN',
    "requestedById" INTEGER NOT NULL,
    "note" TEXT,
    "resolvedById" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeKpiRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeKpiTarget_companyId_year_month_idx" ON "EmployeeKpiTarget"("companyId", "year", "month");

-- CreateIndex
CREATE INDEX "EmployeeKpiTarget_employeeId_year_month_idx" ON "EmployeeKpiTarget"("employeeId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeKpiTarget_companyId_employeeId_year_month_metricCod_key" ON "EmployeeKpiTarget"("companyId", "employeeId", "year", "month", "metricCode");

-- CreateIndex
CREATE INDEX "EmployeeKpiRequest_companyId_year_month_status_idx" ON "EmployeeKpiRequest"("companyId", "year", "month", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeKpiRequest_companyId_employeeId_year_month_key" ON "EmployeeKpiRequest"("companyId", "employeeId", "year", "month");

-- AddForeignKey
ALTER TABLE "EmployeeKpiTarget" ADD CONSTRAINT "EmployeeKpiTarget_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeKpiTarget" ADD CONSTRAINT "EmployeeKpiTarget_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeePayrollProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeKpiTarget" ADD CONSTRAINT "EmployeeKpiTarget_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeKpiRequest" ADD CONSTRAINT "EmployeeKpiRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeKpiRequest" ADD CONSTRAINT "EmployeeKpiRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeePayrollProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeKpiRequest" ADD CONSTRAINT "EmployeeKpiRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeKpiRequest" ADD CONSTRAINT "EmployeeKpiRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

