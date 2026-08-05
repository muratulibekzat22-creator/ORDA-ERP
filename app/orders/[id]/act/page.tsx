import { notFound } from "next/navigation";

import DocumentPreview from "@/components/documents/DocumentPreview";
import WorkCompletionAct from "@/components/documents/WorkCompletionAct";
import { getAuthorizedDocumentOrder } from "@/lib/document-page-auth";

export default async function ActPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const order = await getAuthorizedDocumentOrder(id);
  if (!order) notFound();
  return <DocumentPreview title="Акт выполненных работ" orderId={order.id}><WorkCompletionAct order={order}/></DocumentPreview>;
}
