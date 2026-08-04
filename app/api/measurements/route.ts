import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Получить все замеры
export async function GET() {
  try {
    const measurements = await prisma.measurement.findMany({
      include: {
        order: {
          include: {
            client: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(measurements);
  } catch (error) {
    return NextResponse.json(
      { error: "Ошибка получения замеров" },
      { status: 500 }
    );
  }
}

// Создать новый замер
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const measurement = await prisma.measurement.create({
      data: {
        orderId: body.orderId,
        measurer: body.measurer,
        visitDate: new Date(body.visitDate),

        floorHeight: body.floorHeight,
        staircaseWidth: body.staircaseWidth,
        stepsCount: body.stepsCount,

        comment: body.comment,
      },
    });

    return NextResponse.json(measurement);
  } catch (error) {
    return NextResponse.json(
      { error: "Ошибка создания замера" },
      { status: 500 }
    );
  }
}