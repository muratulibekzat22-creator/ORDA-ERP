import { NextRequest, NextResponse } from "next/server";

import {
  getSettings,
  updateSettings,
} from "@/lib/services/settings.service";
import { requirePermission } from "@/lib/server-auth";

export async function GET() {
  const auth=await requirePermission("settings");if(auth.response)return auth.response;
  try {
    const settings = await getSettings();

    return NextResponse.json(settings);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        message: "Ошибка получения настроек",
      },
      {
        status: 500,
      }
    );
  }
}

export async function PUT(
  request: NextRequest
) {
  const auth=await requirePermission("settings");if(auth.response)return auth.response;
  try {
    const body = await request.json();

    const settings = await updateSettings({
      pinePrice: Number(body.pinePrice),
      elmPrice: Number(body.elmPrice),
      oakPrice: Number(body.oakPrice),

      woodRailing: Number(body.woodRailing),
      glassRailing: Number(body.glassRailing),
      brassRailing: Number(body.brassRailing),

      ledPrice: Number(body.ledPrice),
      paintingPrice: Number(body.paintingPrice),
      installationPrice: Number(body.installationPrice),
    });

    return NextResponse.json(settings);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        message: "Ошибка сохранения настроек",
      },
      {
        status: 500,
      }
    );
  }
}
