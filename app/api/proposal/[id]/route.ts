import { NextResponse } from "next/server";

import { getOrder } from "@/lib/services/order.service";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(
  request: Request,
  { params }: Props
) {
  try {
    const { id } = await params;

    const order = await getOrder(Number(id));

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

    return NextResponse.json(order);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Ошибка получения коммерческого предложения",
      },
      {
        status: 500,
      }
    );
  }
}