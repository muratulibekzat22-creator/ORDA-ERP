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
  page.on("response", (response) => { if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`); });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, playwrightUsers.director);
  await page.goto("/partner-management");
  await expect(page.getByRole("heading", { name: "Партнёры", exact: true })).toBeVisible();
  for (const label of ["Обзор", "Партнёры", "Заказы партнёров", "Взаиморасчёты", "Операции", "Отчёты"])
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  const api = await page.request.get("/api/partner-management");
  expect(api.status()).toBe(200);
  const payload = await api.json() as { partners: Array<{ id: number }> };
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
  expect(browserErrors).toEqual([]); expect(failedResponses).toEqual([]);
});

for (const [role, email] of [["MANAGER", playwrightUsers.manager], ["ACCOUNTANT", playwrightUsers.accountant]] as const) {
  test(`${role} receives 403 and cannot open direct route`, async ({ page }) => {
    await login(page, email);
    const api = await page.request.get("/api/partner-management");
    expect(api.status()).toBe(403);
    await page.goto("/partner-management");
    await expect(page.getByRole("heading", { name: "Партнёры", exact: true })).toHaveCount(0);
    await expect(page.getByText("404")).toBeVisible();
  });
}
