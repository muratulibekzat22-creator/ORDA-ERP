import LedgerPage from "@/components/finance/LedgerPage";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
export default async function PersonalFinancePage() { const session = await getServerSession(authOptions); if (!session?.user) redirect("/login"); if (session.user.role !== "DIRECTOR") redirect("/"); return <LedgerPage personal />; }
