CREATE TABLE "CalculatorTariff" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "uiName" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "salePrice" DECIMAL(12,2) NOT NULL,
  "internalPrice" DECIMAL(12,2) NOT NULL,
  "defaultQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "manualPriceAllowed" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CalculatorTariff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalculatorTariff_code_key" ON "CalculatorTariff"("code");
CREATE INDEX "CalculatorTariff_active_sortOrder_idx" ON "CalculatorTariff"("active", "sortOrder");

ALTER TABLE "OrderCalculationLine" ADD COLUMN "code" TEXT;

INSERT INTO "CalculatorTariff" ("code", "uiName", "kind", "unit", "salePrice", "internalPrice", "defaultQuantity", "manualPriceAllowed", "active", "sortOrder", "updatedAt") VALUES
('PINE_STEP', 'Сосна', 'STAIR_MATERIAL', 'экв. ступень', 65000, 45000, 0, false, true, 10, CURRENT_TIMESTAMP),
('ELM_STEP', 'Карагач', 'STAIR_MATERIAL', 'экв. ступень', 80000, 55000, 0, false, true, 20, CURRENT_TIMESTAMP),
('OAK_LAMELLA_STEP', 'Дуб ламель', 'STAIR_MATERIAL', 'экв. ступень', 85000, 60000, 0, false, true, 30, CURRENT_TIMESTAMP),
('BRASS_BALUSTERS', 'Латунные балясины', 'BRASS_BALUSTERS', 'шт.', 0, 0, 0, false, true, 100, CURRENT_TIMESTAMP),
('BAROQUE_BALUSTERS', 'Балясины барокко', 'BAROQUE_BALUSTERS', 'шт.', 0, 0, 0, false, true, 110, CURRENT_TIMESTAMP),
('GLASS_RAILING', 'Стеклянное ограждение', 'GLASS', 'м²', 0, 0, 0, true, true, 120, CURRENT_TIMESTAMP),
('WOOD_BALUSTERS', 'Деревянные балясины', 'WOOD_BALUSTERS', 'шт.', 0, 0, 0, false, true, 130, CURRENT_TIMESTAMP),
('METAL_RAILING', 'Металлическое ограждение', 'METAL_RAILING', 'м', 0, 0, 0, true, true, 140, CURRENT_TIMESTAMP),
('FIRST_POST', 'Первая стойка', 'MATERIAL', 'шт.', 0, 0, 0, true, true, 150, CURRENT_TIMESTAMP),
('COLUMN', 'Колонна', 'MATERIAL', 'шт.', 0, 0, 0, true, true, 160, CURRENT_TIMESTAMP),
('CROWN', 'Корона', 'MATERIAL', 'шт.', 0, 0, 0, true, true, 170, CURRENT_TIMESTAMP),
('TIE', 'Тай', 'MATERIAL', 'шт.', 0, 0, 0, true, true, 180, CURRENT_TIMESTAMP),
('HANDRAIL', 'Перила', 'HANDRAIL', 'м', 0, 0, 0, false, true, 190, CURRENT_TIMESTAMP),
('RISERS', 'Подступенники', 'RISERS', 'шт.', 0, 0, 0, false, true, 200, CURRENT_TIMESTAMP),
('LIGHTING', 'Подсветка', 'LIGHTING', 'ступень', 0, 0, 0, false, true, 210, CURRENT_TIMESTAMP),
('PAINTING', 'Покраска', 'PAINTING', 'м²', 0, 0, 0, false, true, 220, CURRENT_TIMESTAMP),
('INSTALLATION', 'Монтаж', 'INSTALLATION', 'заказ', 0, 0, 1, true, true, 230, CURRENT_TIMESTAMP),
('DELIVERY', 'Доставка', 'DELIVERY', 'рейс', 0, 0, 1, true, true, 240, CURRENT_TIMESTAMP),
('OTHER_WORK', 'Дополнительные работы', 'OTHER_WORK', 'работа', 0, 0, 0, true, true, 250, CURRENT_TIMESTAMP);
