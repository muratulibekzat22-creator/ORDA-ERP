import bcrypt from "bcrypt";
import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { ACCOUNT_FAILURE_LIMIT, ACCOUNT_IP_FAILURE_LIMIT, AUTH_WINDOW_MS, IP_ABUSE_FAILURE_LIMIT, accountFailureWindowStart, accountIdentifierHash, normalizeAccountIdentifier, pruneAuthAudit, requestId, requestIpHash, userAgentClass, writeAuthAudit, type SafeAuthReason } from "@/lib/auth-security";
import { productionLog } from "@/lib/observability";
import { prisma } from "@/lib/prisma";

const DUMMY_PASSWORD_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.7dJHqfE5bFJmM3KfVwYfI6KpXqfR3m";
class SafeAuthError extends Error { constructor(public reason: SafeAuthReason) { super(reason); } }

export const authOptions: NextAuthOptions = {
  providers: [CredentialsProvider({
    name: "Credentials",
    credentials: { email: { label: "Email", type: "email" }, password: { label: "Пароль", type: "password" } },
    async authorize(credentials, request) {
      if (!credentials?.email?.trim() || !credentials.password) throw new SafeAuthError("CSRF_OR_AUTH_FLOW_ERROR");
      const email = normalizeAccountIdentifier(credentials.email), identifierHash = accountIdentifierHash(email), ipHash = requestIpHash(request), correlationId = requestId(request), agentClass = userAgentClass(request);
      const audit = (userId: number | undefined, success: boolean, reason: string) => writeAuthAudit(prisma, { userId, success, reason, identifierHash, ipHash, requestId: correlationId, userAgentClass: agentClass });
      void pruneAuthAudit(prisma);
      const windowStart = new Date(Date.now() - AUTH_WINDOW_MS), invalidReason = "INVALID_CREDENTIALS";
      const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
      const accountWindowStart = accountFailureWindowStart(user?.passwordChangedAt);
      const [accountIpFailures, ipFailures] = await Promise.all([
        identifierHash ? prisma.authAuditEvent.count({ where: { accountIdentifierHash: identifierHash, ipHash, reason: invalidReason, createdAt: { gte: accountWindowStart } } }) : 0,
        ipHash ? prisma.authAuditEvent.count({ where: { ipHash, reason: invalidReason, createdAt: { gte: windowStart } } }) : 0,
      ]);
      if (ipFailures >= IP_ABUSE_FAILURE_LIMIT || accountIpFailures >= ACCOUNT_IP_FAILURE_LIMIT) {
        productionLog("warn", "authentication.rate_limited", { requestId: correlationId ?? undefined, route: "/api/auth/callback/credentials", method: "POST", reason: "RATE_LIMITED" });
        await audit(undefined, false, "RATE_LIMITED");
        throw new SafeAuthError("RATE_LIMITED");
      }
      if (user?.lockedUntil && user.lockedUntil > new Date()) {
        await bcrypt.compare(credentials.password, user.password);
        await audit(user.id, false, "TEMPORARILY_LOCKED");
        throw new SafeAuthError("TEMPORARILY_LOCKED");
      }
      const passwordMatches = await bcrypt.compare(credentials.password, user?.password ?? DUMMY_PASSWORD_HASH);
      if (!user || !user.active || !passwordMatches) {
        if (user?.active) {
          const nextFailures = user.failedLoginAttempts + 1;
          await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: nextFailures, ...(nextFailures === ACCOUNT_FAILURE_LIMIT ? { lockedUntil: new Date(Date.now() + AUTH_WINDOW_MS) } : {}) } });
        }
        await audit(user?.id, false, invalidReason);
        throw new SafeAuthError("INVALID_CREDENTIALS");
      }
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date(), failedLoginAttempts: 0, lockedUntil: null } }),
        prisma.authAuditEvent.create({ data: { userId: user.id, email: null, accountIdentifierHash: identifierHash, success: true, reason: "LOGIN_SUCCESS", requestId: correlationId, ipHash, userAgentClass: agentClass } }),
      ]);
      return { id: String(user.id), name: user.name, email: user.email, role: user.role, sessionVersion: user.sessionVersion, mustChangePassword: user.mustChangePassword };
    },
  })],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60, updateAge: 15 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/login" },
  debug: false,
  useSecureCookies: process.env.VERCEL === "1" || process.env.NEXTAUTH_URL?.startsWith("https://"),
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.id = user.id; token.role = user.role; token.sessionVersion = user.sessionVersion; token.mustChangePassword = user.mustChangePassword; token.invalid = false; }
      else if (token.id) { const current = await prisma.user.findUnique({ where: { id: Number(token.id) }, select: { active: true, role: true, sessionVersion: true, mustChangePassword: true } }); token.invalid = !current?.active || current.sessionVersion !== token.sessionVersion; if (current) { token.role = current.role; token.mustChangePassword = current.mustChangePassword; } }
      return token;
    },
    session({ session, token }) { session.user.id = String(token.id ?? ""); session.user.role = token.invalid ? "" : String(token.role ?? ""); session.user.mustChangePassword = token.invalid ? false : token.mustChangePassword === true; session.invalid = token.invalid === true; return session; },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
