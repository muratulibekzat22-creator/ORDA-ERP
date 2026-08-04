import { notFound } from "next/navigation";

import Contract from "@/components/documents/Contract";
import DocumentPreview from "@/components/documents/DocumentPreview";
import { getDocumentOrder } from "@/lib/services/document.service";

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const order = await getDocumentOrder(id);
  if (!order) notFound();
  return <DocumentPreview title="Договор" orderId={order.id}><Contract order={order}/></DocumentPreview>;
}
