import { expect, test, type Page } from "@playwright/test";

import { prisma } from "@/lib/prisma";
import { runWithSystemAccess } from "@/lib/tenant-context";

import {
  playwrightPassword,
  playwrightUsers,
} from "./partner-management.setup";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.locator('input[name="password"]').fill(playwrightPassword);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });
}

test.describe.serial("OPERATIONS_DIRECTOR access", () => {
  test("opens the operational workspace on desktop and mobile without browser or network errors", async ({ page }) => {
    const browserErrors: string[] = [];
    const unexpectedResponses: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        unexpectedResponses.push(`${response.status()} ${response.url()}`);
    });

    await login(page, playwrightUsers.operations);
    await expect(page).toHaveURL(/\/operations$/u);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/operations");
      await expect(
        page.getByRole("heading", { name: "Операционное управление", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("tab", { name: "Проект ORDA" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "ALTYN SAPA" })).toBeVisible();
      await page.getByRole("tab", { name: "ALTYN SAPA" }).click();
      await expect(page.getByText("Экономика и P&L · только чтение")).toBeVisible();
      await expect(page.getByText("Payroll · только агрегаты")).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }

    for (const href of [
      "/api/operations",
      "/api/clients?limit=1",
      "/api/orders?limit=1",
      "/api/measurements?limit=1",
      "/api/calendar?limit=1",
      "/api/production?limit=1",
      "/api/warehouse?pageSize=1&materialPageSize=1",
      "/api/marketing",
      "/api/reports",
      "/api/documents?limit=1",
      "/api/partner-management?pageSize=1",
    ]) {
      const response = await page.request.get(href);
      expect(response.status(), href).toBe(200);
    }
    const operations = (await (
      await page.request.get("/api/operations")
    ).json()) as {
      company: {
        payroll: Record<string, unknown>;
        finance: Record<string, unknown>;
      };
    };
    expect(Object.keys(operations.company.payroll).sort()).toEqual(
      ["companyDebt", "orderAccrued", "pendingOrderAccruals"].sort(),
    );
    expect(Object.keys(operations.company.finance)).toEqual(
      expect.arrayContaining(["sales", "grossMargin", "netProfit"]),
    );
    expect(browserErrors).toEqual([]);
    expect(unexpectedResponses).toEqual([]);
  });

  test("has read-only partner control and receives 403 from prohibited mutations", async ({ page }) => {
    await login(page, playwrightUsers.operations);
    await page.goto("/partner-management");
    await expect(page.getByRole("heading", { name: "Партнёры", exact: true })).toBeVisible();
    await expect(page.getByText("Operational read-only", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Создать заказ" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Выплатить/u })).toHaveCount(0);

    const forbiddenRequests = [
      page.request.post("/api/finance", { data: {} }),
      page.request.post("/api/payroll", { data: {} }),
      page.request.post("/api/employees", { data: {} }),
      page.request.post("/api/employees/1/password", {
        data: { newPassword: "ForbiddenPassword!1", confirmPassword: "ForbiddenPassword!1" },
      }),
      page.request.patch("/api/settings", { data: {} }),
      page.request.post("/api/partner-management", { data: {} }),
      page.request.post("/api/marketing", { data: {} }),
      page.request.post("/api/documents", { data: {} }),
      page.request.post("/api/orders", { data: {} }),
    ];
    for (const response of await Promise.all(forbiddenRequests))
      expect(response.status()).toBe(403);

    for (const path of ["/finance", "/payroll", "/employees", "/settings"] ) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/operations$/u);
    }
  });

  test("disabled company scope disappears from navigation and API", async ({ page }) => {
    await login(page, playwrightUsers.operationsScopedOff);
    await expect(page).toHaveURL(/\/operations$/u);
    await expect(page.getByRole("tab", { name: "Проект ORDA" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "ALTYN SAPA" })).toHaveCount(0);
    for (const name of ["Заявки", "Заказы", "Замеры", "Маркетинг", "Календарь", "Производство", "Склад", "Партнёры", "Отчёты", "Документы"])
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
    const response = await page.request.get("/api/clients");
    expect(response.status()).toBe(403);
    expect((await response.json()).code).toBe("OPERATIONAL_SCOPE_DISABLED");
  });

  test("expired and revoked temporary access cannot log in", async ({ page }) => {
    for (const [email, message] of [
      [
        playwrightUsers.operationsExpired,
        "Срок временного операционного доступа истёк. Обратитесь к директору.",
      ],
      [
        playwrightUsers.operationsRevoked,
        "Операционный доступ отключён директором.",
      ],
    ] as const) {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.locator('input[name="password"]').fill(playwrightPassword);
      await page.getByRole("button", { name: "Войти" }).click();
      await expect(page).toHaveURL(/\/login/u);
      await expect(
        page.getByRole("alert").filter({ hasText: message }),
      ).toContainText(message);
    }
  });

  test("revocation invalidates an existing JWT session", async ({ page }) => {
    await login(page, playwrightUsers.operations);
    const before = await runWithSystemAccess(() =>
      prisma.user.findUniqueOrThrow({
        where: { email: playwrightUsers.operations },
        select: {
          active: true,
          accessRevokedAt: true,
          revokeReason: true,
          sessionVersion: true,
          ordaProjectOperationsEnabled: true,
          companyOperationsEnabled: true,
        },
      }),
    );
    try {
      await runWithSystemAccess(() =>
        prisma.user.update({
          where: { email: playwrightUsers.operations },
          data: {
            active: false,
            accessRevokedAt: new Date(),
            revokeReason: "Playwright session invalidation",
            ordaProjectOperationsEnabled: false,
            companyOperationsEnabled: false,
            sessionVersion: { increment: 1 },
          },
        }),
      );
      const response = await page.request.get("/api/operations");
      expect(response.status()).toBe(401);
      await page.goto("/operations");
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/u);
    } finally {
      await runWithSystemAccess(() =>
        prisma.user.update({
          where: { email: playwrightUsers.operations },
          data: before,
        }),
      );
      await prisma.$disconnect();
    }
  });
});
