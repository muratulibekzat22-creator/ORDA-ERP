import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ProductionKanban, { type ProductionKanbanItem } from "../components/production/ProductionKanban";
import { distributeProductions, EMPTY_PRODUCTION_FILTERS, filterProductions, isProductionOverdue, optimisticProductionMove } from "../lib/production/kanban";
import { PRODUCTION_STAGES } from "../lib/production/stage-policy";

const base: ProductionKanbanItem = {
  id: 1,
  stage: "Подготовка",
  percent: 0,
  master: "Мастер",
  masterUserId: 10,
  priority: 3,
  plannedStartAt: "2026-08-01T00:00:00.000Z",
  plannedEndAt: "2026-08-02T00:00:00.000Z",
  actualEndAt: null,
  completedAt: null,
  comment: "Проверить размеры",
  order: { id: 5, number: "ORD-TEST", address: "Алматы", material: "Дуб", client: { name: "Тестовый клиент" } },
  stageHistory: [{ id: 1, fromStage: null, toStage: "Подготовка", comment: "Старт", createdAt: "2026-08-01T00:00:00.000Z", changedBy: { id: 7, name: "Директор" } }],
};
const second: ProductionKanbanItem = { ...base, id: 2, stage: "Монтаж", priority: 1, masterUserId: 20, master: "Монтажник", order: { ...base.order, id: 6, number: "ORD-MOUNT", client: { name: "Другой клиент" } }, plannedEndAt: null };
const items = [base, second];

const distributed = distributeProductions(items);
assert.equal(distributed["Подготовка"].length, 1);
assert.equal(distributed["Монтаж"].length, 1);
assert.equal(PRODUCTION_STAGES.every((stage) => Array.isArray(distributed[stage])), true);
assert.equal(filterProductions(items, { ...EMPTY_PRODUCTION_FILTERS, query: "ord-test" }).length, 1);
assert.equal(filterProductions(items, { ...EMPTY_PRODUCTION_FILTERS, stage: "Монтаж" }).length, 1);
assert.equal(filterProductions(items, { ...EMPTY_PRODUCTION_FILTERS, assigneeId: 10 }).length, 1);
assert.equal(filterProductions(items, { ...EMPTY_PRODUCTION_FILTERS, priority: 3 }).length, 1);
assert.equal(filterProductions(items, { ...EMPTY_PRODUCTION_FILTERS, overdueOnly: true }, new Date("2026-08-05T00:00:00.000Z")).length, 1);
assert.equal(isProductionOverdue(base, new Date("2026-08-05T00:00:00.000Z")), true);

const optimistic = optimisticProductionMove(items, 1, "Каркас");
assert.equal(optimistic[0].stage, "Каркас");
const rolledBack = items;
assert.equal(rolledBack[0].stage, "Подготовка");

const html = renderToStaticMarkup(createElement(ProductionKanban, { columns: distributed, savingIds: new Set<number>(), onDropCard: () => undefined }));
assert.match(html, /ORD-TEST/);
assert.match(html, /Проверить размеры/);
assert.match(html, /Создание → Подготовка/);
assert.match(html, /Директор/);
assert.match(html, /Нет заказов/);
console.log("production Kanban UI checks passed");
