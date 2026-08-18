import "next-auth";

declare module "next-auth" {
  interface User {
    role: string;
    sessionVersion: number;
    mustChangePassword: boolean;
    companyId: number;
    companySlug: string;
    companyName: string;
    isDemo: boolean;
  }
  interface Session {
    invalid?: boolean;
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      role: string;
      mustChangePassword?: boolean;
      companyId: number;
      companySlug: string;
      companyName: string;
      isDemo: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    sessionVersion?: number;
    mustChangePassword?: boolean;
    companyId?: number;
    companySlug?: string;
    companyName?: string;
    isDemo?: boolean;
    invalid?: boolean;
  }
}
