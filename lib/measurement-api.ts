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
  if (code === "MEASURER_NOT_FOUND") return NextResponse.json({ error: "Активный замерщик не найден" }, { status: 404 });
  if (code === "CLIENT_PHONE_REQUIRED") return NextResponse.json({ error: "У клиента должен быть указан телефон" }, { status: 400 });
  if (code === "LOCATION_REQUIRED") return NextResponse.json({ error: "Укажите адрес или ссылку на локацию" }, { status: 400 });
  if (code === "SHEET_PHOTO_REQUIRED") return NextResponse.json({ error: "Перед завершением загрузите фото листа замера" }, { status: 409 });
  if (code === "MANAGER_REQUIRED") return NextResponse.json({ error: "У заявки нет ответственного менеджера" }, { status: 409 });
  if (code === "TRAINING_REQUIRED") return NextResponse.json({ error: "Для начала работы необходимо пройти обязательное обучение.", code: "TRAINING_REQUIRED" }, { status: 409 });
  if (["INVALID_STATE", "IMMUTABLE_MEASUREMENT"].includes(code)) return NextResponse.json({ error: "Завершённый или переданный замер нельзя изменять" }, { status: 409 });
  if (["INVALID_INPUT", "INVALID_DIMENSIONS"].includes(code)) return NextResponse.json({ error: "Проверьте обязательные поля и размеры" }, { status: 400 });
  console.error("measurement operation failed", error);
  return NextResponse.json({ error: "Не удалось выполнить операцию с замером" }, { status: 500 });
}
