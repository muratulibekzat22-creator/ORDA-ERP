UPDATE "Production" SET "stage" = CASE "stage"
  WHEN 'Новая заявка' THEN 'Подготовка'
  WHEN 'Замер' THEN 'Подготовка'
  WHEN 'Проектирование' THEN 'Каркас'
  WHEN 'Заготовка' THEN 'Дерево'
  WHEN 'Заказ готов' THEN 'Готово к монтажу'
  ELSE "stage"
END;

UPDATE "Production"
SET "completedAt" = COALESCE("completedAt", "finishDate", "updatedAt"),
    "actualEndAt" = COALESCE("actualEndAt", "finishDate", "updatedAt")
WHERE "stage" = 'Сдано';

UPDATE "Order" SET "status" = CASE "status"
  WHEN 'Проектирование' THEN 'Каркас'
  WHEN 'Заготовка' THEN 'Дерево'
  WHEN 'Заказ готов' THEN 'Готово к монтажу'
  ELSE "status"
END;

UPDATE "ProductionStageHistory" SET
  "fromStage" = CASE "fromStage"
    WHEN 'Новая заявка' THEN 'Подготовка'
    WHEN 'Замер' THEN 'Подготовка'
    WHEN 'Проектирование' THEN 'Каркас'
    WHEN 'Заготовка' THEN 'Дерево'
    WHEN 'Заказ готов' THEN 'Готово к монтажу'
    ELSE "fromStage"
  END,
  "toStage" = CASE "toStage"
    WHEN 'Новая заявка' THEN 'Подготовка'
    WHEN 'Замер' THEN 'Подготовка'
    WHEN 'Проектирование' THEN 'Каркас'
    WHEN 'Заготовка' THEN 'Дерево'
    WHEN 'Заказ готов' THEN 'Готово к монтажу'
    ELSE "toStage"
  END;

INSERT INTO "RolePermission" ("role", "permission", "createdAt", "updatedAt")
VALUES ('MANAGER', 'production', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO NOTHING;
