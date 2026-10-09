DO $$
DECLARE
  target_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO target_count
  FROM (
    SELECT c."id"
    FROM "Company" c
    JOIN "User" founder
      ON founder."companyId" = c."id"
     AND founder."role" = 'DIRECTOR'::"Role"
     AND founder."active" = true
    JOIN "User" director
      ON director."companyId" = c."id"
     AND director."role" = 'OPERATIONS_DIRECTOR'::"Role"
     AND director."active" = true
    WHERE c."active" = true
      AND c."isDemo" = false
    GROUP BY c."id"
    HAVING COUNT(DISTINCT founder."id") = 1
       AND COUNT(DISTINCT director."id") = 1
  ) targets;
  IF target_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active real company with one founder and one operations director, found %', target_count;
  END IF;
END $$;

WITH eligible AS (
  SELECT
    c."id" AS "companyId",
    MIN(founder."id") AS "founderId",
    MIN(director."id") AS "directorId"
  FROM "Company" c
  JOIN "User" founder
    ON founder."companyId" = c."id"
   AND founder."role" = 'DIRECTOR'::"Role"
   AND founder."active" = true
  JOIN "User" director
    ON director."companyId" = c."id"
   AND director."role" = 'OPERATIONS_DIRECTOR'::"Role"
   AND director."active" = true
  WHERE c."active" = true
    AND c."isDemo" = false
  GROUP BY c."id"
  HAVING COUNT(DISTINCT founder."id") = 1
     AND COUNT(DISTINCT director."id") = 1
),
single_target AS (
  SELECT *
  FROM eligible
  WHERE (SELECT COUNT(*) FROM eligible) = 1
),
inserted AS (
  INSERT INTO "CalendarTask" (
    "companyId",
    "title",
    "description",
    "type",
    "dueAt",
    "status",
    "priority",
    "assigneeId",
    "creatorId",
    "acknowledgementRequired",
    "updatedAt"
  )
  SELECT
    target."companyId",
    'Регламент директора: ежедневный, недельный и месячный контроль ORDA',
    E'Алихан, нужно вести ORDA как единственный рабочий источник данных.\n\nЕЖЕДНЕВНО\n1. Проверить новые заявки: ответственный менеджер, источник, стадия, качество лида, следующее действие и дата.\n2. Проверить замеры: телефон, адрес, дата и время, назначенный замерщик либо явная отметка «Замерщик не выбран», итог просроченных замеров.\n3. Проверить активные заказы: менеджер, срок, выбранный цех, цена производства, оплаты и правильная стадия.\n4. Внести фактические финансовые операции и показатели Meta/таргета: расход, лиды, заказы и выручка.\n5. Открыть блок «Требуют внимания», назначить ответственного и срок исправления каждого замечания.\n\nЕЖЕНЕДЕЛЬНО\n1. Проанализировать воронку: заявки → замеры → КП → заказы и конверсию каждого менеджера.\n2. Проанализировать рекламу: расход, качество заявок, CPL, CAC, ROAS и результат каждого канала.\n3. Закрыть просрочки по заказам, замерам и задачам; сверить передачу заказов в цех и сроки производства.\n4. Обновить вакансии и статусы кандидатов.\n\nЕЖЕМЕСЯЧНО — В ПЕРВЫЙ РАБОЧИЙ ДЕНЬ\n1. Закрыть предыдущий месяц: продажи, поступления, расходы, цены производства и остатки.\n2. Проверить KPI менеджеров и рабочую активность команды, устранить незаполненные данные.\n3. Подготовить основателю короткий итог: результат, отклонения, причины, действия, ответственные и сроки.\n\nПодтвердите, что ознакомились и поняли задачу, укажите реальную дату выполнения первого полного контроля. В выбранный день приложите результат текстом, фото, документом или видео.',
    'TASK'::"CalendarTaskType",
    TIMESTAMP '2026-10-02 13:00:00',
    'PLANNED'::"CalendarTaskStatus",
    'URGENT'::"CalendarTaskPriority",
    target."directorId",
    target."founderId",
    true,
    CURRENT_TIMESTAMP
  FROM single_target target
  WHERE NOT EXISTS (
    SELECT 1
    FROM "CalendarTask" existing
    WHERE existing."companyId" = target."companyId"
      AND existing."assigneeId" = target."directorId"
      AND existing."title" = 'Регламент директора: ежедневный, недельный и месячный контроль ORDA'
      AND existing."status" <> 'CANCELLED'::"CalendarTaskStatus"
  )
  RETURNING "id", "creatorId", "assigneeId", "dueAt"
)
INSERT INTO "CalendarTaskAudit" ("taskId", "action", "after", "actorId")
SELECT
  inserted."id",
  'CREATED',
  jsonb_build_object(
    'source', 'DIRECTOR_OPERATING_REGULATION',
    'assigneeId', inserted."assigneeId",
    'dueAt', inserted."dueAt",
    'acknowledgementRequired', true
  ),
  inserted."creatorId"
FROM inserted;
