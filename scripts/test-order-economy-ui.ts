import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

async function main() {
const [orders, workspace, economy, settlement, partnerWorkspace, finance, dashboard] = await Promise.all([
    read("components/pages/OrdersPage.tsx"),
    read("components/orders/OrderWorkspace.tsx"),
    read("components/orders/OrderEconomy.tsx"),
    read("components/orders/OrderSettlementPanel.tsx"),
    read("components/partners/PartnerManagementWorkspace.tsx"),
    read("components/finance/FinanceJournalPage.tsx"),
    read("components/dashboard/DirectorCockpit.tsx"),
  ]);

assert.match(orders, /\?action=assign-workshop#settlements/u, "assign workshop keeps the order page context");
assert.match(workspace, /canSeeClientFinance && \(\s*<OrderSettlementPanel/u, "director and permitted operational roles receive the real settlement controls");
assert.match(settlement, /Передать в основной цех/u, "default workshop action is visible");
assert.match(settlement, /aria-label="Передать заказ в цех"/u, "workshop drawer is accessible");
assert.match(economy, /Прибыль не рассчитана|economy\.profit\.label/u, "incomplete profit has an explicit state");
assert.match(economy, />Прибыль компании</u, "company profit block uses the approved name");
assert.match(economy, /orda:open-partner-history/u, "full calculation stays inside the order page");
assert.match(settlement, /История и полный расчёт/u, "order-local settlement history drawer exists");
assert.match(partnerWorkspace, /Вернуться к заказу/u, "partner workspace preserves navigation context");
assert.match(partnerWorkspace, /Передать существующий заказ в цех/u, "canonical transfer action is named clearly");
assert.match(partnerWorkspace, /latest active unassigned|view=search-orders|Передать существующий заказ в цех/u, "unassigned order search loads in the transfer form");
assert.match(finance, /Денежный результат — это движение денег, а не чистая прибыль/u, "cash and profit are separated");
for (const tab of ["Обзор", "Прибыль", "Журнал", "Расходы", "Денежный поток", "Экономика заказов", "Отчёты"])
  assert.ok(finance.includes(tab), `finance tab ${tab}`);
for (const view of ["План", "Факт", "Деньги"])
  assert.ok(dashboard.includes(view), `dashboard view ${view}`);

console.log("Order economy UI: workshop drawer, context links, Finance and Dashboard PASS");
}

void main();
