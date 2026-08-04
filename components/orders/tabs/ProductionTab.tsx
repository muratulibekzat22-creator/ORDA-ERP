import ProjectProduction from "@/components/project/ProjectProduction";
import type { OrderTabData } from "./types";

export default function ProductionTab({ order }: { order: OrderTabData }) {
  return <ProjectProduction orderId={order.id} production={order.productions[0]} />;
}
