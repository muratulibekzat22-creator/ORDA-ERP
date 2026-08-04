import { notFound } from "next/navigation";

import CommercialProposal from "@/components/documents/CommercialProposal";
import { getOrder } from "@/lib/services/order.service";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function ProposalPage({
  params,
}: Props) {
  const { id } = await params;

  const order = await getOrder(Number(id));

  if (!order) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-200 p-10">

      <div className="mb-6 flex justify-end gap-3">

        <button
          onClick={() => window.print()}
          className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 print:hidden"
        >
          Печать
        </button>

      </div>

      <CommercialProposal
        order={order}
      />

    </main>
  );
}