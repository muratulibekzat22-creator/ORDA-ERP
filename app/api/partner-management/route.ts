import {
  PartnerBusinessStatus,
  PartnerBusinessType,
  PartnerRewardRule,
  PartnerSettlementOperationType,
  PartnerSettlementStatus,
  Role,
} from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import {
  createManagedPartner,
  createPartnerOrder,
  createPartnerPayoutForOrder,
  createPartnerSettlementOperation,
  getPartnerManagementReadModel,
  linkPartnerOrder,
  linkHistoricalPartnerPayment,
  PartnerManagementError,
  reversePartnerSettlementOperation,
  searchPartnerClients,
  searchPartnerOrders,
  setPartnerAgreedCost,
  setOrderPartnerAgreement,
  setPartnerSettlementState,
  updateManagedPartner,
  type PartnerManagementActor,
} from "@/lib/services/partner-management.service";
import { enterTenantFromSession } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;

const asString = (value: unknown) => typeof value === "string" ? value : undefined;
const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};
const asDate = (value: unknown) => {
  if (!value) return undefined;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};
const enumValue = <T extends string>(values: readonly T[], value: unknown) =>
  typeof value === "string" && values.includes(value as T) ? value as T : undefined;

function actor(session: { user: { id: string; role?: string; name?: string | null } }): PartnerManagementActor {
  return {
    userId: Number(session.user.id),
    role: session.user.role as Role,
    name: session.user.name?.trim() || "Директор",
  };
}

async function directorAuth() {
  const auth = await requirePermission("partners");
  if (auth.response) return { response: auth.response };
  if (auth.session!.user.role !== Role.DIRECTOR)
    return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  return { session: auth.session! };
}

function reward(body: Body) {
  return {
    rewardRule: enumValue(Object.values(PartnerRewardRule), body.rewardRule),
    rewardPercent: body.rewardPercent == null || body.rewardPercent === "" ? null : String(body.rewardPercent),
    fixedAmount: body.fixedAmount == null || body.fixedAmount === "" ? null : String(body.fixedAmount),
    manualAmount: body.manualAmount == null || body.manualAmount === "" ? null : String(body.manualAmount),
  };
}

function errorResponse(error: unknown) {
  if (error instanceof PartnerManagementError) {
    const notFound = ["PARTNER_NOT_FOUND", "ORDER_NOT_FOUND", "RELATION_NOT_FOUND", "OPERATION_NOT_FOUND", "MANAGER_NOT_FOUND", "PAYMENT_NOT_FOUND"];
    const conflict = [
      "ORDER_ALREADY_LINKED", "ORDER_ALREADY_HAS_PRIMARY_PARTNER", "IDEMPOTENCY_CONFLICT", "ALREADY_REVERSED",
      "SETTLEMENT_HAS_BALANCE", "PAYMENT_ALREADY_LINKED", "PAYMENT_ORDER_MISMATCH", "PAYMENT_PARTNER_MISMATCH",
      "ORDER_PARTNER_MISMATCH", "PARTNER_REASSIGNMENT_WITH_PAYMENTS",
    ];
    return NextResponse.json(
      { error: error.message },
      { status: error.message === "FORBIDDEN" ? 403 : notFound.includes(error.message) ? 404 : conflict.includes(error.message) ? 409 : 400 },
    );
  }
  console.error("Partner management request failed", error instanceof Error ? error.message : "UNKNOWN_ERROR");
  return NextResponse.json({ error: "Не удалось выполнить операцию" }, { status: 500 });
}

export async function GET(request: Request) {
  const auth = await directorAuth();
  if (auth.response) return auth.response;
  if (!enterTenantFromSession(auth.session)) return NextResponse.json({ error: "Сессия завершена" }, { status: 401 });
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view");
    const query = url.searchParams.get("q") ?? "";
    if (view === "search-orders") return NextResponse.json(await searchPartnerOrders(query), { headers: { "cache-control": "no-store" } });
    if (view === "search-clients") return NextResponse.json(await searchPartnerClients(query), { headers: { "cache-control": "no-store" } });
    const partnerId = asNumber(url.searchParams.get("partnerId"));
    const orderId = asNumber(url.searchParams.get("orderId"));
    const settlementStatus = enumValue(Object.values(PartnerSettlementStatus), url.searchParams.get("settlementStatus"));
    const debt = enumValue(["company", "partner", "any"] as const, url.searchParams.get("debt"));
    const scope = enumValue(["active", "completed", "all", "with_partner", "without_partner", "without_cost"] as const, url.searchParams.get("scope"));
    const clientStatus = enumValue(["UNPAID", "PARTIAL", "PAID", "OVERPAID", "OVERDUE"] as const, url.searchParams.get("clientStatus"));
    const partnerStatus = enumValue(["NOT_ASSIGNED", "COST_MISSING", "NOT_ACCRUED", "PAYABLE", "PARTIALLY_PAID", "PAID", "OVERPAID", "OVERDUE", "DISPUTED"] as const, url.searchParams.get("partnerStatus"));
    const profit = enumValue(["profitable", "loss", "highest_profit", "highest_margin", "lowest_margin"] as const, url.searchParams.get("profit"));
    const period = enumValue(["current_month", "previous_month", "quarter", "year", "custom", "all"] as const, url.searchParams.get("period"));
    const periodBasis = enumValue(["order", "completion", "finance"] as const, url.searchParams.get("periodBasis"));
    const sort = enumValue(["newest", "oldest", "sale_desc", "client_debt_desc", "partner_debt_desc", "profit_desc", "margin_desc", "margin_asc"] as const, url.searchParams.get("sort"));
    return NextResponse.json(await getPartnerManagementReadModel({
      partnerId,
      orderId,
      query: query || undefined,
      from: asDate(url.searchParams.get("from")),
      to: asDate(url.searchParams.get("to")),
      settlementStatus,
      debt,
      scope,
      clientStatus,
      partnerStatus,
      profit,
      period,
      periodBasis,
      sort,
      page: asNumber(url.searchParams.get("page")),
      pageSize: asNumber(url.searchParams.get("pageSize")),
    }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await directorAuth();
  if (auth.response) return auth.response;
  if (!enterTenantFromSession(auth.session)) return NextResponse.json({ error: "Сессия завершена" }, { status: 401 });
  let body: Body;
  try { body = await request.json() as Body; }
  catch { return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); }
  const action = asString(body.action);
  const user = actor(auth.session!);
  try {
    if (action === "create-partner") {
      const kind = enumValue(Object.values(PartnerBusinessType), body.kind);
      const rewardRule = enumValue(Object.values(PartnerRewardRule), body.rewardRule);
      if (!kind || !rewardRule) throw new PartnerManagementError("INVALID_PARTNER_CONFIGURATION");
      return NextResponse.json(await createManagedPartner({
        name: asString(body.name) ?? "", kind, phone: asString(body.phone), secondaryPhone: asString(body.secondaryPhone),
        email: asString(body.email), iinBin: asString(body.iinBin), city: asString(body.city), address: asString(body.address),
        bankDetails: asString(body.bankDetails), contactPerson: asString(body.contactPerson), cooperationStartedAt: asDate(body.cooperationStartedAt),
        defaultRewardRule: rewardRule,
        defaultRewardPercent: body.rewardPercent == null || body.rewardPercent === "" ? null : String(body.rewardPercent),
        defaultRewardFixedAmount: body.fixedAmount == null || body.fixedAmount === "" ? null : String(body.fixedAmount),
        businessStatus: enumValue(Object.values(PartnerBusinessStatus), body.businessStatus), comment: asString(body.comment),
      }, user), { status: 201 });
    }
    if (action === "update-partner") {
      const id = asNumber(body.partnerId);
      if (!id) throw new PartnerManagementError("PARTNER_NOT_FOUND");
      return NextResponse.json(await updateManagedPartner(id, {
        ...(body.name === undefined ? {} : { name: asString(body.name) ?? "" }),
        ...(body.kind === undefined ? {} : { kind: enumValue(Object.values(PartnerBusinessType), body.kind) }),
        ...(body.phone === undefined ? {} : { phone: asString(body.phone) ?? "" }),
        ...(body.secondaryPhone === undefined ? {} : { secondaryPhone: asString(body.secondaryPhone) ?? "" }),
        ...(body.email === undefined ? {} : { email: asString(body.email) ?? "" }),
        ...(body.iinBin === undefined ? {} : { iinBin: asString(body.iinBin) ?? "" }),
        ...(body.city === undefined ? {} : { city: asString(body.city) ?? "" }),
        ...(body.address === undefined ? {} : { address: asString(body.address) ?? "" }),
        ...(body.bankDetails === undefined ? {} : { bankDetails: asString(body.bankDetails) ?? "" }),
        ...(body.contactPerson === undefined ? {} : { contactPerson: asString(body.contactPerson) ?? "" }),
        ...(body.cooperationStartedAt === undefined ? {} : { cooperationStartedAt: asDate(body.cooperationStartedAt) ?? null }),
        ...(body.rewardRule === undefined ? {} : { defaultRewardRule: enumValue(Object.values(PartnerRewardRule), body.rewardRule) }),
        ...(body.rewardPercent === undefined ? {} : { defaultRewardPercent: body.rewardPercent === "" ? null : String(body.rewardPercent) }),
        ...(body.fixedAmount === undefined ? {} : { defaultRewardFixedAmount: body.fixedAmount === "" ? null : String(body.fixedAmount) }),
        ...(body.businessStatus === undefined ? {} : { businessStatus: enumValue(Object.values(PartnerBusinessStatus), body.businessStatus) }),
        ...(body.comment === undefined ? {} : { comment: asString(body.comment) ?? "" }),
      }, user));
    }
    if (action === "link-order") {
      const partnerId = asNumber(body.partnerId); const orderId = asNumber(body.orderId);
      if (!partnerId || !orderId) throw new PartnerManagementError("INVALID_LINK");
      const result = await linkPartnerOrder({
        partnerId,
        orderId,
        reward: reward(body),
        startsAt: asDate(body.startsAt) ?? asDate(body.agreedAt),
        workDueAt: asDate(body.workDueAt) ?? null,
        paymentDueAt: asDate(body.paymentDueAt) ?? null,
        comment: asString(body.comment),
      }, user);
      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    }
    if (action === "set-order-agreement") {
      const orderId = asNumber(body.orderId);
      const partnerId = asNumber(body.partnerId);
      if (!orderId || !partnerId) throw new PartnerManagementError("INVALID_LINK");
      return NextResponse.json(await setOrderPartnerAgreement({
        orderId,
        partnerId,
        amount: String(body.amount ?? "0"),
        agreedAt: asDate(body.agreedAt),
        workDueAt: asDate(body.workDueAt) ?? null,
        paymentDueAt: asDate(body.paymentDueAt) ?? null,
        comment: asString(body.comment),
      }, user));
    }
    if (action === "create-order") {
      const key = readIdempotencyKey(request); if ("response" in key) return key.response;
      const partnerId = asNumber(body.partnerId); if (!partnerId) throw new PartnerManagementError("PARTNER_NOT_FOUND");
      const initial = body.initialPayment && typeof body.initialPayment === "object" ? body.initialPayment as Body : undefined;
      const client = body.client && typeof body.client === "object" ? body.client as Body : undefined;
      const payload = { ...body, action: undefined };
      return NextResponse.json(await createPartnerOrder({
        partnerId, clientId: asNumber(body.clientId),
        client: client ? { name: asString(client.name) ?? "", phone: asString(client.phone) ?? "", secondaryPhone: asString(client.secondaryPhone), city: asString(client.city) ?? "", address: asString(client.address) ?? "", comment: asString(client.comment) } : undefined,
        staircase: asString(body.staircase) ?? "", material: asString(body.material) ?? "", description: asString(body.description), address: asString(body.address) ?? "",
        amount: String(body.amount ?? "0"), orderDate: asDate(body.orderDate), promisedAt: asDate(body.promisedAt) ?? null,
        managerUserId: asNumber(body.managerUserId), externalContractNumber: asString(body.externalContractNumber), status: asString(body.status), comment: asString(body.comment), reward: reward(body),
        initialPayment: initial ? { confirmed: initial.confirmed === true, amount: String(initial.amount ?? "0"), date: asDate(initial.date) ?? new Date(), receivedBy: asString(initial.receivedBy) ?? "", account: asString(initial.account) ?? "", method: asString(initial.method) ?? "other", comment: asString(initial.comment) } : undefined,
        idempotencyKey: key.key, requestHash: createRequestHash(payload),
      }, user), { status: 201 });
    }
    if (action === "operation") {
      const key = readIdempotencyKey(request); if ("response" in key) return key.response;
      const relationId = asNumber(body.relationId);
      const type = enumValue(Object.values(PartnerSettlementOperationType), body.type);
      if (!relationId || !type) throw new PartnerManagementError("INVALID_OPERATION");
      return NextResponse.json(await createPartnerSettlementOperation({
        relationId, type, amount: String(body.amount ?? "0"), adjustmentEffect: body.adjustmentEffect == null ? undefined : String(body.adjustmentEffect),
        operationDate: asDate(body.operationDate) ?? new Date(), method: asString(body.method), account: asString(body.account), comment: asString(body.comment),
        idempotencyKey: key.key, requestHash: createRequestHash(body),
      }, user), { status: 201 });
    }
    if (action === "partner-payout") {
      const key = readIdempotencyKey(request); if ("response" in key) return key.response;
      const orderId = asNumber(body.orderId);
      if (!orderId) throw new PartnerManagementError("ORDER_NOT_FOUND");
      return NextResponse.json(await createPartnerPayoutForOrder({
        orderId,
        amount: String(body.amount ?? "0"),
        operationDate: asDate(body.operationDate) ?? new Date(),
        method: asString(body.method) ?? "other",
        account: asString(body.account),
        comment: asString(body.comment),
        idempotencyKey: key.key,
        requestHash: createRequestHash(body),
      }, user), { status: 201 });
    }
    if (action === "link-historical-payment") {
      const key = readIdempotencyKey(request); if ("response" in key) return key.response;
      const paymentId = asNumber(body.paymentId);
      const orderId = asNumber(body.orderId);
      const partnerId = asNumber(body.partnerId);
      if (!paymentId || !orderId || !partnerId) throw new PartnerManagementError("INVALID_LINK");
      return NextResponse.json(await linkHistoricalPartnerPayment({
        paymentId,
        orderId,
        partnerId,
        comment: asString(body.comment) ?? "",
        idempotencyKey: key.key,
        requestHash: createRequestHash(body),
      }, user), { status: 201 });
    }
    if (action === "set-agreed-cost") {
      const relationId = asNumber(body.relationId);
      if (!relationId) throw new PartnerManagementError("RELATION_NOT_FOUND");
      return NextResponse.json(await setPartnerAgreedCost(
        relationId,
        String(body.amount ?? "0"),
        asString(body.comment) ?? "",
        user,
        {
          agreedAt: asDate(body.agreedAt),
          workDueAt: asDate(body.workDueAt) ?? null,
          paymentDueAt: asDate(body.paymentDueAt) ?? null,
        },
      ));
    }
    if (action === "reverse-operation") {
      const key = readIdempotencyKey(request); if ("response" in key) return key.response;
      const operationId = asNumber(body.operationId); if (!operationId) throw new PartnerManagementError("OPERATION_NOT_FOUND");
      return NextResponse.json(await reversePartnerSettlementOperation({ operationId, reason: asString(body.reason) ?? "", idempotencyKey: key.key, requestHash: createRequestHash(body) }, user), { status: 201 });
    }
    if (action === "settlement-state") {
      const relationId = asNumber(body.relationId);
      const state = enumValue(["DISPUTE", "CLOSE"] as const, body.state);
      if (!relationId || !state) throw new PartnerManagementError("INVALID_SETTLEMENT_STATE");
      return NextResponse.json(await setPartnerSettlementState(relationId, state, asString(body.comment) ?? "", user));
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
