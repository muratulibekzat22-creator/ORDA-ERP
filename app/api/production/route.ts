import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const productions = await prisma.production.findMany({
      include: {
        order: {
          include: {
            client: true,
            partner: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(productions);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        message: "Ошибка загрузки производства",
      },
      {
        status: 500,
      }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    const production = await prisma.production.update({
      where: {
        id: body.id,
      },
      data: {
        stage: body.stage,
        percent: body.percent,
        master: body.master,
        finishDate:
          body.percent >= 100 ? new Date() : undefined,
      },
      include: {
        order: true,
      },
    });

    await prisma.orderEvent.create({
      data: {
        orderId: production.orderId,
        title:
          body.percent >= 100
            ? "Монтаж завершен"
            : "Обновление производства",
        description:
          `${body.stage} • ${body.percent}% готовности`,
        user: body.master,
      },
    });

    return NextResponse.json(production);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        message: "Ошибка обновления производства",
      },
      {
        status: 500,
      }
    );
  }
}