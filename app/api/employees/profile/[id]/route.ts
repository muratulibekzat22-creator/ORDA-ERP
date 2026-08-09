import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { EmployeeError, updateEmployee } from "@/lib/services/employee.service";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("employees");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    return NextResponse.json(await updateEmployee(id, {
      name: typeof body.name === "string" ? body.name : undefined,
      position: typeof body.position === "string" ? body.position : undefined,
      phone: typeof body.phone === "string" ? body.phone : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
    }, Number(auth.session!.user.id)));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: code === "EMPLOYEE_NOT_FOUND" ? "Сотрудник не найден" : "Не удалось обновить сотрудника" }, { status: error instanceof EmployeeError && code === "EMPLOYEE_NOT_FOUND" ? 404 : 400 });
  }
}
