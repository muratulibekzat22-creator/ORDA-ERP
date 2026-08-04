import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search")?.trim() ?? "";
    const status = searchParams.get("status")?.trim() ?? "";
    const page = Number(searchParams.get("page") ?? "1");
    const limit = Number(searchParams.get("limit") ?? "20");

    const where: any = {};

    if (search) {
      where.OR = [
        {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          phone: {
            contains: search,
          },
        },
        {
          city: {
            contains: search,
            mode: "insensitive",
          },
        },
      ];
    }

    if (status) {
      where.status = status;
    }

    const total = await prisma.client.count({
      where,
    });

    const clients = await prisma.client.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
      skip: (page - 1) * limit,
      take: limit,
    });

    return NextResponse.json({
      data: clients,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Ошибка получения клиентов",
      },
      {
        status: 500,
      }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const phone = String(body.phone ?? "").trim();

    const exists = await prisma.client.findFirst({
      where: {
        phone,
      },
    });

    if (exists) {
      return NextResponse.json(
        {
          error: "Клиент с таким телефоном уже существует",
        },
        {
          status: 400,
        }
      );
    }

    const client = await prisma.client.create({
      data: {
        name: String(body.name).trim(),
        phone,
        city: String(body.city ?? "").trim(),
        manager: body.manager ?? "Менеджер",
        amount: String(body.amount ?? "0"),
        status: body.status ?? "Новый",
      },
    });

    return NextResponse.json(client);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Ошибка создания клиента",
      },
      {
        status: 500,
      }
    );
  }
}