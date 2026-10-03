import { expect, test } from "@playwright/test";

test("public health, authentication boundary and login UI are healthy", async ({ page, request }) => {
  const browserErrors: string[] = [];
  const platformWarnings: string[] = [];
  const failedResponses: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("https://vercel.live/_next-live/feedback/feedback.js") && text.includes("Content Security Policy"))
      platformWarnings.push(text);
    else
      browserErrors.push(text);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok", database: "ok" });

  for (const path of ["/api/orders", "/api/clients/follow-up-gate"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
  }

  await page.goto("/orders/new");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Forders%2Fnew/);
  await expect(page.getByRole("heading", { name: "ORDA ERP" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Пароль", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Войти" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect({ browserErrors, failedResponses }).toEqual({ browserErrors: [], failedResponses: [] });
  expect(platformWarnings.length).toBeLessThanOrEqual(1);
});
