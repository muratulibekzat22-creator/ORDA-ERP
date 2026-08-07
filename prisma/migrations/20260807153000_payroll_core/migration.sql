-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('OPEN', 'REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayrollAccrualType" AS ENUM ('BASE_SALARY', 'GUARANTEED_ORDER_BONUS', 'ORDER_BONUS', 'EXTRA_BONUS', 'PREMIUM', 'DEDUCTION', 'ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE', 'BONUS_REVERSAL');

-- CreateEnum
CREATE TYPE "PayrollDirection" AS ENUM ('INCREASE', 'DECREASE');

-- CreateEnum
CREATE TYPE "PayrollPaymentType" AS ENUM ('ADVANCE', 'IMMEDIATE_BONUS', 'SALARY_PAYMENT', 'FINAL_SETTLEMENT', 'OTHER_PAYROLL_PAYMENT', 'EMPLOYEE_REFUND');

-- CreateEnum
CREATE TYPE "AdvanceRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BonusPaymentMode" AS ENUM ('ACCUMULATE', 'IMMEDIATE');

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'payroll';

-- AlterTable
ALTER TABLE "CompanyLedgerEntry" ADD COLUMN     "affectsProfit" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "payrollAccrualId" INTEGER,
ADD COLUMN     "payrollPaymentId" INTEGER;

-- CreateTable
CREATE TABLE "EmployeePayrollProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "hiredAt" TIMESTAMP(3) NOT NULL,
    "terminatedAt" TIMESTAMP(3),
    "payrollEnabled" BOOLEAN NOT NULL DEFAULT true,
    "baseSalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "defaultGuaranteedBonus" DECIMAL(14,2) NOT NULL DEFAULT 20000,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeePayrollProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeSalaryRate" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "approvedById" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeSalaryRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" INTEGER,
    "closeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollAccrual" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "earnedPeriodId" INTEGER,
    "type" "PayrollAccrualType" NOT NULL,
    "direction" "PayrollDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "orderId" INTEGER,
    "reason" TEXT NOT NULL,
    "paymentMode" "BonusPaymentMode",
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "reversalOfId" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayment" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "type" "PayrollPaymentType" NOT NULL,
    "method" TEXT,
    "comment" TEXT,
    "paidById" INTEGER NOT NULL,
    "relatedAccrualId" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollAdvanceRequest" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "requestedAmount" DECIMAL(14,2) NOT NULL,
    "approvedAmount" DECIMAL(14,2),
    "comment" TEXT,
    "reviewComment" TEXT,
    "status" "AdvanceRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "paymentId" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollAdvanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayrollProfile_userId_key" ON "EmployeePayrollProfile"("userId");

-- CreateIndex
CREATE INDEX "EmployeeSalaryRate_employeeId_effectiveFrom_idx" ON "EmployeeSalaryRate"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_closeKey_key" ON "PayrollPeriod"("closeKey");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_year_month_key" ON "PayrollPeriod"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollAccrual_reversalOfId_key" ON "PayrollAccrual"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollAccrual_idempotencyKey_key" ON "PayrollAccrual"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PayrollAccrual_employeeId_periodId_idx" ON "PayrollAccrual"("employeeId", "periodId");

-- CreateIndex
CREATE INDEX "PayrollAccrual_orderId_idx" ON "PayrollAccrual"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_idempotencyKey_key" ON "PayrollPayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PayrollPayment_employeeId_periodId_idx" ON "PayrollPayment"("employeeId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollAdvanceRequest_paymentId_key" ON "PayrollAdvanceRequest"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollAdvanceRequest_idempotencyKey_key" ON "PayrollAdvanceRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PayrollAdvanceRequest_employeeId_status_idx" ON "PayrollAdvanceRequest"("employeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLedgerEntry_payrollAccrualId_key" ON "CompanyLedgerEntry"("payrollAccrualId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLedgerEntry_payrollPaymentId_key" ON "CompanyLedgerEntry"("payrollPaymentId");

-- AddForeignKey
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_payrollAccrualId_fkey" FOREIGN KEY ("payrollAccrualId") REFERENCES "PayrollAccrual"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLedgerEntry" ADD CONSTRAINT "CompanyLedgerEntry_payrollPaymentId_fkey" FOREIGN KEY ("payrollPaymentId") REFERENCES "PayrollPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayrollProfile" ADD CONSTRAINT "EmployeePayrollProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSalaryRate" ADD CONSTRAINT "EmployeeSalaryRate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeePayrollProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSalaryRate" ADD CONSTRAINT "EmployeeSalaryRate_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAccrual" ADD CONSTRAINT "PayrollAccrual_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeePayrollProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAccrual" ADD CONSTRAINT "PayrollAccrual_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAccrual" ADD CONSTRAINT "PayrollAccrual_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAccrual" ADD CONSTRAINT "PayrollAccrual_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAccrual" ADD CONSTRAINT "PayrollAccrual_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAccrual" ADD CONSTRAINT "PayrollAccrual_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "PayrollAccrual"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeePayrollProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_relatedAccrualId_fkey" FOREIGN KEY ("relatedAccrualId") REFERENCES "PayrollAccrual"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdvanceRequest" ADD CONSTRAINT "PayrollAdvanceRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "EmployeePayrollProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdvanceRequest" ADD CONSTRAINT "PayrollAdvanceRequest_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdvanceRequest" ADD CONSTRAINT "PayrollAdvanceRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdvanceRequest" ADD CONSTRAINT "PayrollAdvanceRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PayrollPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
