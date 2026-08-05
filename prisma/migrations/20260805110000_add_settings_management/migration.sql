-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('employees', 'clients', 'orders', 'measurements', 'calendar', 'documents', 'finance', 'partners', 'reports', 'settings', 'design', 'production', 'installation');

-- AlterTable
ALTER TABLE "Material" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT 'ALTYN SAPA COMPANY',
    "bin" TEXT NOT NULL DEFAULT '',
    "legalAddress" TEXT NOT NULL DEFAULT '',
    "actualAddress" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "whatsapp" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "bankDetails" TEXT NOT NULL DEFAULT '',
    "directorName" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
    "dateFormat" TEXT NOT NULL DEFAULT 'dd.MM.yyyy',
    "minimumPrepayment" INTEGER NOT NULL DEFAULT 0,
    "measurementLeadDays" INTEGER NOT NULL DEFAULT 3,
    "productionLeadDays" INTEGER NOT NULL DEFAULT 40,
    "installationLeadDays" INTEGER NOT NULL DEFAULT 7,
    "nextDocumentNumber" INTEGER NOT NULL DEFAULT 1,
    "offerPrefix" TEXT NOT NULL DEFAULT 'КП',
    "contractPrefix" TEXT NOT NULL DEFAULT 'ДОГ',
    "actPrefix" TEXT NOT NULL DEFAULT 'АКТ',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'СЧ',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" SERIAL NOT NULL,
    "role" "Role" NOT NULL,
    "permission" "Permission" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_role_permission_key" ON "RolePermission"("role", "permission");
CREATE INDEX "RolePermission_role_idx" ON "RolePermission"("role");
