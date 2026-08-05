# Реестр сервисов и доступов

| Сервис | Назначение | Данные/секреты | Минимальный доступ | Контроль |
|---|---|---|---|---|
| Vercel | Next.js hosting, deploy, logs | env vars, deployment metadata | Owner + Technical Admin | MFA, scopes, usage alerts |
| Neon | production/test PostgreSQL | бизнес и персональные данные, DB credentials | Owner + Technical Admin; read-only при необходимости | MFA, branch protection, restore window |
| Vercel Blob | приватные вложения | клиентские документы, token | Owner + Technical Admin | private store, usage/error review |
| GitHub | source, history, delivery | код, CI secrets при появлении | Owner + разработчик | MFA, protected main, reviews, Dependabot |
| Локальный test harness | регрессия | только codex-tests URL | Technical Admin | `.env.test.local`, cleanup, свободный порт |

## Матрица инфраструктурных доступов

| Роль | GitHub | Vercel | Neon/Blob | Секреты/логи | Production ERP |
|---|---|---|---|---|---|
| OWNER | admin | owner/billing | owner | по необходимости | DIRECTOR |
| TECHNICAL ADMIN | write/admin по задаче | deploy/logs | operational, без billing | управляет rotation | тестовый аккаунт; DIRECTOR только по инциденту |
| PROJECT MANAGER | нет или read issues | viewer при необходимости | нет | нет | MANAGER |
| ACCOUNTANT | нет | нет | нет | нет | ACCOUNTANT |
| EMPLOYEE | нет | нет | нет | нет | персональная роль |
| EXTERNAL CONTRACTOR | временный least privilege, без main push | нет по умолчанию | нет | нет | отдельный ограниченный аккаунт при необходимости |

Обычным сотрудникам выдаются только production URL, персональный логин и временный пароль с обязательной сменой. Общие аккаунты запрещены. Доступы пересматриваются при увольнении и ежеквартально.

## Проверенные переменные

Production/Preview используют `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`; Blob — `BLOB_READ_WRITE_TOKEN`. Bootstrap-переменные первого директора должны быть удалены после подтверждённого создания. `TEST_DATABASE_URL` допускается только локально. Значения в документацию и логи не включаются.

