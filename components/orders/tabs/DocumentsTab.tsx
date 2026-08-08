"use client";

import { useState } from "react";
import ContractComposer from "@/components/contracts/ContractComposer";
import DocumentsPage from "@/components/pages/DocumentsPage";

export default function DocumentsTab({ orderId }: { orderId: number }) {
  const [version, setVersion] = useState(0);
  return <><ContractComposer orderId={orderId} onGenerated={() => setVersion((value) => value + 1)}/><DocumentsPage key={version} initialOrderId={orderId} embedded /></>;
}
