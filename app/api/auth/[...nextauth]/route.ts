import bcrypt from "bcrypt";
import { createHash } from "crypto";
import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const DUMMY_PASSWORD_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.7dJHqfE5bFJmM3KfVwYfI6KpXqfR3m";

function requestIpHash(request: { headers?: Record<string, string | string[] | undefined> }) {
  const forwarded = request.headers?.["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  const secret = process.env.NEXTAUTH_SECRET;
  return ip && secret ? createHash("sha256").update(`${secret}:${ip}`).digest("hex") : null;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Пароль", type: "password" } },
      async authorize(credentials, request) {
        if (!credentials?.email?.trim() || !credentials.password) return null;
        const email = credentials.email.trim().toLowerCase();
        const ipHash = requestIpHash(request);
        const windowStart = new Date(Date.now() - LOCK_MINUTES * 60_000);
        const recentIpFailures = ipHash ? await prisma.authAuditEvent.count({ where: { ipHash, success: false, createdAt: { gte: windowStart } } }) : 0;
        if (recentIpFailures >= 20) {
          await prisma.authAuditEvent.create({ data: { email, success: false, reason: "IP_RATE_LIMIT", ipHash } }).catch(() => undefined);
          return null;
        }
        const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
        if (user?.lockedUntil && user.lockedUntil > new Date()) {
          await bcrypt.compare(credentials.password, user.password);
          await prisma.authAuditEvent.create({ data: { userId: user.id, email, success: false, reason: "ACCOUNT_LOCKED", ipHash } }).catch(() => undefined);
          return null;
        }
        const passwordMatches = await bcrypt.compare(credentials.password, user?.password ?? DUMMY_PASSWORD_HASH);
        if (!user || !user.active || !passwordMatches) {
          if (user) await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: { increment: 1 }, ...(user.failedLoginAttempts + 1 >= MAX_FAILED_ATTEMPTS ? { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : {}) } });
          await prisma.authAuditEvent.create({ data: { userId: user?.id, email, success: false, reason: !user ? "UNKNOWN_ACCOUNT" : !user.active ? "INACTIVE_ACCOUNT" : "INVALID_PASSWORD", ipHash } }).catch(() => undefined);
          return null;
        }
        await prisma.$transaction([
          prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date(), failedLoginAttempts: 0, lockedUntil: null } }),
          prisma.authAuditEvent.create({ data: { userId: user.id, email, success: true, reason: "LOGIN_SUCCESS", ipHash } }),
        ]);
        return { id: String(user.id), name: user.name, email: user.email, role: user.role, sessionVersion: user.sessionVersion, mustChangePassword: user.mustChangePassword };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60, updateAge: 15 * 60 },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/login" },
  debug: false,
  useSecureCookies: process.env.VERCEL === "1" || process.env.NEXTAUTH_URL?.startsWith("https://"),
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.sessionVersion = user.sessionVersion;
        token.mustChangePassword = user.mustChangePassword;
        token.invalid = false;
      } else if (token.id) {
        const current = await prisma.user.findUnique({ where: { id: Number(token.id) }, select: { active: true, role: true, sessionVersion: true, mustChangePassword: true } });
        token.invalid = !current?.active || current.sessionVersion !== token.sessionVersion;
        if (current) { token.role = current.role; token.mustChangePassword = current.mustChangePassword; }
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = String(token.id ?? "");
      session.user.role = token.invalid ? "" : String(token.role ?? "");
      session.user.mustChangePassword = token.invalid ? false : token.mustChangePassword === true;
      session.invalid = token.invalid === true;
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
