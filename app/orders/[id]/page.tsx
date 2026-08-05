import { notFound } from "next/navigation";

import OrderWorkspace from "@/components/orders/OrderWorkspace";
import { getAuthorizedOrder } from "@/lib/order-page-auth";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function OrderDetailsPage({ params }: Props) {
  const { id } = await params;
  const order = await getAuthorizedOrder(Number(id));

  if (!order) {
    notFound();
  }

  return <OrderWorkspace order={order} />;
}
