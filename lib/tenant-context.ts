import { AsyncLocalStorage } from "node:async_hooks";

export type TenantIdentity = {
  companyId: number;
  companySlug: string;
  companyName: string;
  isDemo: boolean;
};

type TenantRuntimeContext =
  | ({ kind: "tenant" } & TenantIdentity)
  | { kind: "system" };

const tenantStorage = new AsyncLocalStorage<TenantRuntimeContext>();

export function enterTenantContext(identity: TenantIdentity) {
  tenantStorage.enterWith({ kind: "tenant", ...identity });
}

export function enterTenantFromSession(session: {
  invalid?: boolean;
  user?: {
    companyId?: number;
    companySlug?: string;
    companyName?: string;
    isDemo?: boolean;
  };
} | null | undefined) {
  if (
    session?.invalid ||
    !session?.user?.companyId ||
    !session.user.companySlug ||
    !session.user.companyName
  ) return false;
  enterTenantContext({
    companyId: session.user.companyId,
    companySlug: session.user.companySlug,
    companyName: session.user.companyName,
    isDemo: session.user.isDemo === true,
  });
  return true;
}

export function getTenantRuntimeContext() {
  return tenantStorage.getStore();
}

export function getPrismaRuntimeContext(): TenantRuntimeContext | undefined {
  const context = tenantStorage.getStore();
  if (context) return context;
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.TEST_DATABASE_URL &&
    process.env.DATABASE_URL === process.env.TEST_DATABASE_URL
  ) return {
    kind: "tenant",
    companyId: 1,
    companySlug: "test-company",
    companyName: "ORDA TEST",
    isDemo: false,
  };
  return undefined;
}

/**
 * Request fallback for code paths that authenticate in a helper before issuing
 * Prisma queries.  The tenant still comes exclusively from NextAuth's signed
 * session token; unsigned request parameters and headers are never consulted.
 */
export async function getSessionTenantRuntimeContext(): Promise<TenantRuntimeContext | undefined> {
  try {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) return undefined;
    const [{ cookies }, { decode }] = await Promise.all([
      import("next/headers"),
      import("next-auth/jwt"),
    ]);
    const store = await cookies();
    const names = ["__Secure-next-auth.session-token", "next-auth.session-token"];
    let encoded = "";
    for (const name of names) {
      const exact = store.get(name)?.value;
      if (exact) {
        encoded = exact;
        break;
      }
      const chunks = store.getAll()
        .filter((cookie) => cookie.name.startsWith(`${name}.`))
        .sort((left, right) => left.name.localeCompare(right.name));
      if (chunks.length) {
        encoded = chunks.map((cookie) => cookie.value).join("");
        break;
      }
    }
    if (!encoded) return undefined;
    const token = await decode({ token: encoded, secret });
    const companyId = Number(token?.companyId ?? 0);
    if (
      token?.invalid === true ||
      !Number.isInteger(companyId) ||
      companyId <= 0 ||
      typeof token?.companySlug !== "string" ||
      typeof token?.companyName !== "string"
    ) return undefined;
    return {
      kind: "tenant",
      companyId,
      companySlug: token.companySlug,
      companyName: token.companyName,
      isDemo: token.isDemo === true,
    };
  } catch {
    return undefined;
  }
}

export function requireTenantIdentity(): TenantIdentity {
  const context = getPrismaRuntimeContext();
  if (!context || context.kind !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED");
  return context;
}

export function runWithTenant<T>(identity: TenantIdentity, callback: () => T | Promise<T>): Promise<T> {
  return tenantStorage.run({ kind: "tenant", ...identity }, async () => await callback());
}

/**
 * Explicit escape hatch for authentication, migrations and audited maintenance.
 * Business request handlers must never use this helper.
 */
export function runWithSystemAccess<T>(callback: () => T | Promise<T>): Promise<T> {
  return tenantStorage.run({ kind: "system" }, async () => await callback());
}
