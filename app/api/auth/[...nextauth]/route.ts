import bcrypt from "bcrypt";
import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { prisma } from "@/lib/prisma";

function databaseHost() {
  try { return process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : null; }
  catch { return null; }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        throw new Error("AUTHORIZE EXECUTED");

        let userFound = false;
        let active: boolean | null = null;
        let passwordMatches: boolean | null = null;
        const logAuthorize = () => console.info("===== ORDA AUTHORIZE =====", {
          userFound,
          active,
          passwordMatches,
          databaseHost: databaseHost(),
          VERCEL_ENV: process.env.VERCEL_ENV ?? "unknown",
        });

        if (!credentials?.email?.trim() || !credentials.password) {
          logAuthorize();
          return null;
        }

        const email = credentials.email.trim().toLowerCase();
        const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
        userFound = Boolean(user);
        active = user?.active ?? null;
        passwordMatches = user ? await bcrypt.compare(credentials.password, user.password) : false;
        if (!user || !user.active || !passwordMatches) {
          logAuthorize();
          return null;
        }

        await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
        logAuthorize();
        return { id: String(user.id), name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  useSecureCookies: process.env.VERCEL === "1" || process.env.NEXTAUTH_URL?.startsWith("https://"),
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = String(token.id);
      session.user.role = String(token.role);
      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
