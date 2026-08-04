import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function generateNumber() {
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);

  return `ORDA-${year}-${random}`;
}

export async function GET() {
  const orders = await prisma.order.findMany({
    include: {
      client: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return NextResponse.json(orders);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const order = await prisma.order.create({
      data: {
        number: generateNumber(),

        clientId: body.clientId,

        address: body.address,
        staircase: body.staircase,
        material: body.material,

        amount: body.amount,

        prepayment: "0",
        balance: body.amount,

        manager: "Bekzat",

        status: "Новая заявка",
      },

      include: {
        client: true,
      },
    });

    await prisma.production.create({
      data: {
        orderId: order.id,
        stage: "Ожидание",
        percent: 0,
        master: "",
      },
    });

    return NextResponse.json(order);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        message: "Ошибка создания заказа",
      },
      {
        status: 500,
      }
    );
  }
}