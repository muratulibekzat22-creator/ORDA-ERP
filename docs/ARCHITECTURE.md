# Архитектура ORDA ERP

## Контур

ORDA ERP — внутренняя система ALTYN SAPA на Next.js App Router. Пользовательские страницы состоят из React Server Components и клиентских компонентов; серверные операции выполняются API routes. `proxy.ts` выполняет раннюю маршрутизацию по сессии и роли, но окончательная авторизация всегда остаётся в API.

## Поток запроса

1. Vercel принимает HTTPS-запрос и запускает Next.js.
2. NextAuth Credentials проверяет пароль, активность, блокировку и версию сессии.
3. API вызывает `requirePermission`; для PARTNER дополнительно применяется ownership по связанной записи Partner.
4. Prisma Client через PostgreSQL driver adapter и pooled URL обращается к Neon PostgreSQL.
5. Приватные вложения записываются в Vercel Blob и выдаются только через авторизованный API.

## Среды и доставка

- Production: Vercel deployment + production Neon branch + private Blob.
- Preview: отдельный Vercel scope; не использовать как тестовую базу без явной изоляции.
- Tests: только локальный `TEST_DATABASE_URL` ветки `codex-tests`; переменная игнорируется Git и не должна существовать в Production.
- Сборка: `prisma migrate deploy && prisma generate && next build`.
- Репозиторий: GitHub, ветка `main`; автоматический CI workflow в репозитории отсутствует, поэтому полный локальный gate обязателен до push.

## Границы данных

- Финансовые поля выбираются и редактируются только разрешёнными ролями.
- PARTNER видит только собственные заказы, документы, вложения и профиль; внутренние идентификаторы ownership и маржа не сериализуются.
- Персональные и финансовые ответы нельзя помещать в общий/public cache.
- Blob URL не является пользовательской моделью доступа: доступ определяется API и БД.

## Внешние зависимости

Vercel, Neon PostgreSQL, Vercel Blob и GitHub. Платёжных, почтовых, SMS, аналитических и внешних AI SDK в runtime-контуре нет.

