import OrdersPage from "@/components/pages/OrdersPage";

export default async function Page({ searchParams }: { searchParams: Promise<{ settlement?: string | string[] }> }) {
  const params = await searchParams;
  return <OrdersPage initialSettlementFilter={typeof params.settlement === "string" ? params.settlement : undefined} />;
}
