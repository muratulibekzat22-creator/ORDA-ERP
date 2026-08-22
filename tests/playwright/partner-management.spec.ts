import { expect, test, type Page } from "@playwright/test";

import { playwrightPassword, playwrightUsers } from "./partner-management.setup";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.locator('input[name="password"]').fill(playwrightPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
}

test("DIRECTOR sees shared partner workspace without mobile overflow or browser errors", async ({ page }) => {
  const browserErrors: string[] = []; const failedResponses: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`); });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, playwrightUsers.director);
  await page.goto("/partner-management");
  await expect(page.getByRole("heading", { name: "Партнёры", exact: true })).toBeVisible();
  for (const label of ["Обзор", "Партнёры", "Заказы", "Взаиморасчёты", "Выплаты", "Отчёты"])
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  const api = await page.request.get("/api/partner-management?pageSize=100&scope=active");
  expect(api.status()).toBe(200);
  const payload = await api.json() as { partners: Array<{ id: number }>; counts: { active: number }; orders: Array<{ order: { id: number } }> };
  expect(payload.orders).toHaveLength(payload.counts.active);
  for (const chart of ["Продажи и клиентские оплаты", "Начислено и выплачено партнёрам", "Остатки клиентов и долги партнёрам", "Чистая прибыль по месяцам", "Чистая маржа по месяцам", "Прибыль по партнёрам", "Количество заказов по партнёрам", "Структура расходов партнёрских заказов"])
    await expect(page.getByRole("heading", { name: chart, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Заказы", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Канонические заказы", exact: true })).toBeVisible();
  if (payload.partners[0]) {
    const detail = await page.request.get(`/api/partner-management/${payload.partners[0].id}`);
    expect(detail.status()).toBe(200);
    const statement = await page.request.get(`/api/partner-management/${payload.partners[0].id}/statement?format=pdf`);
    expect(statement.status()).toBe(200);
    expect(statement.headers()["content-type"]).toContain("application/pdf");
    expect((await statement.body()).subarray(0, 5).toString("ascii")).toBe("%PDF-");
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "Заказы", exact: true })).toBeVisible();
  await expect(page.getByText("Быстрые фильтры", { exact: true })).toBeVisible();
  await expect(page.getByText("Этап производства", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Финансы и проблемы", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const ordersResponse = await page.request.get("/api/orders?limit=10");
  expect(ordersResponse.status()).toBe(200);
  const ordersPayload = await ordersResponse.json() as {
    data: Array<{ id: number; balance: string | number; partnerBalance: string | number }>;
    filterMetrics: Record<string, { count: number; amount: string }>;
  };
  for (const [filter, field] of [["client-payable", "balance"], ["partner-payable", "partnerBalance"]] as const) {
    const filteredResponse = await page.request.get(`/api/orders?limit=100&filter=${filter}`);
    expect(filteredResponse.status()).toBe(200);
    const filtered = await filteredResponse.json() as {
      data: Array<{ balance: string | number; partnerBalance: string | number }>;
      pagination: { total: number };
    };
    expect(filtered.pagination.total).toBe(ordersPayload.filterMetrics[filter].count);
    expect(filtered.data.reduce((sum, item) => sum + Number(item[field]), 0)).toBeCloseTo(Number(ordersPayload.filterMetrics[filter].amount), 2);
  }
  if (ordersPayload.data[0]) {
    await page.goto(`/orders/${ordersPayload.data[0].id}`);
    await expect(page.getByRole("heading", { name: "Прибыль компании", exact: true, level: 2 })).toBeVisible();
    for (const label of ["Сумма продажи", "Получено от клиента", "Остаток клиента", "Согласованная стоимость", "Выплачено партнёру", "Осталось выплатить", "Маржа до зарплаты", "Всего начислено по заказу", "Прибыль заказа", "Чистая маржа заказа"])
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("NOT_ASSIGNED", { exact: true })).toHaveCount(0);
    await expect(page.getByText("−0 ₸", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "История и полный расчёт", exact: true }).first().click();
    await expect(page.getByRole("dialog", { name: "История и полный расчёт цеха", exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/orders/${ordersPayload.data[0].id}$`));
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/orders");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect({ browserErrors, failedResponses }).toEqual({ browserErrors: [], failedResponses: [] });
});

for (const [role, email] of [["MANAGER", playwrightUsers.manager], ["ACCOUNTANT", playwrightUsers.accountant]] as const) {
  test(`${role} receives 403 and cannot open direct route`, async ({ page }) => {
    await login(page, email);
    const api = await page.request.get("/api/partner-management");
    expect(api.status()).toBe(403);
    await page.goto("/partner-management");
    await expect(page.getByRole("heading", { name: "Партнёры", exact: true })).toHaveCount(0);
    await expect(page.getByText("403")).toBeVisible();
    await page.goto("/orders");
    await expect(page.getByRole("link", { name: "Партнёры", exact: true })).toHaveCount(0);
    if (role === "MANAGER") {
      const orders = await page.request.get("/api/orders?limit=10");
      expect(orders.status()).toBe(200);
      const body = await orders.text();
      expect(body).not.toContain("companyProfit");
      expect(body).not.toContain("partnerBalance");
      expect(body).not.toContain("partnerPrice");
      expect(body).not.toContain("netProfit");
    }
  });
}
