ALTER TYPE "PartnerSettlementOperationStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "PartnerSettlementOperationStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "PartnerSettlementOperationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
