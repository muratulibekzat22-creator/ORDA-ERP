import { expect, test, type Page } from "@playwright/test";

import { playwrightPassword, playwrightUsers } from "./partner-management.setup";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.locator('input[name="password"]').fill(playwrightPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });
}

for (const [role, email] of [["DIRECTOR", playwrightUsers.director], ["MARKETER", playwrightUsers.marketer]] as const) {
  test(`${role} opens the shared Marketing workspace at desktop and mobile sizes`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await login(page, email);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/marketing");
      await expect(page.getByRole("heading", { name: "Маркетинг", exact: true })).toBeVisible();
      for (const label of ["Обзор", "Входящие", "Заявки", "Кампании", "Каналы", "Расходы и показатели", "Воронка", "Атрибуция", "Бюджет", "Отчёты", "Отзывы и контент"])
        await expect(page.getByRole("tab", { name: label, exact: true })).toBeVisible();
      await page.getByRole("tab", { name: "Отзывы и контент", exact: true }).click();
      await expect(page.getByRole("heading", { name: /PW-CONTENT-ORDER/u })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
    const response = await page.request.get("/api/marketing");
    expect(response.status()).toBe(200);
    const payload = await response.json() as { campaigns: Array<{ name: string }>; overview: { clicks: number } };
    expect(payload.campaigns.some((item) => item.name === "Playwright Campaign")).toBe(true);
    expect(payload.overview.clicks).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}

test("MANAGER receives 403 from Marketing and cannot open its route", async ({ page }) => {
  await login(page, playwrightUsers.manager);
  expect((await page.request.get("/api/marketing")).status()).toBe(403);
  await page.goto("/marketing");
  await expect(page.getByRole("heading", { name: "Маркетинг", exact: true })).toHaveCount(0);
  await expect(page.getByText("Доступ запрещён", { exact: true })).toBeVisible();
});
