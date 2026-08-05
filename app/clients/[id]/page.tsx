import ClientCard from "@/components/clients/ClientCard";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientCard clientId={Number(id)} />;
}
