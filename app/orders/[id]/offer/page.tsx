import { notFound } from "next/navigation";

import CommercialOffer from "@/components/pdf/CommercialOffer";
import { getOrder } from "@/lib/services/order.service";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function CommercialOfferPage({
  params,
}: Props) {
  const { id } = await params;

  const order = await getOrder(Number(id));

  if (!order) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-100 p-10">

      <div className="mb-8 flex justify-end gap-4">

        <button
          onClick={() => window.print()}
          className="rounded-xl bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
        >
          🖨️ Печать
        </button>

        <button
          className="rounded-xl bg-green-600 px-6 py-3 text-white hover:bg-green-700"
        >
          📄 Скачать PDF
        </button>

      </div>

      <CommercialOffer
        order={order}
      />

    </main>
  );
}