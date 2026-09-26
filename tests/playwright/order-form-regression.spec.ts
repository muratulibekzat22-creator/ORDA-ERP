import { expect, test, type Page, type Route } from "@playwright/test";

import { playwrightPassword, playwrightUsers } from "./partner-management.setup";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(playwrightUsers.manager);
  await page.locator('input[name="password"]').fill(playwrightPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
}

test("new order survives polling, failures, reload and duplicate submission", async ({ page }) => {
  let followUpMode: "empty" | "pending" | "item" = "empty";
  let pendingFollowUp: Route | null = null;
  await page.route("**/api/clients/follow-up-gate", async (route) => {
    if (followUpMode === "pending") {
      pendingFollowUp = route;
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        blocked: followUpMode === "item",
        items: followUpMode === "item" ? [{
          id: 7001,
          clientId: 8001,
          nextActionAt: new Date(0).toISOString(),
          followUpStep: 1,
          nextActionComment: null,
          message: "Synthetic follow-up",
          client: { name: "Synthetic Follow-up", phone: "+77000000001", whatsapp: "+77000000001" },
          proposal: { id: 9001, number: "TEST-9001" },
        }] : [],
      }),
    });
  });

  await login(page);
  const userId = await page.evaluate(async () => {
    const session = await fetch("/api/auth/session").then((response) => response.json()) as { user: { id: string } };
    return Number(session.user.id);
  });
  await page.clock.install();
  await page.goto("/orders/new");

  const clientName = page.getByLabel("Клиент *", { exact: true });
  const phone = page.getByLabel("Телефон *", { exact: true });
  const location = page.getByLabel("Город / адрес *", { exact: true });
  const amount = page.getByLabel("Цена клиенту *", { exact: true });
  await clientName.fill("Synthetic Order Draft");
  await phone.fill(`+7700${Date.now().toString().slice(-7)}`);
  await location.fill("Кызылорда, тестовый адрес");
  await amount.fill("125000");

  followUpMode = "pending";
  await page.clock.fastForward(60_000);
  await expect.poll(() => pendingFollowUp !== null).toBe(true);
  await expect(clientName).toHaveValue("Synthetic Order Draft");
  await expect(page.getByRole("heading", { name: "Новый заказ" })).toBeVisible();

  followUpMode = "item";
  await pendingFollowUp!.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      blocked: true,
      items: [{
        id: 7001,
        clientId: 8001,
        nextActionAt: new Date(0).toISOString(),
        followUpStep: 1,
        nextActionComment: null,
        message: "Synthetic follow-up",
        client: { name: "Synthetic Follow-up", phone: "+77000000001", whatsapp: "+77000000001" },
        proposal: { id: 9001, number: "TEST-9001" },
      }],
    }),
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(clientName).toHaveValue("Synthetic Order Draft");

  followUpMode = "empty";
  await page.reload();
  await page.clock.runFor(1);
  await expect(clientName).toHaveValue("Synthetic Order Draft");
  await page.goto("/orders");
  await page.goBack();
  await expect(clientName).toHaveValue("Synthetic Order Draft");

  let pendingOrder: Route | null = null;
  const responseStatuses = [400, 401, 403, 409, 500];
  const requestKeys: string[] = [];
  let postCount = 0;
  await page.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    postCount += 1;
    requestKeys.push(route.request().headers()["idempotency-key"] ?? "");
    if (postCount === 1) {
      pendingOrder = route;
      return;
    }
    const status = responseStatuses.shift();
    if (status) {
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: `Synthetic HTTP ${status}` }) });
      return;
    }
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: 987654 }) });
  });

  await page.locator("form").evaluate((form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect.poll(() => postCount).toBe(1);
  await expect.poll(() => pendingOrder !== null).toBe(true);
  await expect(clientName).toHaveValue("Synthetic Order Draft");
  await pendingOrder!.abort("failed");
  const formAlert = page.locator('p[role="alert"]');
  await expect(formAlert).toBeVisible();

  for (const status of [400, 401, 403, 409, 500]) {
    await page.getByRole("button", { name: "Создать заказ" }).click();
    await expect(formAlert).toContainText(`Synthetic HTTP ${status}`);
    await expect(clientName).toHaveValue("Synthetic Order Draft");
  }

  await page.getByRole("button", { name: "Создать заказ" }).click();
  await page.waitForURL((url) => url.pathname === "/orders/987654");
  expect(new Set(requestKeys).size).toBe(1);
  expect(requestKeys[0]).not.toBe("");
  expect(await page.evaluate((id) => localStorage.getItem(`orda:new-order-draft:v1:${id}`), userId)).toBeNull();
});
