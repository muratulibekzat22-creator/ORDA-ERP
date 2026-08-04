import { prisma } from "@/lib/prisma";
import ClientCard from "@/components/clients/ClientCard";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function ClientPage({
  params,
}: Props) {
  const { id } = await params;

  const client = await prisma.client.findUnique({
    where: {
      id: Number(id),
    },
  });

  if (!client) {
    return (
      <main className="flex h-screen items-center justify-center">
        <h1 className="text-3xl font-bold text-white">
          Клиент не найден
        </h1>
      </main>
    );
  }

  return (
    <main className="p-8">
      <ClientCard client={client} />
    </main>
  );
}