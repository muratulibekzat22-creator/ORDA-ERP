import "next-auth";

declare module "next-auth" {
  interface User {
    role: string;
    accountRole: string;
    sessionVersion: number;
    mustChangePassword: boolean;
    companyId: number;
    companySlug: string;
    companyName: string;
    isDemo: boolean;
    mfaEnabled: boolean;
    mfaVerified: boolean;
  }
  interface Session {
    invalid?: boolean;
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      role: string;
      accountRole: string;
      mustChangePassword?: boolean;
      companyId: number;
      companySlug: string;
      companyName: string;
      isDemo: boolean;
      mfaEnabled: boolean;
      mfaVerified: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    accountRole?: string;
    sessionVersion?: number;
    mustChangePassword?: boolean;
    companyId?: number;
    companySlug?: string;
    companyName?: string;
    isDemo?: boolean;
    invalid?: boolean;
    mfaEnabled?: boolean;
    mfaVerified?: boolean;
  }
}
