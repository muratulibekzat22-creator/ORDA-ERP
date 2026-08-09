import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { createEmployeeAccess } from "@/lib/services/employee.service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("employees");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    return NextResponse.json(await createEmployeeAccess(id, {
      email: typeof body.email === "string" ? body.email : "",
      password: typeof body.password === "string" ? body.password : "",
      role: body.role as Role,
    }, Number(auth.session!.user.id)), { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "Аккаунт с таким email уже существует" }, { status: 409 });
    const status = code === "EMPLOYEE_NOT_FOUND" ? 404 : code === "ACCESS_ALREADY_EXISTS" ? 409 : 400;
    const message = code === "EMPLOYEE_NOT_FOUND" ? "Сотрудник не найден" : code === "ACCESS_ALREADY_EXISTS" ? "Доступ уже создан" : "Проверьте email, роль и пароль не короче 12 символов";
    return NextResponse.json({ error: message }, { status });
  }
}
