# ORDA ERP: role-based acceptance matrix

Матрица фиксирует baseline-доступ. Любое расширение persisted permission matrix требует повторной проверки page proxy, sidebar и API ownership. `403/404` API являются обязательной границей; скрытие элемента в UI не считается защитой.

| Роль | Разрешённые страницы | Запрещённые страницы | Основные API | Финансовые поля | Обязательно скрыто |
|---|---|---|---|---|---|
| DIRECTOR | Все рабочие разделы, включая employees, settings, calculator-config, company-finance, personal-finance | Только несуществующие маршруты | Все API в рамках permission matrix | Клиентские суммы, стоимость цеха, выплаты, прибыль, себестоимость | Пароли, sessionVersion, requestHash/idempotencyKey в публичных payload |
| MANAGER | `/`, clients, orders, calculator, measurements/calendar, documents, production, warehouse, partners | finance, reports/analytics, employees, settings, company/personal-finance, calculator-config | clients, orders, calculation, documents, calendar, production, warehouse, partners | Клиентская цена, предоплата, остаток, разрешённая клиентская корректировка | `internalPrice`, `unitCost`, `workshopCost`, `partnerPrice`, `companyProfit`, `grossProfit`, `totalCost` |
| ACCOUNTANT | `/finance`, partners, reports/analytics, warehouse, company-finance, read-only calculator-config | clients, orders pages, production, employees, settings, personal-finance | finance/payments, reports, partners, warehouse, calculator-config GET | Клиентские платежи, задолженность, стоимость/выплаты цеху; company ledger | Управление статусами/ценовой политикой, изменение calculator-config, personal finance, `grossProfit/companyProfit` в order detail |
| MEASURER | `/calendar` | clients, orders, calculator, finance, partners, production, warehouse, reports, employees, settings | measurements и calendar только в собственном scope | Нет | Чужие замеры, production, финансовые поля; из клиента только имя/город/адрес и контакт, необходимые для выезда |
| PRODUCTION | `/production`, `/calendar`, `/warehouse` | CRM, calculator, finance, partners, reports, employees, settings | production/calendar/warehouse только для назначенных заказов | Только количественные складские данные без закупочной цены | Чужое производство, монтажные задачи, клиентская цена, прибыль, purchasePrice/amount движения |
| INSTALLER | `/production`, `/calendar`, `/warehouse` | CRM, calculator, finance, partners, reports, employees, settings | production/calendar/warehouse только собственный этап «Монтаж» | Только количественные складские данные без закупочной цены | Чужой монтаж, не-монтажные production-задачи, клиентская цена, прибыль, purchasePrice/amount движения |
| PARTNER / ЦЕХ | `/partner`, собственные orders/documents/partner profile; `/finance` перенаправляется в кабинет цеха | clients, calculator, общий finance ledger, production, warehouse, reports, employees, settings | partner dashboard/profile, только собственные orders/documents и `PARTNER_PAYOUT` | Стоимость работ цеха, выплачено, остаток выплаты | Клиентская цена/оплаты/остаток, `companyProfit`, расчёты и себестоимость, чужие клиенты/заказы |

## Ежедневные и mobile-critical workflows

| Роль | Основной workflow | Mobile-critical |
|---|---|---|
| DIRECTOR | Dashboard → контроль заказов/денег/производства → исключения и настройки | KPI, просрочки, согласование цены, быстрый переход в заказ |
| MANAGER | Заявка/клиент → калькулятор → разрешённая клиентская цена/торг → КП → follow-up → заказ → передача в производство | Создать клиента и заказ, позвонить, записать follow-up, открыть КП |
| ACCOUNTANT | Finance → сверка оплат/возвратов/выплат → company ledger → отчёты | Добавить операцию, проверить задолженность и остаток выплаты |
| MEASURER | Calendar → собственный замер → контакт/адрес → результат и комментарий | Открыть адрес и телефон, перенести свой замер, записать размеры |
| PRODUCTION | Production → собственная карточка → этап/процент/комментарий → списание материалов | Найти назначенную задачу, обновить этап, проверить склад |
| INSTALLER | Production/Calendar → собственный монтаж → завершение → расход материалов | Адрес/дата монтажа, обновление статуса, списание материала |
| PARTNER / ЦЕХ | Кабинет цеха → собственные заказы → срок/этап/комментарий → выплаты | Обновить готовность и дату, проверить остаток выплаты |

## Автоматизация

- `npm run test:role-acceptance` — статический contract test без БД: permission baseline, page/sidebar exceptions, ownership clauses, financial redaction и технические ошибки.
- `npm run test:api:security` — DB integration: реальные cookie/session, own/foreign records, calendar/production/warehouse ownership и payload leakage. Требует только безопасный `TEST_DATABASE_URL`.
- `npm run test:commercial-boundary`, `npm run test:order-ux`, `npm run test:production:domain`, `npm run test:production:kanban`, `npm run test:warehouse` дополняют role acceptance по доменам.
