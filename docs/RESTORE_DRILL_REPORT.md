# Restore drill ORDA ERP

- Дата подготовки: 2026-08-06
- Источник: изолированная Neon branch `codex-tests`
- Целевая branch: OWNER ACTION REQUIRED — временная restore branch ещё не создана
- Рекомендуемый RPO: не более 1 часа — OWNER APPROVAL REQUIRED
- Рекомендуемый RTO: не более 4 часов — OWNER APPROVAL REQUIRED
- Ответственный: OWNER + TECHNICAL ADMIN

## Статус

Neon CLI запросил интерактивную авторизацию владельца, поэтому ветка не создавалась и не удалялась. Production branch и production данные не затрагивались. Подготовлен `scripts/verify-database-restore.ts`, который одновременно подключается только к явно заданным source/restore URL, запрещает одинаковые targets и требует подтверждения изоляции.

## Проверяемые данные

`User`, `Client`, `Order`, `OrderCalculation`, `Payment`, `Material`, `MaterialMovement`, `Document`, 33 migrations и отсутствие orphan relations. Сравниваются counts, диапазоны ids, SHA-256 безопасного сериализованного содержимого, Decimal, timestamps и связи; PII, пароли и connection strings не выводятся.

## Одно необходимое действие владельца

Авторизовать Neon CLI командой `npx neonctl auth` в этой рабочей копии либо самостоятельно создать временную branch из `codex-tests` на контрольный timestamp и предоставить два локальных URL как `SOURCE_DATABASE_URL` и `RESTORE_DATABASE_URL`. После этого Technical Admin запускает:

```powershell
$env:RESTORE_DRILL_CONFIRM_ISOLATED='true'
npx tsx scripts/verify-database-restore.ts
```

Значения URL не должны попадать в командную историю, отчёт или Git. После `passed` владелец удаляет только временную restore branch.

## Таблица RPO/RTO

| Инцидент | RPO | RTO | Восстановление | Ответственный | Проверка |
|---|---:|---:|---|---|---|
| Ошибочная запись/удаление | ≤1 час* | ≤4 часа* | PITR в новую branch | OWNER + TECHNICAL ADMIN | hashes/counts + business smoke |
| Неудачная migration | до момента deploy | ≤2 часа* | остановка записей, совместимый rollback/restore branch | TECHNICAL ADMIN | migrations + schema + API security |
| Недоступность primary | platform recovery | ≤4 часа* | Neon branch/endpoint cutover после проверки | OWNER + TECHNICAL ADMIN | health + critical screens |
| Потеря Blob-файла | зависит от отдельной копии | ≤24 часа* | восстановление объекта и metadata reconciliation | OWNER | protected download + checksum |

`*` OWNER APPROVAL REQUIRED. Фактические RPO/RTO фиксируются после полного drill.
