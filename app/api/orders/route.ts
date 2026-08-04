import { NextResponse } from "next/server";

import {
  createOrder,
  getOrders,
} from "@/lib/services/order.service";

import { calculateOrder } from "@/lib/services/calculator.service";

export async function GET() {
  try {
    const orders = await getOrders();

    return NextResponse.json(orders);
  } catch {
    return NextResponse.json(
      { error: "Ошибка получения заказов" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const calc = await calculateOrder({
      material: body.material,
      steps: Number(body.steps),
      platforms: Number(body.platforms),

      railing: body.railing,

      led: Boolean(body.led),
      painting: Boolean(body.painting),
      installation: Boolean(body.installation),

      partnerStepPrice: Number(body.partnerStepPrice),
    });

    const order = await createOrder({
      number: body.number,

      clientId: Number(body.clientId),

      partnerId: body.partnerId
        ? Number(body.partnerId)
        : null,

      address: body.address,

      staircase: body.staircase,

      material: body.material,

      amount: String(calc.clientPrice),

      prepayment: "0",

      balance: String(calc.balance),

      partnerPrice: String(calc.partnerPrice),

      companyProfit: String(calc.companyProfit),

      partnerPaid: "0",

      partnerBalance: String(calc.partnerPrice),

      manager: body.manager ?? "Менеджер",

      status: "Новая заявка",
    });

    return NextResponse.json(order);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Ошибка создания заказа",
      },
      {
        status: 500,
      }
    );
  }
}