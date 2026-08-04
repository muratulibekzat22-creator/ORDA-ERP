import { getExtraPrices, getMaterialPrice, getRailingPrice } from "./settings.service";

interface CalculateOrderInput {
  material: string;
  steps: number;
  platforms: number;

  railing: string;

  led: boolean;
  painting: boolean;
  installation: boolean;

  partnerStepPrice: number;
}

export async function calculateOrder(data: CalculateOrderInput) {
  const materialPrice = await getMaterialPrice(data.material);

  const railingPrice = await getRailingPrice(data.railing);

  const extras = await getExtraPrices();

  const totalSteps = data.steps + data.platforms * 3;

  let clientTotal = totalSteps * materialPrice;

  if (railingPrice) {
    clientTotal += railingPrice;
  }

  if (data.led) {
    clientTotal += extras.led;
  }

  if (data.painting) {
    clientTotal += extras.painting;
  }

  if (data.installation) {
    clientTotal += extras.installation;
  }

  const partnerTotal = totalSteps * data.partnerStepPrice;

  const companyProfit = clientTotal - partnerTotal;

  return {
    totalSteps,

    clientPrice: clientTotal,

    partnerPrice: partnerTotal,

    companyProfit,

    prepayment: 0,

    balance: clientTotal,
  };
}