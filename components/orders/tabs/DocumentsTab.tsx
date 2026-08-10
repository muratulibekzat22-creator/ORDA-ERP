"use client";

import { useState } from "react";
import ContractComposer from "@/components/contracts/ContractComposer";
import ContractPackageCard from "@/components/contracts/ContractPackageCard";
import DocumentsPage from "@/components/pages/DocumentsPage";

export default function DocumentsTab({
  orderId,
  readOnly = false,
}: {
  orderId: number;
  readOnly?: boolean;
}) {
  const [version, setVersion] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  return (
    <>
      <ContractPackageCard orderId={orderId} revision={version} readOnly={readOnly} onCreate={() => setComposerOpen(true)} />
      {!readOnly && composerOpen && (
        <ContractComposer
          orderId={orderId}
          autoOpen
          showTrigger={false}
          onClosed={() => setComposerOpen(false)}
          onGenerated={() => { setComposerOpen(false); setVersion((value) => value + 1); }}
        />
      )}
      <DocumentsPage key={version} initialOrderId={orderId} embedded />
    </>
  );
}
