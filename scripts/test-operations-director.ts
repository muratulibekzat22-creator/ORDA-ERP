import "./require-test-database";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import bcrypt from "bcrypt";
import {
  CalendarTaskPriority,
  CalendarTaskStatus,
  CalendarTaskType,
  OperationalAccessAuditAction,
  OperationalScope,
  OperationalWorkItemPriority,
  OperationalWorkItemStatus,
  Role,
} from "@prisma/client";

import {
  operationalAccessFailure,
  OPERATIONS_DIRECTOR_EMAIL,
  OPERATIONS_DIRECTOR_NAME,
} from "@/lib/operations/access";
import { defaultPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  createOperationalWorkItem,
  extendOperationsDirectorAccess,
  getOperationsDashboard,
  grantOperationsDirectorAccess,
  OperationsError,
  revokeOperationsDirectorAccess,
  setOperationsScope,
  updateOperationalWorkItem,
} from "@/lib/services/operations.service";
import {
  runWithSystemAccess,
  runWithTenant,
  type TenantIdentity,
} from "@/lib/tenant-context";

const live: TenantIdentity = {
  companyId: 1,
  companySlug: "altyn-sapa-company",
  companyName: "ТОО ALTYN SAPA COMPANY",
  isDemo: false,
};
const demo: TenantIdentity = {
  companyId: 2,
  companySlug: "orda-demo",
  companyName: "ORDA DEMO",
  isDemo: true,
};
const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const targetRestoreSelect = {
  id: true,
  companyId: true,
  name: true,
  email: true,
  password: true,
  role: true,
  active: true,
  temporaryAccess: true,
  accessExpiresAt: true,
  accessRevokedAt: true,
  revokedById: true,
  revokeReason: true,
  ordaProjectOperationsEnabled: true,
  companyOperationsEnabled: true,
  mustChangePassword: true,
  passwordChangedAt: true,
  failedLoginAttempts: true,
  lockedUntil: true,
  sessionVersion: true,
} as const;

async function main() {
  assert.deepEqual(
    [...defaultPermissions.OPERATIONS_DIRECTOR].sort(),
    [
      "calendar",
      "clients",
      "documents",
      "marketing",
      "measurements",
      "operations",
      "orders",
      "partners",
      "production",
      "reports",
      "warehouse",
    ].sort(),
  );
  for (const forbidden of ["finance", "payroll", "employees", "settings"])
    assert.equal(
      defaultPermissions.OPERATIONS_DIRECTOR.includes(
        forbidden as (typeof defaultPermissions.OPERATIONS_DIRECTOR)[number],
      ),
      false,
      `${forbidden} must not be granted to OPERATIONS_DIRECTOR`,
    );

  const now = new Date("2026-08-31T00:00:00.000Z");
  const activeState = {
    role: Role.OPERATIONS_DIRECTOR,
    active: true,
    temporaryAccess: true,
    accessExpiresAt: new Date("2026-09-30T00:00:00.000Z"),
    accessRevokedAt: null,
  };
  assert.equal(operationalAccessFailure(activeState, now), null);
  assert.equal(
    operationalAccessFailure(
      { ...activeState, accessExpiresAt: new Date("2026-08-30T00:00:00.000Z") },
      now,
    ),
    "TEMPORARY_ACCESS_EXPIRED",
  );
  assert.equal(
    operationalAccessFailure({ ...activeState, active: false, accessRevokedAt: now }, now),
    "OPERATIONAL_ACCESS_REVOKED",
  );

  const serverAuth = readFileSync("lib/server-auth.ts", "utf8");
  assert.match(serverAuth, /permission !== "operations"/);
  assert.match(serverAuth, /companyOperationsEnabled !== true/);
  for (const secret of ["DATABASE_URL", "DIRECT_URL", "VERCEL_TOKEN", "GITHUB_TOKEN"])
    assert.doesNotMatch(
      readFileSync("lib/services/operations.service.ts", "utf8"),
      new RegExp(secret),
    );

  await runWithSystemAccess(async () => {
    await prisma.company.upsert({
      where: { id: live.companyId },
      update: { active: true, isDemo: false },
      create: {
        id: live.companyId,
        slug: live.companySlug,
        name: live.companyName,
        isDemo: false,
      },
    });
    await prisma.company.upsert({
      where: { id: demo.companyId },
      update: { active: true, isDemo: true },
      create: {
        id: demo.companyId,
        slug: demo.companySlug,
        name: demo.companyName,
        isDemo: true,
      },
    });
  });

  let directorId = 0;
  let targetId = 0;
  let targetBefore: Awaited<ReturnType<typeof readTarget>> = null;
  let generatedWorkItemId = 0;
  let generatedCalendarTaskId = 0;
  let initialAuditIds = new Set<number>();
  let priorWorkAssignments: Array<{ id: number; assigneeId: number }> = [];
  let priorCalendarAssignments: Array<{ id: number; assigneeId: number }> = [];

  try {
    await runWithTenant(live, async () => {
      const password = await bcrypt.hash(`Director-${nonce}!`, 8);
      const director = await prisma.user.create({
        data: {
          name: `Operations test director ${nonce}`,
          email: `operations-director-actor-${nonce}@test.local`,
          password,
          role: Role.DIRECTOR,
          active: true,
          mustChangePassword: false,
        },
      });
      directorId = director.id;
      targetBefore = await readTarget();
      if (targetBefore) {
        targetId = targetBefore.id;
        initialAuditIds = new Set(
          (
            await prisma.operationalAccessAuditEvent.findMany({
              where: { targetUserId: targetBefore.id },
              select: { id: true },
            })
          ).map((row) => row.id),
        );
        priorWorkAssignments = await prisma.operationalWorkItem.findMany({
          where: {
            assigneeId: targetBefore.id,
            status: {
              in: [
                OperationalWorkItemStatus.OPEN,
                OperationalWorkItemStatus.IN_PROGRESS,
                OperationalWorkItemStatus.BLOCKED,
              ],
            },
          },
          select: { id: true, assigneeId: true },
        });
        priorCalendarAssignments = await prisma.calendarTask.findMany({
          where: {
            assigneeId: targetBefore.id,
            status: {
              in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS],
            },
          },
          select: { id: true, assigneeId: true },
        });
      }

      const actor = {
        userId: director.id,
        role: Role.DIRECTOR,
        name: director.name,
      };
      const granted = await grantOperationsDirectorAccess(actor);
      targetId = granted.user!.id;
      assert.equal(granted.user!.companyId, 1);
      assert.equal(granted.user!.name, OPERATIONS_DIRECTOR_NAME);
      assert.equal(granted.user!.email, OPERATIONS_DIRECTOR_EMAIL);
      assert.equal(granted.user!.role, Role.OPERATIONS_DIRECTOR);
      assert.equal(granted.user!.active, true);
      assert.equal(granted.user!.temporaryAccess, true);
      assert.equal(granted.user!.ordaProjectOperationsEnabled, true);
      assert.equal(granted.user!.companyOperationsEnabled, true);
      assert.ok(granted.temporaryPassword.length >= 16);
      const persisted = await prisma.user.findUniqueOrThrow({
        where: { id: targetId },
        select: { password: true, accessExpiresAt: true },
      });
      assert.equal(await bcrypt.compare(granted.temporaryPassword, persisted.password), true);
      assert.notEqual(persisted.password, granted.temporaryPassword);
      assert.ok(persisted.accessExpiresAt);

      const workItem = await createOperationalWorkItem(
        {
          userId: targetId,
          role: Role.OPERATIONS_DIRECTOR,
          name: OPERATIONS_DIRECTOR_NAME,
          ordaProjectOperationsEnabled: true,
          companyOperationsEnabled: true,
        },
        {
          scope: OperationalScope.ORDA_PROJECT,
          title: `Preview verification ${nonce}`,
          description: "Проверить Preview и LIVE",
          source: "INTEGRATION_TEST",
          priority: OperationalWorkItemPriority.HIGH,
          assigneeId: targetId,
          previewUrl: "https://preview.example.test/operations",
          productionUrl: "https://live.example.test/operations",
          commitSha: "abc123",
          pullRequestUrl: "https://github.com/example/repo/pull/1",
        },
      );
      generatedWorkItemId = workItem.id;
      assert.equal(workItem.scope, OperationalScope.ORDA_PROJECT);
      await assert.rejects(
        createOperationalWorkItem(
          {
            userId: targetId,
            role: Role.OPERATIONS_DIRECTOR,
            name: OPERATIONS_DIRECTOR_NAME,
            ordaProjectOperationsEnabled: true,
            companyOperationsEnabled: true,
          },
          {
            scope: OperationalScope.ORDA_PROJECT,
            title: "Unsafe URL",
            source: "INTEGRATION_TEST",
            priority: OperationalWorkItemPriority.NORMAL,
            previewUrl: "http://not-private.example.test",
          },
        ),
        (error: unknown) => error instanceof OperationsError && error.message === "INVALID_URL",
      );
      await updateOperationalWorkItem(actor, workItem.id, {
        assigneeId: director.id,
        priority: OperationalWorkItemPriority.CRITICAL,
        status: OperationalWorkItemStatus.IN_PROGRESS,
      });
      await updateOperationalWorkItem(actor, workItem.id, {
        assigneeId: targetId,
        status: OperationalWorkItemStatus.COMPLETED,
        verificationResult: "PASS",
      });
      await updateOperationalWorkItem(actor, workItem.id, {
        status: OperationalWorkItemStatus.COMPLETED,
        verificationResult: "PASS · повторная проверка",
      });
      const approved = await updateOperationalWorkItem(actor, workItem.id, {
        action: "approve-release",
        status: OperationalWorkItemStatus.COMPLETED,
      });
      assert.equal(approved.releaseStatus, "APPROVED");

      const scopeOff = await setOperationsScope(
        actor,
        OperationalScope.ALTYN_SAPA,
        false,
      );
      assert.equal(scopeOff!.companyOperationsEnabled, false);
      const restrictedDashboard = await getOperationsDashboard({
        userId: targetId,
        role: Role.OPERATIONS_DIRECTOR,
        name: OPERATIONS_DIRECTOR_NAME,
        ordaProjectOperationsEnabled: true,
        companyOperationsEnabled: false,
      });
      assert.ok(restrictedDashboard.project);
      assert.equal(restrictedDashboard.company, null);
      await assert.rejects(
        createOperationalWorkItem(
          {
            userId: targetId,
            role: Role.OPERATIONS_DIRECTOR,
            name: OPERATIONS_DIRECTOR_NAME,
            ordaProjectOperationsEnabled: true,
            companyOperationsEnabled: false,
          },
          {
            scope: OperationalScope.ALTYN_SAPA,
            title: "Disabled company scope",
            source: "INTEGRATION_TEST",
            priority: OperationalWorkItemPriority.NORMAL,
          },
        ),
        (error: unknown) => error instanceof OperationsError && error.message === "SCOPE_DISABLED",
      );
      await setOperationsScope(actor, OperationalScope.ALTYN_SAPA, true);
      const extended = await extendOperationsDirectorAccess(actor);
      assert.ok(extended!.accessExpiresAt);

      const calendar = await prisma.calendarTask.create({
        data: {
          title: `Operations assignment ${nonce}`,
          type: CalendarTaskType.OTHER,
          dueAt: new Date(Date.now() + 86_400_000),
          status: CalendarTaskStatus.PLANNED,
          priority: CalendarTaskPriority.URGENT,
          assigneeId: targetId,
          creatorId: director.id,
        },
      });
      generatedCalendarTaskId = calendar.id;
      const openItem = await prisma.operationalWorkItem.update({
        where: { id: workItem.id },
        data: {
          status: OperationalWorkItemStatus.OPEN,
          completedAt: null,
          assigneeId: targetId,
        },
      });
      assert.equal(openItem.assigneeId, targetId);

      const revoked = await revokeOperationsDirectorAccess(
        actor,
        "Проверка безопасного отключения на TEST clone",
      );
      assert.equal(revoked.user!.active, false);
      assert.equal(revoked.user!.companyOperationsEnabled, false);
      assert.equal(revoked.user!.ordaProjectOperationsEnabled, false);
      assert.ok(revoked.reassignedWorkItems >= 1);
      assert.ok(revoked.reassignedCalendarTasks >= 1);
      assert.equal(
        (
          await prisma.operationalWorkItem.findUniqueOrThrow({
            where: { id: workItem.id },
            select: { assigneeId: true },
          })
        ).assigneeId,
        director.id,
      );
      assert.equal(
        (
          await prisma.calendarTask.findUniqueOrThrow({
            where: { id: calendar.id },
            select: { assigneeId: true },
          })
        ).assigneeId,
        director.id,
      );
      const actions = new Set(
        (
          await prisma.operationalAccessAuditEvent.findMany({
            where: { targetUserId: targetId },
            select: { action: true },
          })
        ).map((row) => row.action),
      );
      for (const action of [
        OperationalAccessAuditAction.OPERATIONAL_ACCESS_GRANTED,
        OperationalAccessAuditAction.OPERATIONAL_ACCESS_EXTENDED,
        OperationalAccessAuditAction.OPERATIONAL_SCOPE_CHANGED,
        OperationalAccessAuditAction.OPERATIONAL_ACCESS_REVOKED,
        OperationalAccessAuditAction.OPERATIONAL_TASK_CREATED,
        OperationalAccessAuditAction.OPERATIONAL_TASK_ASSIGNED,
        OperationalAccessAuditAction.OPERATIONAL_TASK_UPDATED,
        OperationalAccessAuditAction.OPERATIONAL_RELEASE_APPROVED,
      ])
        assert.ok(actions.has(action), `Missing audit action ${action}`);
    });

    await runWithTenant(demo, async () => {
      assert.equal(
        await prisma.user.findUnique({ where: { id: targetId } }),
        null,
      );
      await assert.rejects(
        getOperationsDashboard({
          userId: targetId,
          role: Role.OPERATIONS_DIRECTOR,
          name: OPERATIONS_DIRECTOR_NAME,
          ordaProjectOperationsEnabled: true,
          companyOperationsEnabled: true,
        }),
        (error: unknown) => error instanceof OperationsError && error.message === "LIVE_COMPANY_REQUIRED",
      );
    });
  } finally {
    await runWithSystemAccess(async () => {
      if (generatedCalendarTaskId)
        await prisma.calendarTask.deleteMany({ where: { id: generatedCalendarTaskId } });
      if (generatedWorkItemId)
        await prisma.operationalWorkItem.deleteMany({ where: { id: generatedWorkItemId } });
      if (targetId) {
        const testAudits = await prisma.operationalAccessAuditEvent.findMany({
          where: {
            OR: [
              { targetUserId: targetId },
              ...(directorId ? [{ actorId: directorId }] : []),
            ],
          },
          select: { id: true },
        });
        await prisma.operationalAccessAuditEvent.deleteMany({
          where: {
            id: {
              in: testAudits
                .map((row) => row.id)
                .filter((id) => !initialAuditIds.has(id)),
            },
          },
        });
        for (const row of priorWorkAssignments)
          await prisma.operationalWorkItem.updateMany({
            where: { id: row.id },
            data: { assigneeId: row.assigneeId },
          });
        for (const row of priorCalendarAssignments)
          await prisma.calendarTask.updateMany({
            where: { id: row.id },
            data: { assigneeId: row.assigneeId },
          });
        if (targetBefore) {
          await prisma.user.update({
            where: { id: targetBefore.id },
            data: {
              companyId: targetBefore.companyId,
              name: targetBefore.name,
              email: targetBefore.email,
              password: targetBefore.password,
              role: targetBefore.role,
              active: targetBefore.active,
              temporaryAccess: targetBefore.temporaryAccess,
              accessExpiresAt: targetBefore.accessExpiresAt,
              accessRevokedAt: targetBefore.accessRevokedAt,
              revokedById: targetBefore.revokedById,
              revokeReason: targetBefore.revokeReason,
              ordaProjectOperationsEnabled:
                targetBefore.ordaProjectOperationsEnabled,
              companyOperationsEnabled: targetBefore.companyOperationsEnabled,
              mustChangePassword: targetBefore.mustChangePassword,
              passwordChangedAt: targetBefore.passwordChangedAt,
              failedLoginAttempts: targetBefore.failedLoginAttempts,
              lockedUntil: targetBefore.lockedUntil,
              sessionVersion: targetBefore.sessionVersion,
            },
          });
        } else {
          await prisma.user.deleteMany({ where: { id: targetId } });
        }
      }
      if (directorId)
        await prisma.user.deleteMany({ where: { id: directorId } });
    });
    await prisma.$disconnect();
  }

  console.log("Operations director access checks passed");
}

function readTarget() {
  return prisma.user.findUnique({
    where: { email: OPERATIONS_DIRECTOR_EMAIL },
    select: targetRestoreSelect,
  });
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack ?? error.message : "OPERATIONS_TEST_FAILED",
  );
  process.exitCode = 1;
});
