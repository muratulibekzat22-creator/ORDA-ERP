import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const fields = [
  "pinePrice",
  "elmPrice",
  "oakPrice",
  "woodRailing",
  "glassRailing",
  "brassRailing",
  "ledPrice",
  "paintingPrice",
  "installationPrice",
] as const;
const select = Object.fromEntries(
  fields.map((field) => [field, true]),
) as Record<(typeof fields)[number], true>;

async function authorize() {
  const auth = await requirePermission("settings");
  if (auth.response) return auth;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.ACCOUNTANT)
    return {
      response: NextResponse.json(
        { error: "Недостаточно прав" },
        { status: 403 },
      ),
    };
  return auth;
}

export async function GET() {
  const auth = await authorize();
  if (auth.response) return auth.response;
  const config = await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
    select,
  });
  return NextResponse.json(config);
}

export async function PATCH(request: Request) {
  const auth = await authorize();
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json(
      { error: "Бухгалтеру доступен только просмотр" },
      { status: 403 },
    );
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      Object.keys(body).some(
        (key) => !fields.includes(key as (typeof fields)[number]),
      )
    )
      return NextResponse.json({ error: "Недопустимые поля" }, { status: 400 });
    const data = Object.fromEntries(
      fields
        .filter((field) => field in body)
        .map((field) => [field, Number(body[field])]),
    ) as Record<string, number>;
    if (
      Object.values(data).some(
        (value) =>
          !Number.isInteger(value) || value < 0 || value > 1_000_000_000,
      )
    )
      return NextResponse.json(
        { error: "Цены должны быть целыми неотрицательными числами" },
        { status: 400 },
      );
    return NextResponse.json(
      await prisma.settings.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
        select,
      }),
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    return NextResponse.json(
      { error: "Не удалось сохранить конфигурацию" },
      { status: 500 },
    );
  }
}
