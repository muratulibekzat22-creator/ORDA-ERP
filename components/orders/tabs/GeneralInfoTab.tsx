import OrderCard from "@/components/orders/OrderCard";

import type { OrderTabData } from "./types";

export default function GeneralInfoTab({ order }: { order: OrderTabData }) {
  return <OrderCard order={order} />;
}
