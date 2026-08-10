import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireOrder360Actor } from "@/lib/order360-auth";
import {
  acknowledgeCustomerMemo,
  ensureContractPackage,
  getContractPackage,
} from "@/lib/services/contract-package.service";
import type { DocumentActor } from "@/lib/services/document.service";

type Context = { params: Promise<{ id: string }> };

function orderId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function projection(value: Awaited<ReturnType<typeof getContractPackage>>) {
  if (!value) return null;
  return {
    contract: {
      id: value.contract.id,
      number: value.contract.number,
      status: value.contract.status,
      currentVersion: value.contract.currentVersion,
      signedAt: value.contract.signedAt,
      signedFileName: value.contract.signedFileName,
      versions: value.contract.versions.map((version) => ({
        id: version.id,
        version: version.version,
        fileName: version.fileName,
        contentType: version.contentType,
        size: version.size,
        checksum: version.checksum,
        pdfFileName: version.pdfFileName,
        pdfContentType: version.pdfContentType,
        pdfSize: version.pdfSize,
        pdfChecksum: version.pdfChecksum,
        pdfStatus: version.pdfStatus,
        pdfGeneratedAt: version.pdfGeneratedAt,
        pdfErrorCode: version.pdfErrorCode,
      })),
    },
    memo: value.memo
      ? {
          id: value.memo.id,
          number: value.memo.number,
          status: value.memo.status,
          currentVersion: value.memo.currentVersion,
          signedAt: value.memo.signedAt,
          signedFileName: value.memo.signedFileName,
          versions: value.memo.versions.map((version) => ({
            id: version.id,
            version: version.version,
            fileName: version.fileName,
            size: version.size,
            checksum: version.checksum,
          })),
        }
      : null,
    acknowledgement: value.acknowledgement
      ? {
          acknowledgedAt: value.acknowledgement.acknowledgedAt,
          memoVersion: value.acknowledgement.memoVersion,
          acknowledgedBy: value.acknowledgement.acknowledgedBy,
        }
      : null,
    receipts: value.receipts.map((receipt) => ({
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      status: receipt.status,
      documentId: receipt.documentId,
      createdAt: receipt.createdAt,
      voidedAt: receipt.voidedAt,
      voidReason: receipt.voidReason,
      verificationPath: `/verify/payment-receipt/${receipt.verificationToken}`,
      shift: {
        id: receipt.cashShift.id,
        shiftNumber: receipt.cashShift.shiftNumber,
        status: receipt.cashShift.status,
        responsibleManager: receipt.cashShift.responsibleManager.name,
      },
      version: receipt.document.versions[0]
        ? {
            id: receipt.document.versions[0].id,
            fileName: receipt.document.versions[0].fileName,
            size: receipt.document.versions[0].size,
            checksum: receipt.document.versions[0].checksum,
          }
        : null,
    })),
  };
}

export async function GET(_: Request, { params }: Context) {
  const auth = await requireOrder360Actor();
  if (auth.response) return auth.response;
  if (auth.actor!.role !== Role.DIRECTOR && auth.actor!.role !== Role.MANAGER)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = orderId((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const result = await getContractPackage(id, auth.actor as DocumentActor);
  return NextResponse.json({ package: projection(result) });
}

export async function POST(request: Request, { params }: Context) {
  const auth = await requireOrder360Actor();
  if (auth.response) return auth.response;
  if (auth.actor!.role !== Role.DIRECTOR && auth.actor!.role !== Role.MANAGER)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = orderId((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = (await request.json()) as { action?: string; contractDocumentId?: number };
    const current = await getContractPackage(id, auth.actor as DocumentActor);
    const contractDocumentId = Number(body.contractDocumentId ?? current?.contract.id);
    if (!Number.isInteger(contractDocumentId) || contractDocumentId <= 0)
      return NextResponse.json({ error: "Сначала сформируйте договор" }, { status: 409 });
    if (body.action === "acknowledge-memo")
      await acknowledgeCustomerMemo(contractDocumentId, auth.actor as DocumentActor);
    else if (body.action === "ensure" || body.action === "retry-contract-pdf")
      await ensureContractPackage(contractDocumentId, auth.actor as DocumentActor);
    else return NextResponse.json({ error: "Некорректное действие" }, { status: 400 });
    return NextResponse.json({
      package: projection(await getContractPackage(id, auth.actor as DocumentActor)),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PACKAGE_FAILED";
    const label =
      code === "MEMO_NOT_READY"
        ? "Памятка ещё не сформирована"
        : code === "CONTRACT_PDF_LAYOUT_OVERFLOW"
          ? "Данные договора не помещаются в утверждённый PDF-шаблон"
          : code;
    return NextResponse.json(
      { error: label },
      { status: code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : 409 },
    );
  }
}
