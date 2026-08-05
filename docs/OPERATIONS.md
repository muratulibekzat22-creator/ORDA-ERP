# Эксплуатация ORDA ERP

## Выпуск

1. Убедиться, что тесты используют только `TEST_DATABASE_URL` и test branch.
2. Выполнить security, business, idempotency, warehouse, production-domain, calculator, commercial-boundary и order-UX suites.
3. Выполнить lint, TypeScript, production build, Prisma validate/status, `npm audit`, `git diff --check`.
4. Снять/подтвердить backup и проверить миграцию на test branch.
5. Push неизменного HEAD в `main`; deploy этого же SHA.
6. Проверить alias, `/api/health`, login и основные кабинеты; просмотреть Runtime Logs на 500, Prisma и migration errors.

## Миграции

Только additive/проверенные миграции через `prisma migrate deploy`. Не редактировать применённые migrations, не запускать `migrate reset` в production. Один ответственный запускает выпуск; отключение advisory lock требует исключить параллельные deploy. Rollback приложения допустим только если схема обратно совместима; откат данных — по отдельному плану восстановления.

## Наблюдение

- Health: HTTP 200 и `{status:"ok",database:"ok"}`; никакой инфраструктурной детализации.
- Ежедневно: deployment и Runtime Logs, 500, auth lockouts, Blob errors.
- Еженедельно: Vercel/Neon/Blob usage, медленные endpoints и объём БД.
- Ежемесячно: `npm audit`, outdated review, права владельцев, restore window и тест восстановления.

Логи не должны содержать пароли, токены, connection strings, полные тела запросов, финансовые payload или PII. Для корреляции использовать случайный request id, не email/телефон.

## Деградация

- Neon недоступен: health возвращает 503; не повторять финансовые мутации без исходного idempotency key.
- Blob недоступен: сохранить бизнес-операцию отдельно от файла только если UI ясно сообщает результат; повтор загрузки должен быть безопасен.
- Истёкшая/аннулированная сессия: 401/403 и повторный вход.
- Большой/невалидный файл или JSON: 4xx без внутренней ошибки.
- Медленная сеть: блокировать повторную кнопку мутации, применять timeout/AbortController на UI.

