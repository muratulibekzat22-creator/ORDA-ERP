import { prisma } from "@/lib/prisma";

export async function getSettings() {
  let settings = await prisma.settings.findFirst();

  if (!settings) {
    settings = await prisma.settings.create({
      data: {},
    });
  }

  return settings;
}

export async function updateSettings(data: {
  pinePrice?: number;
  elmPrice?: number;
  oakPrice?: number;

  woodRailing?: number;
  glassRailing?: number;
  brassRailing?: number;

  ledPrice?: number;
  paintingPrice?: number;
  installationPrice?: number;
}) {
  const settings = await getSettings();

  return prisma.settings.update({
    where: {
      id: settings.id,
    },
    data,
  });
}

export async function getMaterialPrice(
  material: string
) {
  const settings = await getSettings();

  switch (material) {
    case "Сосна":
      return settings.pinePrice;

    case "Карагач":
      return settings.elmPrice;

    case "Дуб":
      return settings.oakPrice;

    default:
      return settings.elmPrice;
  }
}

export async function getRailingPrice(
  railing: string
) {
  const settings = await getSettings();

  switch (railing) {
    case "Дерево":
      return settings.woodRailing;

    case "Стекло":
      return settings.glassRailing;

    case "Латунь":
      return settings.brassRailing;

    default:
      return 0;
  }
}

export async function getExtraPrices() {
  const settings = await getSettings();

  return {
    led: settings.ledPrice,
    painting: settings.paintingPrice,
    installation: settings.installationPrice,
  };
}