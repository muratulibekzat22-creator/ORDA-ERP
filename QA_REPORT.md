# ORDA ERP QA report

Date: 2026-09-26
Branch: `codex/orda-simplified`

## Confirmed root cause

`ManagerFollowUpGate` started `load()` immediately and every 60 seconds. Every call set the same `loading` flag to `true`; while there were no mandatory items, the render condition `loading && items.length === 0` replaced the route children with the full-screen text `Проверяем обязательные контакты…`. That removed `NewOrderForm` from the React tree and destroyed its component-local state. A failed follow-up request also replaced the page with a blocking error screen.

The repaired gate uses the full-screen state only before the first completed manager check. Later checks use single-flight execution, keep `children` mounted, report errors non-blockingly, and render newly mandatory contacts as an overlay above the still-mounted route.

## Inventory

| Item | Count | Method |
|---|---:|---|
| Page routes | 40 | `app/**/page.tsx` inventory and successful Next.js production route build |
| API routes | 112 | `app/api/**/route.ts` inventory and successful Next.js production route build |
| Explicit API operations | 172 | exported `GET`/`POST`/`PATCH`/`DELETE` handlers; NextAuth catch-all is counted as a route separately |
| Roles | 10 | Prisma `Role` enum and role-acceptance contracts |
| Source-declared interactive elements/forms | 882 | 336 buttons, 67 Next Links, 64 anchors, 38 forms, 99 selects, 247 inputs, 20 textareas, 11 details elements |
| Checkboxes | 20 | subset of the 247 inputs |
| Dialogs/modals | 13 | explicit `role="dialog"` declarations |

The 882 figure is a source inventory, not a claim that every conditional runtime instance was clicked with every role. Authenticated live execution is tracked separately below.

## Roles

`DIRECTOR`, `OPERATIONS_DIRECTOR`, `MARKETER`, `MANAGER`, `ACCOUNTANT`, `MEASURER`, `DESIGNER`, `PARTNER`, `PRODUCTION`, `INSTALLER`.

## Page-route map

| Section | Routes | Primary roles | Audited controls/actions |
|---|---|---|---|
| Authentication/public | `/login`, `/change-password`, `/verify/payment-receipt/[token]` | Public / authenticated user | Login fields, password visibility, submit state, password change, public receipt verification |
| Dashboard/analytics | `/`, `/analytics` | Role-dependent / leadership | Navigation, dashboards, filters, analytics summaries |
| Leads/CRM | `/clients`, `/clients/[id]`, `/clients/[id]/proposal`, `/crm` | Manager, operations director | Search, filters, stage changes, CRUD, calculations, proposals, follow-ups, attachments |
| Orders/calculator | `/orders`, `/orders/new`, `/orders/[id]`, `/orders/[id]/act`, `/orders/[id]/contract`, `/orders/[id]/invoice`, `/orders/[id]/offer`, `/orders/[id]/print`, `/calculator`, `/calculator-config`, `/proposal/[id]` | Manager, leadership, accountant where allowed | New order, draft/retry/idempotency, tabs, kanban, calculations, payments, contracts and printable views |
| Planning/measurement | `/calendar`, `/measurements` | Manager, measurer, operations | Task CRUD/state, search, measurement forms, attachments and lifecycle |
| Documents | `/documents`, `/documents/[id]` | Permission-controlled | Search, create/update, versions, signature state, attachments |
| Operations | `/production`, `/warehouse` | Production, installer, operations, warehouse-authorized roles | Search/filter, production state, stock CRUD, batches, photos and movements |
| Finance/payroll | `/finance`, `/company-finance`, `/personal-finance`, `/payroll` | Director/accountant/employee self-service as scoped | Filters, journal actions, recurring entries, reconciliation, payroll/self-service |
| People/partners | `/employees`, `/partner`, `/partners`, `/partners/[id]`, `/partner-management` | Operations director, partner, leadership | Employee/access/password controls, partner profile, CRUD, settlement and statements |
| Governance/growth | `/marketing`, `/price-approvals`, `/settings`, `/training`, `/reports` | Marketer, leadership, role-scoped learners | CRUD, approvals, materials/settings, training attempts/heartbeat/report, period filters |

## API-route map

All paths below were included in the successful production route build.

| Domain | Routes and methods |
|---|---|
| Analytics/dashboard | `GET /api/analytics`, `GET /api/analytics/proposals`, `GET /api/dashboard/sales`, `GET /api/reports` |
| Authentication/health | NextAuth `/api/auth/[...nextauth]`, `POST /api/auth/change-password`, `GET /api/health`, `GET /api/internal/test-database-identity` |
| Clients | `GET,POST /api/clients`; `GET,PATCH,DELETE /api/clients/[id]`; `GET /api/clients/today`; `GET /api/clients/follow-up-gate`; `POST /api/clients/[id]/stage`; `POST /api/clients/[id]/restore`; `GET,DELETE /api/clients/[id]/force-delete`; `POST /api/clients/[id]/interactions`; `POST /api/clients/[id]/follow-ups`; `POST /api/clients/[id]/next-actions`; `POST /api/clients/[id]/next-actions/[actionId]/complete`; `GET,POST /api/clients/[id]/calculations`; `GET,POST /api/clients/[id]/proposals`; `GET /api/client-managers` |
| Client files | `GET,POST /api/client-attachments`; `GET,DELETE /api/client-attachments/[id]` |
| Orders | `GET,POST /api/orders`; `GET,PATCH,DELETE /api/orders/[id]`; `POST /api/orders/[id]/restore`; `GET /api/orders/options`; `GET /api/orders/search`; `GET /api/orders/[id]/[view]`; `POST /api/orders/[id]/commands`; `GET,POST /api/orders/[id]/calculation`; `GET /api/orders/[id]/materials`; `GET,POST /api/orders/[id]/payroll-bonuses`; `GET,POST /api/orders/[id]/contract`; `GET,POST /api/orders/[id]/contract-package`; `GET /api/orders/[id]/contract-package/download` |
| Proposals | `GET /api/proposal/[id]`; `PATCH /api/proposals/[id]`; `POST /api/proposals/[id]/convert`; `GET /api/proposals/[id]/pdf`; `POST /api/proposals/[id]/send` |
| Calculator | `GET,PATCH /api/calculator-config`; `GET,POST /api/calculator-pricing` |
| Calendar | `GET,POST /api/calendar`; `GET,PATCH /api/calendar/[id]`; `POST /api/calendar/[id]/complete`; `POST /api/calendar/[id]/cancel` |
| Measurements | `GET,POST /api/measurements`; `GET,PATCH /api/measurements/[id]`; `GET,POST /api/measurements/[id]/attachments`; `GET,DELETE /api/measurement-attachments/[id]`; `GET /api/document-links/measurement/[id]` |
| Documents/files | `GET,POST /api/documents`; `GET,PATCH /api/documents/[id]`; `GET,POST /api/documents/[id]/signed`; `POST /api/documents/[id]/versions`; `GET /api/document-versions/[id]`; `GET /api/document-options`; `GET,POST,DELETE /api/attachments`; `GET /api/attachments/[id]`; `POST /api/payment-receipts/[id]/generate` |
| Employees | `GET,POST /api/employees`; `PATCH,DELETE /api/employees/[id]`; `POST /api/employees/[id]/access`; `POST /api/employees/[id]/password`; `PATCH /api/employees/profile/[id]` |
| Finance | `GET,POST /api/finance`; `POST,PATCH /api/finance/categories`; `PATCH /api/finance/entries/[id]`; `POST /api/finance/entries/[id]/void`; `POST /api/finance/reconcile`; `GET,POST,PATCH /api/finance/recurring`; `POST /api/finance/reverse`; `GET,POST /api/finance/statements`; `POST /api/finance/statements/[id]`; `GET,POST /api/company-finance`; `GET,POST /api/personal-finance`; `GET,POST /api/payments`; `POST /api/cash-shifts/[id]/close` |
| Payroll | `GET,POST /api/payroll`; `GET,POST /api/payroll/self` |
| Partners | `GET,POST /api/partners`; `GET,PATCH,DELETE /api/partners/[id]`; `POST /api/partners/payments`; `GET /api/partner/dashboard`; `GET,PATCH /api/partner/profile`; `GET,POST /api/partner-management`; `GET /api/partner-management/[id]`; `GET /api/partner-management/[id]/statement` |
| Production/warehouse | `GET,POST,PATCH,DELETE /api/production`; `GET,POST,PATCH,DELETE /api/warehouse`; `GET /api/warehouse/[id]`; `GET,POST /api/warehouse/[id]/photo`; `GET,POST /api/purchase-batches`; `GET,POST /api/purchase-batches/[id]`; `GET,POST /api/suppliers` |
| Marketing/approvals | `GET,POST,PATCH,DELETE /api/marketing`; `GET,POST /api/price-approvals`; `PATCH /api/price-approvals/[id]`; `POST /api/price-approvals/[id]/apply` |
| Settings | `GET,PATCH /api/settings`; `POST /api/settings/materials`; `PATCH,DELETE /api/settings/materials/[id]` |
| Training | `GET /api/training`; `POST /api/training/acknowledge`; `POST /api/training/assignments/[id]/override`; `POST /api/training/attempts`; `POST /api/training/attempts/[id]/submit`; `POST /api/training/heartbeat`; `GET /api/training/report` |
| Receipt verification | `GET /api/verify/payment-receipt/[token]` |

## Background requests and timers

| Area | Timer/request | Audit result |
|---|---|---|
| Mandatory manager contacts | Initial zero-delay check plus 60-second polling | Fixed: full-screen only before first completed check; single-flight; later error is non-blocking; overlay preserves route tree |
| Header clock | 60-second local clock update | No request and no route replacement |
| Training | 7-second heartbeat while an active attempt is running | Scoped to training workspace; cleanup exists |
| Search/filter debounce | 120–300 ms in orders, production, measurements, documents and finance | Scoped request debounce; cleanup exists |
| Component initial loads | Zero-delay effect scheduling across cards/workspaces | Scoped to the owning component; no global route replacement found |
| Retry backoff | 25 ms transactional retry in order and warehouse services | Bounded retry count; no UI remount |

## Verification matrix

| Section | Route | Role | Checked element or action | Expected result | Actual result | Automated test | Status |
|---|---|---|---|---|---|---|---|
| Mandatory contacts | Global route shell + `/api/clients/follow-up-gate` | MANAGER | Initial check, repeated polling, slow response, failure, mandatory-item overlay | Only the initial check may block; route remains mounted afterward; no duplicate request | State contract and single-flight regression pass; implementation renders children before non-blocking error/overlay | `test:order-form-regression`; authenticated Playwright spec added | PASS (local unit/static); authenticated E2E pending DB access |
| New order draft | `/orders/new` | MANAGER / leadership | Fill, unmount/reload/back-forward, restore, per-user separation | All entered fields and selected existing client return for the same user only | Storage round-trip, isolation, corruption tolerance and clearing contracts pass | `test:order-form-regression`; authenticated Playwright spec added | PASS (local unit); authenticated E2E pending DB access |
| Order submission | `POST /api/orders` | MANAGER / leadership | Double submit, network retry, HTTP 400/401/403/409/500, successful create | One in-flight request; same key for unchanged retry; data retained; draft cleared only on success | Client guard and stable payload-bound key implemented; server transaction already replays the unique order event | `test:order-form-regression`, `test:idempotency`, authenticated Playwright spec | PASS (local client contract); DB integration pending DB access |
| Validation | `/orders/new`, `POST /api/orders` | MANAGER / leadership | Required fields, payment > amount, invalid payload | Clear error without deleting fields | Native/custom/API paths retain form and persisted draft | `test:order-ux`, authenticated Playwright spec | PASS (static); authenticated E2E pending DB access |
| Authentication boundary | `/orders/new`, order/follow-up APIs | Public | Direct page/API access | Redirect page to login; API returns 401 | Confirmed on staging for desktop and mobile | `test:e2e:public` | PASS |
| Login responsive UI | `/login` | Public | Inputs, disabled submit, mobile/desktop overflow, application console errors | Usable at desktop/mobile with no application console/page errors | Confirmed on staging at Desktop Chrome and Pixel 5 viewports; Vercel's injected Preview Toolbar CSP warning is tracked separately | `test:e2e:public`, `test:auth-mobile` | PASS |
| Clients/CRM | `/clients*`, `/crm`, client APIs | MANAGER / operations | CRUD, filters, ownership, stages, proposals and follow-ups | Role-scoped actions and server enforcement | Source/API contracts pass | `test:clients`, `test:sales-funnel`, `test:proposal-pipeline`, `test:recurring-followup`, `test:role-acceptance` | PASS static; DB suites pending DB access |
| Orders | `/orders*`, order APIs | Role-scoped | List filters, kanban, details, finance redaction, CRUD | Correct role visibility and lifecycle behavior | Domain/static contracts pass; build includes all routes | `test:orders-module`, `test:order-ux`, `test:order360`, `test:manager-orders`, `test:order-soft-delete` | PASS static; DB suites pending DB access |
| Calendar/measurements | `/calendar`, `/measurements` | Manager/measurer/operations | CRUD, statuses, search, responsive contracts | Correct timezone, permission and lifecycle behavior | Static contracts pass | `test:calendar`, `test:measurements`, `test:application-lifecycle` | PASS static; DB suites pending DB access |
| Documents/contracts | `/documents*`, printable order routes | Permission-scoped | Create/update/version/sign/download/generate | Role-safe document lifecycle | Static contract generation and route build pass | `test:contracts`, `test:contract-package`, `test:documents` | PASS static; DB suites pending DB access |
| Production/warehouse | `/production`, `/warehouse` | Operations/production/installer | Filters, CRUD, stock movement, photos, batches | Correct domain and role boundaries | Static/domain suites pass | `test:production:domain`, `test:production:kanban`, `test:warehouse` | PASS static; DB suites pending DB access |
| Finance/payroll | Finance and payroll routes/APIs | Director/accountant/self | Journal, recurring, reconciliation, payroll boundaries | Totals and authorization remain correct | Financial/domain/static suites pass | `test:financial-model`, `test:finance-integrity`, `test:payroll`, related suites | PASS static; DB suites pending DB access |
| Partners | `/partner*`, partner APIs | Partner/leadership | Workspace, settlements, redaction and statements | Role isolation and exact calculations | Calculation and existing static/E2E contracts compile | `test:partner-management:unit`, Playwright partner spec | PASS unit/static; authenticated E2E pending DB access |
| Training | `/training`, training APIs | Measurer/leadership | Assignment, attempt, heartbeat and report | Correct progress/security/mobile behavior | Contract suite passes | `test:training:contract`, `test:training` | PASS static; DB suite pending DB access |
| Route/role acceptance | All protected pages | All 10 roles | Navigation visibility and direct-route/API boundaries | Only permitted UI/routes/actions are exposed | Role acceptance and tenant/static safety suites pass | `test:role-acceptance`, `test:tenant-safety`, `test:commercial-boundary` | PASS (static contracts) |
| Production build | All 40 pages and 112 API routes | N/A | Next production compilation/type generation | Build completes and emits every route | 80 static/data pages generated; build successful | `npm run build` | PASS |
| Health | `/api/health` | Public | Database health | HTTP 200, `{status:"ok",database:"ok"}` | Confirmed on current staging | `test:e2e:public` | PASS |

## Executed checks

| Check | Result |
|---|---|
| `npm ci` | PASS, 0 vulnerabilities at install time |
| `npm run prisma:generate` | PASS |
| `npx prisma validate` | PASS |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| 21 database-free project suites, including the new order regression | PASS |
| `npm audit --omit=dev` and `npm audit` | PASS, 0 vulnerabilities |
| `npm run build` | PASS |
| `npm run test:e2e:public` | PASS, desktop + mobile |
| Authenticated Playwright suite | Added; local execution requires `TEST_DATABASE_URL` |
| Database mutation/integration suites | Not executed locally: Vercel exposes encrypted values as redacted and no `TEST_DATABASE_URL` is available in the workspace |
| `git diff --check` | PASS before report generation; repeated in final gate |

## Access limitation

The authenticated and mutation suites deliberately refuse to use `DATABASE_URL`; they require a separate `TEST_DATABASE_URL`. The connected Vercel project lists encrypted Preview variables but returns their values redacted/empty to the local process, and no test database credential is present in the workspace. The required owner action, if CI secrets are also absent, is to provide a dedicated non-production PostgreSQL URL as the repository secret `TEST_DATABASE_URL` (with `NEXTAUTH_SECRET_TEST`) or as local `TEST_DATABASE_URL`. Production database credentials must not be used.

The public alias points to a Preview deployment because the project has no custom `staging` environment and the repository forbids a `--prod` deployment. Vercel injects its Preview Toolbar script on that alias; the application's CSP blocks it and Vercel emits one browser-console CSP warning. The smoke test allowlists only that exact platform URL/message and still fails on every application console error, page error, or HTTP 5xx.
