# Защита ветки main

## Required checks

После первого запуска workflow выбрать в ruleset точные проверки:

- `Static quality gate`
- `Database integration gate`

Integration check завершается успешно с явным статусом skip, пока отсутствуют repository secrets `TEST_DATABASE_URL` и `NEXTAUTH_SECRET_TEST`. Production `DATABASE_URL` в GitHub Actions не добавлять.

## Рекомендуемый ruleset

- запретить force-push и удаление `main`;
- требовать pull request и разрешение всех conversations;
- требовать обе CI-проверки и актуальную ветку перед merge;
- при появлении второго разработчика требовать минимум одно approval и dismiss stale approvals;
- включить linear history;
- разрешить bypass только OWNER/аварийному администратору с обязательной фиксацией причины;
- ограничить прямой push командой владельцев репозитория.

Настройки GitHub не изменялись: в рабочей среде нет авторизованного `gh` CLI. Владелец применяет ruleset в Settings → Rules → Rulesets и проверяет его тестовым pull request.
