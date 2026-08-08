import DocumentDetails from "@/components/documents/DocumentDetails";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  return <DocumentDetails documentId={Number((await params).id)} />;
}
