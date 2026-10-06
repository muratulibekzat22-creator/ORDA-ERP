"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

export default function MfaEnrollmentBanner() {
  const { data: session } = useSession();
  const role = session?.user.accountRole;
  if (!session || session.user.mfaEnabled || (role !== "DIRECTOR" && role !== "OPERATIONS_DIRECTOR")) return null;
  return (
    <div role="status" className="sticky top-0 z-[70] flex items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-slate-950">
      <span>Защитите привилегированный аккаунт двухфакторной аутентификацией.</span>
      <Link href="/mfa-setup" className="rounded-lg bg-slate-950 px-3 py-1.5 text-white">Настроить MFA</Link>
    </div>
  );
}
