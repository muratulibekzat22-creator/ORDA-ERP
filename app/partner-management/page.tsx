import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { forbidden, redirect } from "next/navigation";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import PartnerSettlementWorkspace from "@/components/partners/PartnerSettlementWorkspace";

export default async function PartnerManagementPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; orderId?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== Role.DIRECTOR && session.user.role !== Role.OPERATIONS_DIRECTOR) forbidden();
  const query = await searchParams;
  const orderId = Number(query.orderId);
  return (
    <PartnerSettlementWorkspace
      initialTab={query.tab === "orders" ? "orders" : undefined}
      initialOrderId={Number.isInteger(orderId) && orderId > 0 ? orderId : undefined}
      readOnly={session.user.role === Role.OPERATIONS_DIRECTOR}
    />
  );
}
