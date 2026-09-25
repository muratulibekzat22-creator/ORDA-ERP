import OrdersPage from "@/components/pages/OrdersPage";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <OrdersPage
      initialTab={typeof params.tab === "string" ? params.tab : undefined}
      initialStatus={typeof params.status === "string" ? params.status : undefined}
      initialAttention={typeof params.attention === "string" ? params.attention : undefined}
    />
  );
}
