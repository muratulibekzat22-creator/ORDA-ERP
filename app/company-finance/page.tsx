import LedgerPage from "@/components/finance/LedgerPage";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
export default async function CompanyFinancePage() { const session = await getServerSession(authOptions); if (!session?.user) redirect("/login"); const role = session.user.accountRole || session.user.role; if (role !== "DIRECTOR" && role !== "OPERATIONS_DIRECTOR") redirect("/"); return <LedgerPage />; }
