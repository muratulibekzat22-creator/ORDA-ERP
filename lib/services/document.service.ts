import { getOrder } from "@/lib/services/order.service";

export async function getDocumentOrder(id: number) {
  return Number.isInteger(id) && id > 0 ? getOrder(id) : null;
}
