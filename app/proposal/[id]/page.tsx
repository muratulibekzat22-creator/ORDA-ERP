import { notFound } from "next/navigation";

import CommercialProposal from "@/components/documents/CommercialProposal";
import DocumentPreview from "@/components/documents/DocumentPreview";
import { getDocumentOrder } from "@/lib/services/document.service";

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const order = await getDocumentOrder(id);
  if (!order) notFound();
  return <DocumentPreview title="Коммерческое предложение" orderId={order.id}><CommercialProposal order={order}/></DocumentPreview>;
}
