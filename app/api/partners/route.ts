import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const partners = await prisma.partner.findMany({
      include: {
        orders: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    return NextResponse.json(partners);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        message: "Ошибка загрузки партнеров",
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

    const partner = await prisma.partner.create({
      data: {
        name: body.name,
        phone: body.phone,
        city: body.city,
        email: body.email,
        active: true,
      },
    });

    return NextResponse.json(partner);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        message: "Ошибка создания партнера",
      },
      {
        status: 500,
      }
    );
  }
}