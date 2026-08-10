"use client";

import { useState } from "react";
import ContractComposer from "@/components/contracts/ContractComposer";
import DocumentsPage from "@/components/pages/DocumentsPage";

export default function DocumentsTab({
  orderId,
  readOnly = false,
}: {
  orderId: number;
  readOnly?: boolean;
}) {
  const [version, setVersion] = useState(0);
  return (
    <>
      {!readOnly && (
        <ContractComposer
          orderId={orderId}
          onGenerated={() => setVersion((value) => value + 1)}
        />
      )}
      <DocumentsPage key={version} initialOrderId={orderId} embedded />
    </>
  );
}
