import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const payments = await prisma.payment.findMany({
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

    return NextResponse.json(payments);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Ошибка получения платежей",
      },
      {
        status: 500,
      }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const payment = await prisma.payment.create({
      data: {
        orderId: Number(body.orderId),
        amount: Number(body.amount),
        type: body.type,
        method: body.method,
        comment: body.comment,
      },
    });

    const order = await prisma.order.findUnique({
      where: {
        id: Number(body.orderId),
      },
    });

    if (!order) {
      return NextResponse.json(
        {
          error: "Заказ не найден",
        },
        {
          status: 404,
        }
      );
    }

    const prepayment =
      Number(order.prepayment) + Number(body.amount);

    const balance =
      Number(order.amount) - prepayment;

    await prisma.order.update({
      where: {
        id: order.id,
      },
      data: {
        prepayment: String(prepayment),
        balance: String(Math.max(balance, 0)),
      },
    });

    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        title: "Получена оплата",
        description: `${Number(body.amount).toLocaleString("ru-RU")} ₸ • ${body.method}`,
        user: body.user ?? "Система",
      },
    });

    return NextResponse.json(payment);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Ошибка создания платежа",
      },
      {
        status: 500,
      }
    );
  }
}