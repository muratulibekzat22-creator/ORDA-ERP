import { NextResponse } from "next/server";

import {
  createProduction,
  getProductions,
  updateProduction,
} from "@/lib/services/production.service";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const stages = [
  "Новая заявка",
  "Замер",
  "Проектирование",
  "Заготовка",
  "Покраска",
  "Заказ готов",
  "Монтаж",
  "Сдано",
];

function getDate(value: unknown) {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function getProductionData(values: Record<string, unknown>) {
  const data: {
    stage?: string;
    percent?: number;
    master?: string;
    masterUserId?: number | null;
    comment?: string;
    startDate?: Date | null;
    finishDate?: Date | null;
  } = {};

  if (values.stage !== undefined) {
    if (typeof values.stage !== "string" || !stages.includes(values.stage)) {
      return null;
    }

    data.stage = values.stage;
  }

  if (values.percent !== undefined) {
    const percent = Number(values.percent);

    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      return null;
    }

    data.percent = percent;
  }

  if (values.masterUserId !== undefined) {
    const masterUserId = Number(values.masterUserId);
    if (!Number.isInteger(masterUserId) || masterUserId <= 0) return null;
    data.masterUserId = masterUserId;
  }

  if (values.comment !== undefined) {
    if (typeof values.comment !== "string") return null;
    data.comment = values.comment.trim();
  }

  if (values.startDate !== undefined) {
    const startDate = getDate(values.startDate);
    if (startDate === undefined) return null;
    data.startDate = startDate;
  }

  if (values.finishDate !== undefined) {
    const finishDate = getDate(values.finishDate);
    if (finishDate === undefined) return null;
    data.finishDate = finishDate;
  }

  return data;
}

export async function GET() {
  const auth=await requirePermission("production");
  if(auth.response)return auth.response;
  try {
    const role=auth.session!.user.role;const userId=Number(auth.session!.user.id);
    if(role===Role.PRODUCTION)return NextResponse.json(await prisma.production.findMany({where:{masterUserId:userId},include:{order:{include:{client:true,partner:true}},masterUser:{select:{id:true,name:true}}}}));
    if(role===Role.INSTALLER)return NextResponse.json(await prisma.production.findMany({where:{masterUserId:userId,stage:"Монтаж"},include:{order:{include:{client:true,partner:true}},masterUser:{select:{id:true,name:true}}}}));
    return NextResponse.json(await getProductions());
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Ошибка загрузки производства" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth=await requirePermission("production");if(auth.response)return auth.response;
  try {
    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Некорректные данные производства" }, { status: 400 });
    }

    const values = body as Record<string, unknown>;
    const orderId = Number(values.orderId);
    const data = getProductionData(values);

    if (!Number.isInteger(orderId) || orderId <= 0 || !data || !data.stage || data.percent === undefined) {
      return NextResponse.json({ error: "Некорректные данные производства" }, { status: 400 });
    }

    const master=await prisma.user.findUnique({where:{id:data.masterUserId!}});
    if(!master)return NextResponse.json({error:"Мастер не найден"},{status:404});
    const allowed:Role[]=data.stage==="Монтаж"?[Role.INSTALLER,Role.DIRECTOR]:[Role.PRODUCTION,Role.DIRECTOR];
    if(!master.active||!allowed.includes(master.role))return NextResponse.json({error:"Пользователь не может быть назначен на этот этап"},{status:409});
    const production = await createProduction({
      orderId,
      stage: data.stage,
      percent: data.percent,
      master: master.name,
      masterUserId: master.id,
      comment: data.comment,
      startDate: data.startDate,
      finishDate: data.finishDate,
    });

    if (!production) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    return NextResponse.json(production, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Ошибка создания производства" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth=await requirePermission("production");if(auth.response)return auth.response;
  try {
    const body: unknown = await request.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Некорректные данные производства" }, { status: 400 });
    }

    const values = body as Record<string, unknown>;
    const id = Number(values.id);
    const data = getProductionData(values);

    if (!Number.isInteger(id) || id <= 0 || !data || Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Некорректные данные производства" }, { status: 400 });
    }

    if(data.masterUserId){const master=await prisma.user.findUnique({where:{id:data.masterUserId}});if(!master)return NextResponse.json({error:"Мастер не найден"},{status:404});const stage=data.stage??(await prisma.production.findUnique({where:{id},select:{stage:true}}))?.stage;const allowed:Role[]=stage==="Монтаж"?[Role.INSTALLER,Role.DIRECTOR]:[Role.PRODUCTION,Role.DIRECTOR];if(!master.active||!allowed.includes(master.role))return NextResponse.json({error:"Пользователь не может быть назначен на этот этап"},{status:409});data.master=master.name;}
    const production = await updateProduction(id, data);

    if (!production) {
      return NextResponse.json({ error: "Производство не найдено" }, { status: 404 });
    }

    return NextResponse.json(production);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Ошибка обновления производства" }, { status: 500 });
  }
}
