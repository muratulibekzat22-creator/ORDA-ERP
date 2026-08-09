import "./require-test-database";

import assert from "node:assert/strict";
import { del } from "@vercel/blob";
import { DocumentType, MeasurementPhotoType, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDocumentVersion, allowedDocumentTypes, createDocument, getDocument, getDocuments, getDocumentVersionContent, MAX_DOCUMENT_SIZE } from "@/lib/services/document.service";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Documents integration requires DATABASE_URL=TEST_DATABASE_URL");

const tag = `documents-${Date.now()}`;
const emails = (role: string) => `${tag}-${role.toLowerCase()}@test.local`;
const blobPaths: string[] = [];

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: "documents-", endsWith: "@test.local" } }, select: { id: true } });
  const userIds = users.map((item) => item.id);
  if (!userIds.length) return;
  const clients = await prisma.client.findMany({ where: { managerUserId: { in: userIds } }, select: { id: true } });
  const clientIds = clients.map((item) => item.id);
  const orders = await prisma.order.findMany({ where: { clientId: { in: clientIds } }, select: { id: true } });
  const orderIds = orders.map((item) => item.id);
  const documents = await prisma.document.findMany({ where: { OR: [{ clientId: { in: clientIds } }, { orderId: { in: orderIds } }] }, select: { id: true, versions: { select: { pathname: true } } } });
  const documentIds = documents.map((item) => item.id);
  blobPaths.push(...documents.flatMap((item) => item.versions.map((version) => version.pathname)));
  if (documentIds.length) { await prisma.documentAudit.deleteMany({ where: { documentId: { in: documentIds } } }); await prisma.documentVersion.deleteMany({ where: { documentId: { in: documentIds } } }); await prisma.attachment.updateMany({ where: { documentId: { in: documentIds } }, data: { documentId: null } }); await prisma.document.deleteMany({ where: { id: { in: documentIds } } }); }
  await prisma.orderInstallation.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.production.deleteMany({ where: { orderId: { in: orderIds } } });
  const measurements = await prisma.measurement.findMany({ where: { clientId: { in: clientIds } }, select: { id: true } });
  const measurementIds = measurements.map((item) => item.id);
  if (measurementIds.length) { await prisma.measurementAttachment.deleteMany({ where: { measurementId: { in: measurementIds } } }); await prisma.measurementAudit.deleteMany({ where: { measurementId: { in: measurementIds } } }); await prisma.measurement.deleteMany({ where: { id: { in: measurementIds } } }); }
  await prisma.commercialProposal.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.leadCalculation.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.attachment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (blobPaths.length) await del([...new Set(blobPaths)]).catch(() => undefined);
  blobPaths.length = 0;
}

const actor = (user: { id: number; name: string; role: Role }) => ({ userId: user.id, name: user.name, role: user.role });
async function main() {
  await cleanup();
  const password = "not-used-in-service-test";
  const roles = [Role.DIRECTOR, Role.MANAGER, Role.MANAGER, Role.ACCOUNTANT, Role.PRODUCTION, Role.INSTALLER, Role.MEASURER];
  const users = [];
  for (let index = 0; index < roles.length; index += 1) users.push(await prisma.user.create({ data: { name: `${tag}-${roles[index]}-${index}`, email: emails(`${roles[index]}-${index}`), password, role: roles[index] } }));
  const [director, managerA, managerB, accountant, production, installer, measurer] = users;
  const clientA = await prisma.client.create({ data: { name: `${tag}-client-a`, phone: "+77010000001", city: "Test", manager: managerA.name, managerUserId: managerA.id, amount: "0", status: "NEW" } });
  const clientB = await prisma.client.create({ data: { name: `${tag}-client-b`, phone: "+77010000002", city: "Test", manager: managerB.name, managerUserId: managerB.id, amount: "0", status: "NEW" } });
  const orderA = await prisma.order.create({ data: { number: `${tag}-A`, clientId: clientA.id, address: "Test", staircase: "Test", material: "Test", amount: 1000, manager: managerA.name, managerUserId: managerA.id } });
  await prisma.order.create({ data: { number: `${tag}-B`, clientId: clientB.id, address: "Test", staircase: "Test", material: "Test", amount: 2000, manager: managerB.name, managerUserId: managerB.id } });
  await prisma.production.create({ data: { orderId: orderA.id, stage: "Test", master: production.name, masterUserId: production.id } });
  await prisma.orderInstallation.create({ data: { orderId: orderA.id, scheduledAt: new Date(), installerUserId: installer.id } });
  const measurement = await prisma.measurement.create({ data: { clientId: clientA.id, orderId: orderA.id, measurer: measurer.name, measurerUserId: measurer.id, visitDate: new Date() } });
  await prisma.measurementAttachment.create({ data: { measurementId: measurement.id, type: MeasurementPhotoType.SHEET, uploadedById: measurer.id, fileName: "sheet.jpg", pathname: `${tag}/linked-sheet.jpg`, contentType: "image/jpeg", size: 3 } });
  const calculation = await prisma.leadCalculation.create({ data: { clientId: clientA.id, material: "Test", baseClientPrice: 1000, clientPrice: 1000, internalCost: 500, snapshot: {}, authorId: managerA.id, authorName: managerA.name } });
  const proposal = await prisma.commercialProposal.create({ data: { clientId: clientA.id, calculationId: calculation.id, number: `${tag}-KP`, snapshot: {}, validUntil: new Date(Date.now() + 86_400_000), executionTerm: "30", paymentTerms: "50/50", warranty: "12", managerContact: managerA.name, createdById: managerA.id, createdByName: managerA.name } });

  const pdf1 = new File([Buffer.from("%PDF-1.4\n%%EOF")], "../../contract.pdf", { type: "application/pdf" });
  const created = await createDocument({ clientId: clientA.id, orderId: orderA.id, type: DocumentType.CONTRACT, title: "Договор", documentDate: new Date(), file: pdf1, idempotencyKey: `${tag}-v1`, requestHash: `${tag}-hash-v1`, actor: actor(managerA) });
  assert(created?.created && created.document.currentVersion === 1, "v1 was not created");
  assert(!created.document.versions[0].fileName.includes("/"), "filename traversal was not sanitized");
  const v2 = await addDocumentVersion(created.document.id, actor(managerA), new File([Buffer.from("%PDF-1.4\nv2\n%%EOF")], "contract-v2.pdf", { type: "application/pdf" }), "Исправлены реквизиты");
  assert(v2?.version === 2, "v2 was not created"); blobPaths.push(v2!.pathname);
  const detail = await getDocument(created.document.id, actor(director));
  assert.equal(detail?.currentVersion, 2); assert.deepEqual(detail?.versions.map((item) => item.version), [2, 1]);
  assert.equal(await getDocument(created.document.id, actor(managerB)), null, "manager read IDOR");
  assert.equal(await getDocumentVersionContent(v2!.id, actor(managerB)), null, "version download IDOR");

  const project = await createDocument({ orderId: orderA.id, type: DocumentType.PROJECT, title: "Проект", documentDate: new Date(), idempotencyKey: `${tag}-project`, requestHash: `${tag}-project-hash`, actor: actor(managerA) });
  const invoice = await createDocument({ orderId: orderA.id, type: DocumentType.INVOICE, title: "Счёт", documentDate: new Date(), idempotencyKey: `${tag}-invoice`, requestHash: `${tag}-invoice-hash`, actor: actor(managerA) });
  assert(project && invoice);
  const payment = await prisma.payment.create({ data: { orderId: orderA.id, amount: 150, type: "CLIENT_PAYMENT", method: "bank_transfer", operationDate: new Date("2026-08-09T07:00:00.000Z") } });
  const receipt = await createDocument({ orderId: orderA.id, paymentId: payment.id, type: DocumentType.PAYMENT_RECEIPT, title: "Подтверждение оплаты", documentDate: new Date(), file: new File([Buffer.from("%PDF-1.4\n%%EOF")], "payment.pdf", { type: "application/pdf" }), idempotencyKey: `${tag}-payment-document`, requestHash: `${tag}-payment-document-hash`, actor: actor(managerA) });
  assert.equal(receipt?.document.paymentId, payment.id, "payment confirmation is not linked to Payment");
  assert.equal(await prisma.payment.count({ where: { orderId: orderA.id } }), 1, "payment confirmation duplicated the financial operation");
  await assert.rejects(() => createDocument({ orderId: orderA.id, paymentId: payment.id, type: DocumentType.ACT, title: "Unsafe payment relation", documentDate: new Date(), idempotencyKey: `${tag}-unsafe-payment-link`, requestHash: `${tag}-unsafe-payment-link-hash`, actor: actor(managerA) }), /ENTITY_MISMATCH/);
  assert((await getDocuments(actor(accountant))).every((item) => item.type === DocumentType.INVOICE || item.type === DocumentType.PAYMENT_RECEIPT), "accountant scope leaked non-financial docs");
  const productionRows = await getDocuments(actor(production), { orderId: orderA.id });
  assert(productionRows.some((item) => item.type === DocumentType.PROJECT) && productionRows.every((item) => item.type !== DocumentType.CONTRACT && item.type !== DocumentType.INVOICE), "production scope is incorrect");
  const installerRows = await getDocuments(actor(installer), { orderId: orderA.id });
  assert(installerRows.some((item) => item.type === DocumentType.PROJECT) && installerRows.every((item) => item.type !== DocumentType.INVOICE), "installer scope leaked finance");
  const measurerRows = await getDocuments(actor(measurer), { orderId: orderA.id });
  assert(measurerRows.some((item) => item.recordKind === "MEASUREMENT_ATTACHMENT") && measurerRows.every((item) => item.type !== DocumentType.CONTRACT && item.type !== DocumentType.INVOICE), "measurer scope/integration is incorrect");
  const managerRows = await getDocuments(actor(managerA), { clientId: clientA.id });
  assert(managerRows.some((item) => item.recordKind === "PROPOSAL" && item.id === `proposal-${proposal.id}`), "proposal read model missing");
  assert.equal(await prisma.measurementAttachment.count({ where: { measurementId: measurement.id } }), 1, "measurement file was duplicated");
  assert(!allowedDocumentTypes(actor(measurer)).includes(DocumentType.CONTRACT), "measurer can create/see contracts");
  await assert.rejects(() => createDocument({ orderId: orderA.id, type: DocumentType.CONTRACT, title: "Unsafe", documentDate: new Date(), file: new File([Buffer.from("MZ")], "unsafe.pdf", { type: "application/pdf" }), idempotencyKey: `${tag}-unsafe`, requestHash: `${tag}-unsafe-hash`, actor: actor(managerA) }), /INVALID_FILE_TYPE/);
  await assert.rejects(() => createDocument({ orderId: orderA.id, type: DocumentType.CONTRACT, title: "Oversized", documentDate: new Date(), file: new File([new Uint8Array(MAX_DOCUMENT_SIZE + 1)], "large.pdf", { type: "application/pdf" }), idempotencyKey: `${tag}-large`, requestHash: `${tag}-large-hash`, actor: actor(managerA) }), /INVALID_FILE_TYPE/);
  console.log("documents module: RBAC, IDOR, v1/v2, linked proposal/measurement, MIME and filename checks passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await cleanup(); await prisma.$disconnect(); });
