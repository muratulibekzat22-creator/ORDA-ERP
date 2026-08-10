import "./require-test-database";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

import { DocumentSource, DocumentStatus, DocumentType, PaymentReceiptStatus, Prisma, Role } from "@prisma/client";

import { buildCustomerMemoPdf, CUSTOMER_MEMO_TEMPLATE_VERSION } from "@/lib/documents/customer-memo-pdf";
import { buildPaymentReceiptPdf, type PaymentReceiptSnapshot } from "@/lib/documents/payment-receipt-pdf";
import { countPdfPages, pdfBuffer } from "@/lib/documents/pdf-utils";
import { put } from "@/lib/private-blob";
import { prisma } from "@/lib/prisma";
import {
  acknowledgeCustomerMemo,
  currentMemoAcknowledgement,
  ensureContractPdf,
  uploadSignedPackageDocument,
} from "@/lib/services/contract-package.service";
import { getSignedContractContent } from "@/lib/services/contract.service";
import { getDocument, type DocumentActor } from "@/lib/services/document.service";
import {
  convertDocxToPdf,
  GotenbergError,
} from "@/lib/services/gotenberg.service";
import { createFinanceOperation, reverseFinanceOperation } from "@/lib/services/payment.service";
import {
  closeCashShift,
  paymentMethodLabel,
  paymentReceiptPublicProjection,
} from "@/lib/services/payment-receipt.service";

const tag = `contract-package-${Date.now()}`;
const operationDate = new Date("2026-08-10T08:30:00.000Z");

function actor(user: { id: number; name: string; role: Role }): DocumentActor {
  return { userId: user.id, name: user.name, role: user.role };
}

async function main() {
  assert.equal(await prisma.paymentReceipt.count(), 0, "receipt sequence test requires an empty dedicated test database");
  assert.equal(await prisma.cashShift.count(), 0, "shift sequence test requires an empty dedicated test database");
  assert(process.env.TEST_BLOB_DIR, "TEST_BLOB_DIR is required for isolated document integration");
  process.env.NEXTAUTH_URL = "https://orda.test.invalid";
  delete process.env.BLOB_READ_WRITE_TOKEN;

  process.env.GOTENBERG_URL = "http://converter.example.test";
  process.env.GOTENBERG_TOKEN = "local-test-token";
  await assert.rejects(
    convertDocxToPdf({ bytes: Buffer.from("not-sent"), fileName: "contract.docx" }),
    (error: unknown) =>
      error instanceof GotenbergError &&
      error.message === "CONVERTER_HTTPS_REQUIRED",
    "non-local HTTP converter URL was accepted",
  );
  delete process.env.GOTENBERG_URL;
  delete process.env.GOTENBERG_TOKEN;

  await prisma.companySettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      name: "ALTYN SAPA COMPANY",
      bin: "220540017969",
      actualAddress: "г. Алматы",
      phone: "+77085750881",
      secondaryPhone: "+77760027555",
    },
    update: {
      name: "ALTYN SAPA COMPANY",
      bin: "220540017969",
      actualAddress: "г. Алматы",
      phone: "+77085750881",
      secondaryPhone: "+77760027555",
    },
  });
  const [director, manager, otherManager, accountant, measurer] = await Promise.all([
    prisma.user.create({ data: { name: "Директор", email: `${tag}-director@example.test`, password: "local-test-hash", role: Role.DIRECTOR } }),
    prisma.user.create({ data: { name: "Гулсим", email: `${tag}-manager@example.test`, password: "local-test-hash", role: Role.MANAGER } }),
    prisma.user.create({ data: { name: "Другой менеджер", email: `${tag}-other@example.test`, password: "local-test-hash", role: Role.MANAGER } }),
    prisma.user.create({ data: { name: "Бухгалтер", email: `${tag}-accountant@example.test`, password: "local-test-hash", role: Role.ACCOUNTANT } }),
    prisma.user.create({ data: { name: "Замерщик", email: `${tag}-measurer@example.test`, password: "local-test-hash", role: Role.MEASURER } }),
  ]);
  const client = await prisma.client.create({
    data: {
      name: "Алиев Талгат Серикович",
      phone: "+77000000001",
      whatsapp: "+77000000001",
      city: "Алматы",
      address: "Скрытый адрес 1",
      iin: "900101300001",
      manager: manager.name,
      managerUserId: manager.id,
      amount: "100000000",
      status: "TEST",
    },
  });
  const order = await prisma.order.create({
    data: {
      number: `${tag}-ORDER`,
      clientId: client.id,
      address: "Алматы",
      staircase: "Металлический каркас",
      material: "Дуб ламель",
      railingType: "Стеклянное ограждение",
      supportType: "Стандарт",
      color: "Орех",
      lighting: true,
      lightingDetails: "LED",
      cladding: true,
      claddingDetails: "Дуб",
      additionalDetails: "Монтаж",
      amount: new Prisma.Decimal(100_000_000),
      prepayment: new Prisma.Decimal(0),
      balance: new Prisma.Decimal(100_000_000),
      manager: manager.name,
      managerUserId: manager.id,
    },
  });
  const contract = await prisma.document.create({
    data: {
      orderId: order.id,
      clientId: client.id,
      type: DocumentType.CONTRACT,
      number: `${tag}-CONTRACT`,
      title: "Договор",
      documentDate: operationDate,
      status: DocumentStatus.READY,
      source: DocumentSource.GENERATED_ORDER,
      authorId: manager.id,
      currentVersion: 1,
      templateVersion: "ALTYN_SAPA_CONTRACT_PACKAGE_V2",
      snapshot: {
        contractAmountNumeric: 100_000_000,
        stairMaterial: "Дуб ламель",
        frameType: "Металлический каркас",
        balusterType: "Стеклянное ограждение",
        installationText: "Включён",
      },
    },
  });
  const contractDocx = await readFile("resources/documents/templates/contract-altyn-sapa-v2.docx");
  const contractPathname = `local-test/${tag}/contract.docx`;
  await put(contractPathname, contractDocx, {
    access: "private",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  const contractVersion = await prisma.documentVersion.create({
    data: {
      documentId: contract.id,
      version: 1,
      uploadedById: manager.id,
      fileName: "contract.docx",
      pathname: contractPathname,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: contractDocx.length,
      checksum: "b".repeat(64),
      templateVersion: "ALTYN_SAPA_CONTRACT_PACKAGE_V2",
    },
  });
  const converterPdf = await pdfBuffer({ size: "A4", margin: 30 }, (document) => {
    document.font("DejaVu").fontSize(12).text("Страница 1");
    document.addPage({ size: "A4", margin: 30 }).font("DejaVu").fontSize(12).text("Страница 2");
  });
  assert.equal(countPdfPages(converterPdf), 2);
  let converterCalls = 0;
  const converter = createServer((request, response) => {
    assert.equal(request.url, "/forms/libreoffice/convert");
    assert.equal(request.headers.authorization, "Bearer local-test-token");
    request.resume();
    request.on("end", () => {
      converterCalls += 1;
      response.writeHead(200, { "Content-Type": "application/pdf" });
      response.end(converterPdf);
    });
  });
  await new Promise<void>((resolve) => converter.listen(0, "127.0.0.1", resolve));
  const address = converter.address();
  assert(address && typeof address !== "string");
  process.env.GOTENBERG_URL = `http://127.0.0.1:${address.port}`;
  process.env.GOTENBERG_TOKEN = "local-test-token";
  try {
    const converted = await ensureContractPdf(contract.id, actor(manager));
    assert.equal(converted.id, contractVersion.id);
    assert.equal(converted.pdfStatus, "READY");
    assert(converted.pdfPathname && converted.pdfChecksum);
    const repeated = await ensureContractPdf(contract.id, actor(manager));
    assert.equal(repeated.id, contractVersion.id);
    assert.equal(converterCalls, 1, "PDF retry created another conversion/blob");
  } finally {
    await new Promise<void>((resolve, reject) => converter.close((error) => error ? reject(error) : resolve()));
    delete process.env.GOTENBERG_URL;
    delete process.env.GOTENBERG_TOKEN;
  }

  async function payment(amount: number, suffix: string) {
    const result = await createFinanceOperation({
      type: "CLIENT_PAYMENT",
      orderId: order.id,
      amount,
      method: "Kaspi перевод",
      author: director.name,
      authorId: director.id,
      operationDate,
      idempotencyKey: `${tag}-${suffix}`,
      requestHash: `${tag}-${suffix}-hash`,
    });
    assert(result, `payment ${suffix} was not created`);
    return result;
  }

  const first = await payment(1_000_000, "payment-1");
  const second = await payment(500_000, "payment-2");
  const [firstReceipt, secondReceipt] = await Promise.all([
    prisma.paymentReceipt.findUniqueOrThrow({ where: { paymentId: first.payment.id }, include: { cashShift: true } }),
    prisma.paymentReceipt.findUniqueOrThrow({ where: { paymentId: second.payment.id }, include: { cashShift: true } }),
  ]);
  assert.equal(firstReceipt.receiptNumber, 10256);
  assert.equal(secondReceipt.receiptNumber, 10257);
  assert.equal(firstReceipt.cashShift.shiftNumber, 8001);
  assert.equal(secondReceipt.cashShiftId, firstReceipt.cashShiftId);
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: firstReceipt.documentId } })).currentVersion, 1);

  const replay = await payment(1_000_000, "payment-1");
  assert.equal(replay.payment.id, first.payment.id);
  assert.equal(await prisma.paymentReceipt.count({ where: { paymentId: first.payment.id } }), 1);

  await assert.rejects(() => closeCashShift(firstReceipt.cashShiftId, actor(manager)), /FORBIDDEN/);
  await closeCashShift(firstReceipt.cashShiftId, actor(director));
  const third = await payment(250_000, "payment-3");
  const thirdReceipt = await prisma.paymentReceipt.findUniqueOrThrow({ where: { paymentId: third.payment.id }, include: { cashShift: true } });
  assert.equal(thirdReceipt.cashShift.shiftNumber, 8002);
  assert.notEqual(thirdReceipt.cashShiftId, firstReceipt.cashShiftId);

  const parallel = await Promise.all(
    Array.from({ length: 20 }, (_, index) => payment(100, `parallel-${index}`)),
  );
  const parallelReceipts = await prisma.paymentReceipt.findMany({
    where: { paymentId: { in: parallel.map((item) => item.payment.id) } },
    select: { receiptNumber: true },
  });
  assert.equal(parallelReceipts.length, 20);
  assert.equal(new Set(parallelReceipts.map((item) => item.receiptNumber)).size, 20);

  const persistedFirst = await prisma.paymentReceipt.findUniqueOrThrow({
    where: { id: firstReceipt.id },
    include: { payment: true, cashShift: true },
  });
  const firstSnapshot = persistedFirst.snapshot as unknown as PaymentReceiptSnapshot;
  assert.equal(persistedFirst.cashShift.responsibleManagerId, manager.id);
  assert.equal(persistedFirst.payment.registeredByUserId, director.id);
  assert.equal(firstSnapshot.responsibleManager.name, manager.name);
  assert.equal(firstSnapshot.registeredBy.userId, director.id);
  assert.equal(firstSnapshot.totals.paidAfter, 1_000_000);
  assert.equal(firstSnapshot.totals.remaining, 99_000_000);
  assert.equal(firstSnapshot.payment.methodLabel, "Kaspi перевод");
  assert.equal(paymentMethodLabel("Банковская карта"), "Банковская карта");
  assert(firstSnapshot.items.every((item) => !/себестоимость|цех|марж/u.test(item)));

  const publicReceipt = await paymentReceiptPublicProjection(secondReceipt.verificationToken);
  assert(publicReceipt);
  const publicJson = JSON.stringify(publicReceipt);
  assert(!publicJson.includes(client.phone));
  assert(!publicJson.includes(client.iin));
  assert(!publicJson.includes(client.address));
  assert(!publicJson.includes(client.name));
  assert.equal(await paymentReceiptPublicProjection("invalid"), null);

  const receiptDocument = await prisma.document.findUniqueOrThrow({ where: { id: firstReceipt.documentId } });
  assert(await getDocument(receiptDocument.id, actor(director)));
  assert(await getDocument(receiptDocument.id, actor(manager)));
  assert(await getDocument(receiptDocument.id, actor(accountant)));
  assert.equal(await getDocument(receiptDocument.id, actor(otherManager)), null);
  assert.equal(await getDocument(receiptDocument.id, actor(measurer)), null);

  const orphanClient = await prisma.client.create({
    data: { name: "Без менеджера", phone: "+77000000002", city: "Алматы", manager: "", amount: "1000", status: "TEST" },
  });
  const orphanOrder = await prisma.order.create({
    data: { number: `${tag}-NO-MANAGER`, clientId: orphanClient.id, address: "Алматы", staircase: "Тест", material: "Тест", amount: 1000, balance: 1000, manager: "" },
  });
  await assert.rejects(
    () => createFinanceOperation({ type: "CLIENT_PAYMENT", orderId: orphanOrder.id, amount: 100, method: "Наличные", authorId: director.id, idempotencyKey: `${tag}-no-manager`, requestHash: `${tag}-no-manager-hash` }),
    /RESPONSIBLE_MANAGER_REQUIRED/,
  );
  assert.equal(await prisma.payment.count({ where: { idempotencyKey: `${tag}-no-manager` } }), 0);

  const memo = await prisma.document.create({
    data: {
      orderId: order.id,
      clientId: client.id,
      type: DocumentType.CUSTOMER_MEMO,
      number: `${contract.number}-ПАМ`,
      title: "Памятка заказчику",
      documentDate: operationDate,
      status: DocumentStatus.READY,
      source: DocumentSource.GENERATED_ORDER,
      authorId: manager.id,
      currentVersion: 1,
      templateVersion: CUSTOMER_MEMO_TEMPLATE_VERSION,
      snapshot: { contractDocumentId: contract.id, contractVersion: 1, templateVersion: CUSTOMER_MEMO_TEMPLATE_VERSION },
    },
  });
  await prisma.documentVersion.create({
    data: {
      documentId: memo.id,
      version: 1,
      uploadedById: manager.id,
      fileName: "memo.pdf",
      pathname: `local-test/${tag}/memo.pdf`,
      contentType: "application/pdf",
      size: 10,
      checksum: "a".repeat(64),
      templateVersion: CUSTOMER_MEMO_TEMPLATE_VERSION,
    },
  });
  const signedContract = new File([Buffer.from("%PDF-1.4\n")], "signed.pdf", { type: "application/pdf" });
  await assert.rejects(() => uploadSignedPackageDocument(contract.id, actor(manager), signedContract), /MEMO_ACKNOWLEDGEMENT_REQUIRED/);
  await acknowledgeCustomerMemo(contract.id, actor(manager));
  const acknowledgement = await currentMemoAcknowledgement(contract.id);
  assert(acknowledgement);
  assert.equal(acknowledgement.memoDocumentId, memo.id);
  assert.equal(acknowledgement.memoVersion, 1);
  const signedMemo = await uploadSignedPackageDocument(memo.id, actor(manager), signedContract, "Подписано клиентом");
  const signedContractResult = await uploadSignedPackageDocument(contract.id, actor(manager), signedContract, "Подписано сторонами");
  assert.equal(signedMemo.status, DocumentStatus.SIGNED);
  assert.equal(signedContractResult.status, DocumentStatus.SIGNED);
  assert(await getSignedContractContent(memo.id, actor(manager)));
  assert(await getSignedContractContent(contract.id, actor(manager)));

  const memoPdf = await buildCustomerMemoPdf({
    templateVersion: CUSTOMER_MEMO_TEMPLATE_VERSION,
    orderNumber: order.number,
    contractNumber: contract.number,
    clientFullName: client.name,
    installationAddress: order.address,
    productionContactName: "Ответственный",
    productionContactPhone: "+7 700 000 00 00",
    companyName: "ALTYN SAPA COMPANY",
    companyPhones: ["+7 708 575 0881", "+7 776 002 7555"],
    createdAt: operationDate.toISOString(),
  });
  assert.equal(countPdfPages(memoPdf), 1);
  const receiptPdf = await buildPaymentReceiptPdf(firstSnapshot, "https://orda.test.invalid");
  assert.equal(countPdfPages(receiptPdf), 1);
  assert.equal(receiptPdf.subarray(0, 5).toString("ascii"), "%PDF-");

  await reverseFinanceOperation({
    paymentId: first.payment.id,
    reason: "Тестовое сторно",
    authorId: director.id,
    author: director.name,
    idempotencyKey: `${tag}-reversal`,
    requestHash: `${tag}-reversal-hash`,
  });
  const voided = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: firstReceipt.id } });
  assert.equal(voided.status, PaymentReceiptStatus.VOID);
  assert(voided.voidedAt);
  assert.equal(voided.voidReason, "Тестовое сторно");
  assert.equal(voided.receiptNumber, 10256);
  assert.equal((await paymentReceiptPublicProjection(voided.verificationToken))?.status, "VOID");

  const receiptNumbers = (await prisma.paymentReceipt.findMany({ select: { receiptNumber: true } })).map((item) => item.receiptNumber);
  assert.equal(new Set(receiptNumbers).size, receiptNumbers.length);
  console.log("contract document package: sequences, shifts, receipt idempotency/concurrency, responsible manager, RBAC, QR projection, memo acknowledgement, one-page PDFs and void passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
