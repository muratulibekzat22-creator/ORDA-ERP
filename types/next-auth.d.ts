import "next-auth";

declare module "next-auth" {
  interface User { role: string; sessionVersion: number; mustChangePassword: boolean }
  interface Session {
    invalid?: boolean;
    user: { id: string; name?: string | null; email?: string | null; role: string; mustChangePassword?: boolean };
  }
}

declare module "next-auth/jwt" {
  interface JWT { id?: string; role?: string; sessionVersion?: number; mustChangePassword?: boolean; invalid?: boolean }
}
