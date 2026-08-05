import { notFound } from "next/navigation";

import DocumentPreview from "@/components/documents/DocumentPreview";
import Invoice from "@/components/documents/Invoice";
import { getAuthorizedDocumentOrder } from "@/lib/document-page-auth";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const order = await getAuthorizedDocumentOrder(id);
  if (!order) notFound();
  return <DocumentPreview title="Счёт на оплату" orderId={order.id}><Invoice order={order}/></DocumentPreview>;
}
