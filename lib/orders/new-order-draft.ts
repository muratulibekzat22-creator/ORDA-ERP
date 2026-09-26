export type NewOrderFormValues = {
  clientName: string;
  phone: string;
  location: string;
  managerUserId: string;
  amount: string;
  initialPayment: string;
  paymentMethod: string;
  readinessDate: string;
  comment: string;
  frameType: string;
  material: string;
  railingType: string;
  color: string;
  lighting: boolean;
  lightingDetails: string;
  cladding: boolean;
  claddingDetails: string;
};

export type DraftClient = {
  id: number;
  name: string;
  phone: string;
  city: string;
  address: string;
  managerUserId?: number | null;
};

export type OrderDraftSubmission = {
  key: string;
  payload: string;
};

export type NewOrderDraft = {
  version: 1;
  userId: number;
  form: NewOrderFormValues;
  existingClient: DraftClient | null;
  submission: OrderDraftSubmission | null;
  updatedAt: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const EMPTY_NEW_ORDER_FORM: NewOrderFormValues = {
  clientName: "",
  phone: "",
  location: "",
  managerUserId: "",
  amount: "",
  initialPayment: "0",
  paymentMethod: "KASPI_TRANSFER",
  readinessDate: "",
  comment: "",
  frameType: "Металлический каркас",
  material: "",
  railingType: "",
  color: "",
  lighting: false,
  lightingDetails: "",
  cladding: false,
  claddingDetails: "",
};

export function newOrderDraftKey(userId: number) {
  return `orda:new-order-draft:v1:${userId}`;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function parseForm(value: unknown): NewOrderFormValues | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return {
    clientName: stringValue(candidate.clientName),
    phone: stringValue(candidate.phone),
    location: stringValue(candidate.location),
    managerUserId: stringValue(candidate.managerUserId),
    amount: stringValue(candidate.amount),
    initialPayment: stringValue(candidate.initialPayment, "0"),
    paymentMethod: stringValue(candidate.paymentMethod, "KASPI_TRANSFER"),
    readinessDate: stringValue(candidate.readinessDate),
    comment: stringValue(candidate.comment),
    frameType: stringValue(candidate.frameType, EMPTY_NEW_ORDER_FORM.frameType),
    material: stringValue(candidate.material),
    railingType: stringValue(candidate.railingType),
    color: stringValue(candidate.color),
    lighting: candidate.lighting === true,
    lightingDetails: stringValue(candidate.lightingDetails),
    cladding: candidate.cladding === true,
    claddingDetails: stringValue(candidate.claddingDetails),
  };
}

function parseClient(value: unknown): DraftClient | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!Number.isInteger(candidate.id) || Number(candidate.id) <= 0) return null;
  return {
    id: Number(candidate.id),
    name: stringValue(candidate.name),
    phone: stringValue(candidate.phone),
    city: stringValue(candidate.city),
    address: stringValue(candidate.address),
    managerUserId:
      candidate.managerUserId === null || Number.isInteger(candidate.managerUserId)
        ? (candidate.managerUserId as number | null)
        : undefined,
  };
}

function parseSubmission(value: unknown): OrderDraftSubmission | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.key === "string" && candidate.key.length > 0 &&
    typeof candidate.payload === "string"
    ? { key: candidate.key, payload: candidate.payload }
    : null;
}

export function readNewOrderDraft(storage: StorageLike, userId: number): NewOrderDraft | null {
  try {
    const raw = storage.getItem(newOrderDraftKey(userId));
    if (!raw) return null;
    const candidate = JSON.parse(raw) as Record<string, unknown>;
    const form = parseForm(candidate.form);
    if (candidate.version !== 1 || candidate.userId !== userId || !form) return null;
    return {
      version: 1,
      userId,
      form,
      existingClient: parseClient(candidate.existingClient),
      submission: parseSubmission(candidate.submission),
      updatedAt: stringValue(candidate.updatedAt),
    };
  } catch {
    return null;
  }
}

export function writeNewOrderDraft(storage: StorageLike, draft: NewOrderDraft) {
  try {
    storage.setItem(newOrderDraftKey(draft.userId), JSON.stringify(draft));
  } catch {
    // A storage quota/privacy failure must not block order creation.
  }
}

export function clearNewOrderDraft(storage: StorageLike, userId: number) {
  try {
    storage.removeItem(newOrderDraftKey(userId));
  } catch {
    // A storage failure must not turn a successful order into an error.
  }
}

export function resolveOrderSubmission(
  current: OrderDraftSubmission | null,
  payload: string,
  createKey: () => string,
): OrderDraftSubmission {
  return current?.payload === payload ? current : { key: createKey(), payload };
}
