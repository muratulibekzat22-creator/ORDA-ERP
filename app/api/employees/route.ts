import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { createEmployee, EmployeeError, listEmployees } from "@/lib/services/employee.service";

export async function GET(request: Request) {
  const auth = await requirePermission("employees");
  if (auth.response) return auth.response;
  const status = new URL(request.url).searchParams.get("status") ?? "active";
  if (!(["active", "inactive", "all"] as const).includes(status as "active" | "inactive" | "all")) {
    return NextResponse.json({ error: "Некорректный фильтр статуса" }, { status: 400 });
  }
  return NextResponse.json(
    await listEmployees(status as "active" | "inactive" | "all"),
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

export async function POST(request: Request) {
  const auth = await requirePermission("employees");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const hasOrdaAccess = body.hasOrdaAccess === undefined ? true : body.hasOrdaAccess === true;
    const role = Object.values(Role).includes(body.role as Role) ? body.role as Role : undefined;
    const employee = await createEmployee({
      name,
      position: typeof body.position === "string" && body.position.trim()
        ? body.position
        : role ?? "Сотрудник",
      phone: typeof body.phone === "string" ? body.phone : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
      active: typeof body.active === "boolean" ? body.active : true,
      hasOrdaAccess,
      role,
      password: typeof body.password === "string" ? body.password : undefined,
    }, Number(auth.session!.user.id));
    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "Аккаунт с таким email уже существует" }, { status: 409 });
    if (error instanceof EmployeeError) {
      const message = code === "EMPLOYEE_FIELDS_REQUIRED"
        ? "Укажите ФИО и должность"
        : code === "ACCESS_FIELDS_REQUIRED"
          ? "Для доступа в ORDA укажите email, роль и пароль не короче 12 символов"
          : code === "INVALID_EMAIL"
            ? "Некорректный email"
            : "Некорректная роль сотрудника";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: "Не удалось создать сотрудника" }, { status: 500 });
  }
}
