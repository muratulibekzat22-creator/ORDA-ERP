import { notFound } from "next/navigation";

import CommercialProposal from "@/components/documents/CommercialProposal";
import DocumentPreview from "@/components/documents/DocumentPreview";
import { getAuthorizedDocumentOrder } from "@/lib/document-page-auth";

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const order = await getAuthorizedDocumentOrder(id);
  if (!order) notFound();
  return <DocumentPreview title="Коммерческое предложение" orderId={order.id}><CommercialProposal order={order}/></DocumentPreview>;
}
