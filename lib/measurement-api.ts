import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import type { MeasurementActor } from "@/lib/services/measurement.service";

export function measurementActor(session: { user: { id?: string; role?: string; name?: string | null } }): MeasurementActor {
  return { userId: Number(session.user.id), role: session.user.role as Role, name: session.user.name ?? "Сотрудник" };
}

export function measurementError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if (["NOT_FOUND", "CLIENT_NOT_FOUND"].includes(code)) return NextResponse.json({ error: "Замер или заявка не найдены" }, { status: 404 });
  if (code === "MEASURER_NOT_FOUND") return NextResponse.json({ error: "Активный ответственный за замер не найден" }, { status: 404 });
  if (code === "MEASUREMENT_ALREADY_ASSIGNED") return NextResponse.json({ error: "Замер уже назначен другому сотруднику" }, { status: 409 });
  if (code === "MEASURER_OUTSIDE_SERVICE_AREA") return NextResponse.json({ error: "Этот город не входит в зону выездов выбранного замерщика. Выберите другого сотрудника." }, { status: 409 });
  if (code === "MEASURER_TRAVEL_APPROVAL_REQUIRED") return NextResponse.json({ error: "Это дальний выезд. Подтвердите согласование поездки с замерщиком." }, { status: 409 });
  if (code === "CLIENT_PHONE_REQUIRED") return NextResponse.json({ error: "У клиента должен быть указан телефон" }, { status: 400 });
  if (code === "LOCATION_REQUIRED") return NextResponse.json({ error: "Укажите адрес или ссылку на локацию" }, { status: 400 });
  if (code === "OBJECT_PHOTOS_REQUIRED") return NextResponse.json({ error: "Добавьте три обязательных ракурса лестницы: спереди, сбоку и с обратной стороны" }, { status: 409 });
  if (code === "DESIGN_REFERENCE_REQUIRED") return NextResponse.json({ error: "Добавьте референс дизайна, который выбрал клиент" }, { status: 409 });
  if (code === "DESIGN_INPUT_REQUIRED") return NextResponse.json({ error: "Для промпта нужны три ракурса объекта и референс клиента" }, { status: 409 });
  if (code === "DESIGN_PROMPT_REQUIRED") return NextResponse.json({ error: "Скопируйте готовый промпт и подготовьте визуализацию" }, { status: 409 });
  if (code === "DESIGN_RESULT_REQUIRED") return NextResponse.json({ error: "Загрузите готовую визуализацию лестницы" }, { status: 409 });
  if (code === "DESIGN_NOT_SHOWN") return NextResponse.json({ error: "Покажите визуализацию клиенту и подтвердите это в замере" }, { status: 409 });
  if (code === "OUTCOME_COMMENT_REQUIRED") return NextResponse.json({ error: "Для передачи менеджеру укажите комментарий" }, { status: 400 });
  if (code === "CLIENT_OUTCOME_REQUIRED") return NextResponse.json({ error: "Выберите результат общения с клиентом" }, { status: 400 });
  if (code === "REFUSAL_REASON_REQUIRED") return NextResponse.json({ error: "Укажите причину отказа; для «Другое» нужен комментарий" }, { status: 400 });
  if (code === "CANCELLATION_REASON_REQUIRED") return NextResponse.json({ error: "Укажите причину отмены замера" }, { status: 400 });
  if (code === "MANAGER_REQUIRED") return NextResponse.json({ error: "У заявки нет ответственного менеджера" }, { status: 409 });
  if (code === "ORDER_NOT_FOUND") return NextResponse.json({ error: "Подходящий действующий заказ не найден" }, { status: 404 });
  if (code === "SOURCE_PROPOSAL_REQUIRED") return NextResponse.json({ error: "Выберите исходное КП менеджера" }, { status: 400 });
  if (code === "PROPOSAL_NOT_FOUND") return NextResponse.json({ error: "КП не найдено у этого клиента" }, { status: 404 });
  if (code === "PROPOSAL_VARIANT_REQUIRED") return NextResponse.json({ error: "Выберите материал из исходного КП" }, { status: 400 });
  if (code === "QUOTE_REQUIRED") return NextResponse.json({ error: "Перед завершением укажите окончательную цену" }, { status: 409 });
  if (code === "QUOTE_CONFIRMATION_REQUIRED") return NextResponse.json({ error: "Подтвердите, что окончательная сумма согласована с клиентом" }, { status: 409 });
  if (code === "INVALID_QUOTE") return NextResponse.json({ error: "Скидка должна быть неотрицательной и меньше исходной цены" }, { status: 400 });
  if (code === "TRAINING_REQUIRED") return NextResponse.json({ error: "Для начала работы необходимо пройти обязательное обучение.", code: "TRAINING_REQUIRED" }, { status: 409 });
  if (["INVALID_STATE", "IMMUTABLE_MEASUREMENT"].includes(code)) return NextResponse.json({ error: "Завершённый или переданный замер нельзя изменять" }, { status: 409 });
  if (["INVALID_INPUT", "INVALID_DIMENSIONS"].includes(code)) return NextResponse.json({ error: "Проверьте обязательные поля и размеры" }, { status: 400 });
  console.error("measurement operation failed", error);
  return NextResponse.json({ error: "Не удалось выполнить операцию с замером" }, { status: 500 });
}
