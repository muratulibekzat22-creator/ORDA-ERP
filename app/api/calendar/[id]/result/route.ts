import { NextResponse } from "next/server";
import { CalendarTaskWorkflow } from "@prisma/client";

import { calendarActor } from "@/lib/calendar-api";
import { createRequestHash } from "@/lib/idempotency";
import { requireMandatoryTaskSession } from "@/lib/mandatory-task-auth";
import { prisma } from "@/lib/prisma";
import { completeMandatoryTaskResultInTransaction, submitMandatoryTaskResult } from "@/lib/services/mandatory-task.service";
import { createPayment } from "@/lib/services/payment.service";

const paymentMethods = new Set([
  "Наличные",
  "Kaspi",
  "Kaspi перевод",
  "Kaspi рассрочка",
  "Банковский перевод",
  "Банковская карта",
  "Карта",
  "Другое",
]);
const paymentOutcomes = new Set(["PAID", "PROMISED_LATER", "NO_RESPONSE", "REFUSED"]);
const paymentOutcomeLabels: Record<string, string> = {
  PROMISED_LATER: "Клиент перенёс срок оплаты",
  NO_RESPONSE: "Клиент не ответил",
  REFUSED: "Клиент отказался от оплаты",
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireMandatoryTaskSession();
  if (auth.response) return auth.response;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректная задача" }, { status: 400 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    const actor = calendarActor(auth.session!);
    let resultText = String(form.get("resultText") ?? "").trim();
    const task = await prisma.calendarTask.findFirst({
      where: { id, assigneeId: actor.userId, deletedAt: null },
      select: { id: true, orderId: true, workflow: true, expectedAmount: true },
    });
    if (!task) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
    if (task.workflow === CalendarTaskWorkflow.PAYMENT_COLLECTION) {
      const outcome = String(form.get("paymentOutcome") ?? "");
      if (!paymentOutcomes.has(outcome)) return NextResponse.json({ error: "Укажите результат связи с клиентом" }, { status: 400 });
      if (outcome === "PAID") {
        const amount = Number(form.get("paymentAmount"));
        const method = String(form.get("paymentMethod") ?? "");
        if (file instanceof File && file.size > 0)
          return NextResponse.json({ error: "Для полученной оплаты подтверждение хранится в квитанции; файл к отчёту не требуется" }, { status: 400 });
        if (!task.orderId || !Number.isFinite(amount) || amount <= 0 || !paymentMethods.has(method))
          return NextResponse.json({ error: "Укажите точную сумму и способ полученной оплаты" }, { status: 400 });
        const paymentPayload = { taskId: task.id, orderId: task.orderId, amount, method };
        const paidResultText = `Оплата получена: ${amount.toLocaleString("ru-RU")} ₸ · ${method}${resultText ? `\n${resultText}` : ""}`;
        let completedTask: Awaited<ReturnType<typeof completeMandatoryTaskResultInTransaction>> | null = null;
        const payment = await createPayment({
          orderId: task.orderId,
          amount,
          type: "Доплата",
          method,
          comment: `Оплата подтверждена по задаче №${task.id}${resultText ? ` · ${resultText}` : ""}`,
          author: auth.session!.user.name ?? "Сотрудник",
          authorId: actor.userId,
          idempotencyKey: `calendar-payment-result:${task.id}`,
          requestHash: createRequestHash(paymentPayload),
          transactionAction: async (tx) => {
            completedTask = await completeMandatoryTaskResultInTransaction(tx, actor, task.id, paidResultText);
          },
        });
        if (!payment) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
        if (!completedTask) throw new Error("TASK_NOT_FOUND");
        return NextResponse.json(completedTask);
      } else {
        if (!resultText) return NextResponse.json({ error: "Кратко укажите итог разговора и следующий срок" }, { status: 400 });
        resultText = `${paymentOutcomeLabels[outcome]}\n${resultText}`;
      }
    }
    return NextResponse.json(await submitMandatoryTaskResult(actor, id, resultText, file instanceof File ? file : null));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const message = code === "RESULT_REQUIRED" ? "Напишите результат или прикрепите файл" : code === "INVALID_RESULT_FILE" || code === "BLOB_TOO_LARGE" ? "Разрешены фото, PDF, Word, Excel и видео до 25 МБ" : code === "PAYMENT_EXCEEDS_BALANCE" ? "Сумма превышает остаток заказа" : code === "IDEMPOTENCY_CONFLICT" ? "Оплата по этой задаче уже зарегистрирована с другой суммой" : code === "TASK_ALREADY_COMPLETED" ? "По задаче уже отправлен другой результат" : "Не удалось отправить результат";
    return NextResponse.json({ error: message }, { status: code === "TASK_NOT_FOUND" ? 404 : code === "PAYMENT_EXCEEDS_BALANCE" || code === "IDEMPOTENCY_CONFLICT" || code === "TASK_ALREADY_COMPLETED" ? 409 : 400 });
  }
}
