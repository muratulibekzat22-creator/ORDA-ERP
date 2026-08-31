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
    temporaryAccess: boolean;
    accessExpiresAt: string | null;
    accessRevokedAt: string | null;
    ordaProjectOperationsEnabled: boolean;
    companyOperationsEnabled: boolean;
  }
  interface Session {
    invalid?: boolean;
    invalidReason?: string;
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
      temporaryAccess: boolean;
      accessExpiresAt: string | null;
      accessRevokedAt: string | null;
      ordaProjectOperationsEnabled: boolean;
      companyOperationsEnabled: boolean;
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
    invalidReason?: string;
    temporaryAccess?: boolean;
    accessExpiresAt?: string | null;
    accessRevokedAt?: string | null;
    ordaProjectOperationsEnabled?: boolean;
    companyOperationsEnabled?: boolean;
  }
}
