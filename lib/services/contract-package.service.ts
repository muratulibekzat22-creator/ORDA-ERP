import { createHash, randomUUID } from "node:crypto";

import {
  DocumentSource,
  DocumentStatus,
  DocumentType,
  PdfGenerationStatus,
  Prisma,
  Role,
} from "@prisma/client";
import JSZip from "jszip";

import type { ContractSnapshot } from "@/lib/contracts/domain";
import {
  buildContractPdf,
  CONTRACT_PDF_PAGE_COUNT,
  CONTRACT_PDF_TEMPLATE_VERSION,
} from "@/lib/documents/contract-pdf";
import {
  buildCustomerMemoPdf,
  CUSTOMER_MEMO_TEMPLATE_VERSION,
  type CustomerMemoSnapshot,
} from "@/lib/documents/customer-memo-pdf";
import { countPdfPages, streamToBuffer } from "@/lib/documents/pdf-utils";
import { del, get, put } from "@/lib/private-blob";
import { prisma } from "@/lib/prisma";
import {
  getDocument,
  type DocumentActor,
} from "@/lib/services/document.service";

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_TYPE = "application/pdf";
const MAX_SIGNED_SIZE = 15 * 1024 * 1024;

function packageActor(actor: DocumentActor) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER)
    throw new Error("FORBIDDEN");
}

function errorCode(error: unknown) {
  const value = error instanceof Error ? error.message : "PDF_GENERATION_FAILED";
  return /^[A-Z0-9_]{3,80}$/.test(value)
    ? value
    : "PDF_GENERATION_FAILED";
}

function memoSnapshot(
  contract: {
    id: number;
    currentVersion: number;
    snapshot: Prisma.JsonValue | null;
  },
  now = new Date(),
): CustomerMemoSnapshot {
  const snapshot = contract.snapshot as unknown as ContractSnapshot;
  return {
    templateVersion: CUSTOMER_MEMO_TEMPLATE_VERSION,
    orderNumber: snapshot.orderNumber,
    contractNumber: snapshot.contractNumber,
    clientFullName: snapshot.clientFullName,
    installationAddress: snapshot.installationAddress,
    productionContactName: snapshot.productionContactName,
    productionContactPhone: snapshot.productionContactPhone,
    companyName: snapshot.companyName,
    companyPhones: snapshot.companyPhones,
    createdAt: now.toISOString(),
  };
}

async function privateBlobBytes(pathname: string) {
  const blob = await get(pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200) throw new Error("SOURCE_FILE_NOT_FOUND");
  return streamToBuffer(blob.stream);
}

export async function ensureContractPdf(
  documentId: number,
  actor: DocumentActor,
) {
  packageActor(actor);
  const document = await getDocument(documentId, actor);
  if (!document || document.type !== DocumentType.CONTRACT)
    throw new Error("NOT_FOUND");
  const version = await prisma.documentVersion.findUnique({
    where: {
      documentId_version: {
        documentId,
        version: document.currentVersion,
      },
    },
  });
  if (!version || version.contentType !== DOCX_TYPE)
    throw new Error("CONTRACT_DOCX_NOT_FOUND");
  if (
    version.pdfStatus === PdfGenerationStatus.READY &&
    version.pdfPathname &&
    version.pdfChecksum
  )
    return version;

  const pending = await prisma.documentVersion.updateMany({
    where: {
      id: version.id,
      pdfStatus: { not: PdfGenerationStatus.READY },
    },
    data: { pdfStatus: PdfGenerationStatus.PENDING, pdfErrorCode: null },
  });
  if (!pending.count)
    return prisma.documentVersion.findUniqueOrThrow({ where: { id: version.id } });
  try {
    const snapshot = (version.snapshot ?? document.snapshot) as unknown as ContractSnapshot | null;
    if (!snapshot?.contractNumber || !snapshot.clientFullName || !snapshot.companyName)
      throw new Error("CONTRACT_SNAPSHOT_INVALID");
    const pdf = await buildContractPdf(snapshot);
    if (countPdfPages(pdf) !== CONTRACT_PDF_PAGE_COUNT)
      throw new Error("CONTRACT_PDF_PAGE_COUNT_INVALID");
    const fileName = `Договор-${document.number}-v${version.version}.pdf`;
    const pathname = `documents/contracts/${document.id}/v${version.version}/contract.pdf`;
    const checksum = createHash("sha256").update(pdf).digest("hex");
    const blob = await put(pathname, pdf, {
      access: "private",
      contentType: PDF_TYPE,
      addRandomSuffix: false,
      allowOverwrite: true,
      maximumSizeInBytes: 25 * 1024 * 1024,
    });
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.documentVersion.updateMany({
        where: {
          id: version.id,
          pdfStatus: { not: PdfGenerationStatus.READY },
        },
        data: {
          pdfFileName: fileName,
          pdfPathname: blob.pathname,
          pdfContentType: PDF_TYPE,
          pdfSize: pdf.length,
          pdfChecksum: checksum,
          pdfStatus: PdfGenerationStatus.READY,
          pdfGeneratedAt: new Date(),
          pdfErrorCode: null,
        },
      });
      if (claimed.count) {
        await tx.documentAudit.create({
          data: {
            documentId,
            actorId: actor.userId,
            action: "CONTRACT_PDF_GENERATED",
            after: {
              version: version.version,
              pages: CONTRACT_PDF_PAGE_COUNT,
              checksum,
              renderer: CONTRACT_PDF_TEMPLATE_VERSION,
            },
          },
        });
      }
      return tx.documentVersion.findUniqueOrThrow({ where: { id: version.id } });
    });
    return updated;
  } catch (error) {
    await prisma.documentVersion.updateMany({
      where: {
        id: version.id,
        pdfStatus: { not: PdfGenerationStatus.READY },
      },
      data: {
        pdfStatus: PdfGenerationStatus.FAILED,
        pdfErrorCode: errorCode(error),
      },
    });
    throw error;
  }
}

async function memoDocumentForContract(contractDocumentId: number) {
  return prisma.document.findFirst({
    where: {
      type: DocumentType.CUSTOMER_MEMO,
      snapshot: { path: ["contractDocumentId"], equals: contractDocumentId },
    },
    include: { versions: { orderBy: { version: "desc" } } },
  });
}

export async function ensureCustomerMemo(
  contractDocumentId: number,
  actor: DocumentActor,
) {
  packageActor(actor);
  const contract = await getDocument(contractDocumentId, actor);
  if (
    !contract ||
    contract.type !== DocumentType.CONTRACT ||
    !contract.orderId ||
    !contract.clientId ||
    !contract.snapshot
  )
    throw new Error("NOT_FOUND");
  const snapshot = memoSnapshot(contract);
  const existing = await memoDocumentForContract(contract.id);
  const currentSnapshot = existing?.snapshot as Record<string, unknown> | null;
  if (
    existing &&
    existing.currentVersion > 0 &&
    currentSnapshot?.contractVersion === contract.currentVersion &&
    currentSnapshot?.templateVersion === CUSTOMER_MEMO_TEMPLATE_VERSION
  )
    return existing;

  const bytes = await buildCustomerMemoPdf(snapshot);
  if (countPdfPages(bytes) !== 1) throw new Error("MEMO_PDF_NOT_ONE_PAGE");
  const document =
    existing ??
    (await prisma.document.create({
      data: {
        orderId: contract.orderId,
        clientId: contract.clientId,
        type: DocumentType.CUSTOMER_MEMO,
        number: `${contract.number}-ПАМ`,
        title: "Памятка заказчику",
        documentDate: new Date(snapshot.createdAt),
        status: DocumentStatus.DRAFT,
        source: DocumentSource.GENERATED_ORDER,
        authorId: actor.userId,
        templateVersion: CUSTOMER_MEMO_TEMPLATE_VERSION,
        snapshot: {
          ...snapshot,
          contractDocumentId: contract.id,
          contractVersion: contract.currentVersion,
        } as unknown as Prisma.InputJsonValue,
        idempotencyKey: `customer-memo:${contract.id}`,
        requestHash: createHash("sha256")
          .update(`${contract.id}:${contract.currentVersion}:${CUSTOMER_MEMO_TEMPLATE_VERSION}`)
          .digest("hex"),
      },
    }));
  const version = document.currentVersion + 1;
  const fileName = `Памятка-${contract.number}-v${version}.pdf`;
  const pathname = `documents/contracts/${contract.id}/memo/v${version}.pdf`;
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const blob = await put(pathname, bytes, {
    access: "private",
    contentType: PDF_TYPE,
    addRandomSuffix: false,
    allowOverwrite: true,
    maximumSizeInBytes: 5 * 1024 * 1024,
  });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${document.id})`;
      const locked = await tx.document.findUniqueOrThrow({
        where: { id: document.id },
        select: { currentVersion: true },
      });
      if (locked.currentVersion >= version) return;
      await tx.documentVersion.create({
        data: {
          documentId: document.id,
          version,
          uploadedById: actor.userId,
          comment: "Обязательная памятка заказчику",
          fileName,
          pathname: blob.pathname,
          contentType: PDF_TYPE,
          size: bytes.length,
          checksum,
          templateVersion: CUSTOMER_MEMO_TEMPLATE_VERSION,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          idempotencyKey: `customer-memo:${contract.id}:contract-v${contract.currentVersion}`,
        },
      });
      await tx.document.update({
        where: { id: document.id },
        data: {
          currentVersion: version,
          status: DocumentStatus.READY,
          templateVersion: CUSTOMER_MEMO_TEMPLATE_VERSION,
          snapshot: {
            ...snapshot,
            contractDocumentId: contract.id,
            contractVersion: contract.currentVersion,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.documentAudit.create({
        data: {
          documentId: document.id,
          actorId: actor.userId,
          action: "CUSTOMER_MEMO_GENERATED",
          after: {
            version,
            contractDocumentId: contract.id,
            contractVersion: contract.currentVersion,
            pages: 1,
            checksum,
          },
        },
      });
    });
  } catch (error) {
    await del(blob.pathname).catch(() => undefined);
    throw error;
  }
  return memoDocumentForContract(contract.id);
}

export async function ensureContractPackage(
  contractDocumentId: number,
  actor: DocumentActor,
) {
  const memo = await ensureCustomerMemo(contractDocumentId, actor);
  let pdfError: string | null = null;
  try {
    await ensureContractPdf(contractDocumentId, actor);
  } catch (error) {
    pdfError = errorCode(error);
  }
  return { memo, pdfError };
}

export async function acknowledgeCustomerMemo(
  contractDocumentId: number,
  actor: DocumentActor,
) {
  packageActor(actor);
  const contract = await getDocument(contractDocumentId, actor);
  if (!contract || contract.type !== DocumentType.CONTRACT)
    throw new Error("NOT_FOUND");
  const memo = await memoDocumentForContract(contract.id);
  if (!memo || memo.currentVersion <= 0) throw new Error("MEMO_NOT_READY");
  return prisma.$transaction(async (tx) => {
    const acknowledgement = await tx.customerMemoAcknowledgement.upsert({
      where: {
        contractDocumentId_memoVersion: {
          contractDocumentId: contract.id,
          memoVersion: memo.currentVersion,
        },
      },
      create: {
        contractDocumentId: contract.id,
        memoDocumentId: memo.id,
        memoVersion: memo.currentVersion,
        acknowledgedByUserId: actor.userId,
      },
      update: {},
      include: {
        acknowledgedBy: { select: { id: true, name: true } },
      },
    });
    await tx.documentAudit.create({
      data: {
        documentId: contract.id,
        actorId: actor.userId,
        action: "CUSTOMER_MEMO_ACKNOWLEDGED",
        after: {
          memoDocumentId: memo.id,
          memoVersion: memo.currentVersion,
          acknowledgedAt: acknowledgement.acknowledgedAt.toISOString(),
        },
      },
    });
    return acknowledgement;
  });
}

export async function currentMemoAcknowledgement(contractDocumentId: number) {
  const memo = await memoDocumentForContract(contractDocumentId);
  if (!memo || memo.currentVersion <= 0) return null;
  return prisma.customerMemoAcknowledgement.findUnique({
    where: {
      contractDocumentId_memoVersion: {
        contractDocumentId,
        memoVersion: memo.currentVersion,
      },
    },
    include: { acknowledgedBy: { select: { id: true, name: true } } },
  });
}

export async function uploadSignedPackageDocument(
  documentId: number,
  actor: DocumentActor,
  file: File,
  comment?: string,
) {
  packageActor(actor);
  const document = await getDocument(documentId, actor);
  if (
    !document ||
    (document.type !== DocumentType.CONTRACT &&
      document.type !== DocumentType.CUSTOMER_MEMO)
  )
    throw new Error("NOT_FOUND");
  if (document.type === DocumentType.CONTRACT) {
    const acknowledgement = await currentMemoAcknowledgement(document.id);
    if (!acknowledgement) throw new Error("MEMO_ACKNOWLEDGEMENT_REQUIRED");
  }
  if (
    file.size <= 0 ||
    file.size > MAX_SIGNED_SIZE ||
    !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
  )
    throw new Error("INVALID_FILE_TYPE");
  const bytes = Buffer.from(await file.arrayBuffer());
  const valid =
    file.type === PDF_TYPE
      ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
      : file.type === "image/png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!valid) throw new Error("INVALID_FILE_TYPE");
  const extension =
    file.type === PDF_TYPE ? "pdf" : file.type === "image/png" ? "png" : "jpg";
  const pathname = `documents/contracts/${document.orderId}/${document.type.toLowerCase()}/signed/${randomUUID()}.${extension}`;
  const blob = await put(pathname, bytes, {
    access: "private",
    contentType: file.type,
    addRandomSuffix: false,
    allowOverwrite: false,
    maximumSizeInBytes: MAX_SIGNED_SIZE,
  });
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.SIGNED,
        signedAt: new Date(),
        signedComment: comment?.trim().slice(0, 1000) || null,
        signedFileName: file.name.slice(0, 200),
        signedPathname: blob.pathname,
        signedContentType: file.type,
        signedSize: bytes.length,
        signedChecksum: checksum,
      },
    });
    await tx.documentAudit.create({
      data: {
        documentId,
        actorId: actor.userId,
        action:
          document.type === DocumentType.CONTRACT
            ? "SIGNED_COPY_UPLOADED"
            : "SIGNED_MEMO_UPLOADED",
        before: { status: document.status },
        after: { status: DocumentStatus.SIGNED, checksum },
        comment: comment?.trim().slice(0, 1000) || null,
      },
    });
    return updated;
  });
}

export async function getContractPackage(orderId: number, actor: DocumentActor) {
  const accessible = await prisma.document.findFirst({
    where: {
      id: {
        in: (
          await prisma.document.findMany({
            where: { orderId, type: DocumentType.CONTRACT },
            select: { id: true },
          })
        ).map((item) => item.id),
      },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (!accessible) return null;
  const contract = await getDocument(accessible.id, actor);
  if (!contract) return null;
  const [memo, acknowledgement, receipts] = await Promise.all([
    memoDocumentForContract(contract.id),
    currentMemoAcknowledgement(contract.id),
    prisma.paymentReceipt.findMany({
      where: { orderId },
      include: {
        cashShift: {
          include: { responsibleManager: { select: { id: true, name: true, employeeCode: true } } },
        },
        document: {
          include: { versions: { orderBy: { version: "desc" }, take: 1 } },
        },
      },
      orderBy: { receiptNumber: "asc" },
    }),
  ]);
  return { contract, memo, acknowledgement, receipts };
}

export async function downloadContractPackage(
  orderId: number,
  actor: DocumentActor,
) {
  const packageData = await getContractPackage(orderId, actor);
  if (!packageData) throw new Error("NOT_FOUND");
  const zip = new JSZip();
  const addPath = async (folder: string, fileName: string, pathname: string) =>
    zip.file(`${folder}/${fileName}`, await privateBlobBytes(pathname));
  const currentContract = await prisma.documentVersion.findUnique({
    where: {
      documentId_version: {
        documentId: packageData.contract.id,
        version: packageData.contract.currentVersion,
      },
    },
  });
  if (currentContract) {
    await addPath("Договор", currentContract.fileName, currentContract.pathname);
    if (currentContract.pdfPathname && currentContract.pdfFileName)
      await addPath("Договор", currentContract.pdfFileName, currentContract.pdfPathname);
  }
  const memoVersion = packageData.memo?.versions[0];
  if (memoVersion)
    await addPath("Памятка", memoVersion.fileName, memoVersion.pathname);
  for (const receipt of packageData.receipts) {
    const version = receipt.document.versions[0];
    if (version)
      await addPath("Квитанции", version.fileName, version.pathname);
  }
  for (const document of [packageData.contract, packageData.memo]) {
    if (
      document?.signedPathname &&
      document.signedFileName
    )
      await addPath("Подписанные", document.signedFileName, document.signedPathname);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
