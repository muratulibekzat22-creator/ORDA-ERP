import { Prisma } from "@prisma/client";

type DecimalValue = Prisma.Decimal | string | number;

export type ProfitFirstInput = {
  totalSale: DecimalValue;
  productionCost: DecimalValue;
  companyClientReceived: DecimalValue;
  clientPaidToWorkshop?: DecimalValue;
  workshopReturnedToClient?: DecimalValue;
  workshopTransferredToCompany?: DecimalValue;
  companyPaidWorkshop: DecimalValue;
  dataComplete: boolean;
};

const decimal = (value: DecimalValue | null | undefined) => new Prisma.Decimal(value ?? 0);
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const positive = (value: Prisma.Decimal) => value.gt(0) ? value : new Prisma.Decimal(0);
const minimum = (left: Prisma.Decimal, right: Prisma.Decimal) => left.lt(right) ? left : right;

/**
 * Profit-first cash waterfall used by the workshop settlement screen.
 *
 * Example: sale 1.8m, production 1.5m, client paid 1m.  The first 300k
 * secures the company's planned margin; the remaining 700k funds production.
 */
export function calculateProfitFirstAllocation(input: ProfitFirstInput) {
  const totalSale = money(positive(decimal(input.totalSale)));
  const productionCost = money(positive(decimal(input.productionCost)));
  const companyClientReceived = money(positive(decimal(input.companyClientReceived)));
  const clientPaidToWorkshop = money(positive(decimal(input.clientPaidToWorkshop)));
  const workshopReturnedToClient = money(positive(decimal(input.workshopReturnedToClient)));
  const workshopTransferredToCompany = money(positive(decimal(input.workshopTransferredToCompany)));
  const companyPaidWorkshop = money(positive(decimal(input.companyPaidWorkshop)));
  const directWorkshopHeld = money(positive(
    clientPaidToWorkshop.sub(workshopReturnedToClient).sub(workshopTransferredToCompany),
  ));
  const clientReceived = money(positive(
    companyClientReceived.add(clientPaidToWorkshop).sub(workshopReturnedToClient),
  ));
  const clientRemaining = money(positive(totalSale.sub(clientReceived)));
  const plannedCompanyIncome = money(totalSale.sub(productionCost));
  const companyIncomeTarget = money(positive(plannedCompanyIncome));
  const plannedLoss = money(positive(plannedCompanyIncome.negated()));
  const workshopReceived = money(companyPaidWorkshop.add(directWorkshopHeld));
  const companyCashHeld = money(
    companyClientReceived.add(workshopTransferredToCompany).sub(companyPaidWorkshop),
  );

  if (!input.dataComplete) {
    return {
      dataComplete: false,
      totalSale,
      productionCost: new Prisma.Decimal(0),
      plannedCompanyIncome: null,
      plannedLoss: null,
      clientReceived,
      clientRemaining,
      companyIncomeRetained: null,
      companyIncomeRemaining: null,
      productionFunded: null,
      workshopReceived,
      readyToPayWorkshop: null,
      workshopRemaining: null,
      awaitingClientForWorkshop: null,
      workshopAdvance: null,
      companyCashHeld,
      directWorkshopHeld,
    };
  }

  const companyIncomeRetained = money(minimum(positive(companyCashHeld), companyIncomeTarget));
  const companyIncomeRemaining = money(positive(companyIncomeTarget.sub(companyIncomeRetained)));
  const productionFunded = money(minimum(
    positive(clientReceived.sub(companyIncomeTarget)),
    productionCost,
  ));
  const readyToPayWorkshop = money(positive(productionFunded.sub(workshopReceived)));
  const workshopRemaining = money(positive(productionCost.sub(workshopReceived)));
  const awaitingClientForWorkshop = money(positive(workshopRemaining.sub(readyToPayWorkshop)));
  const workshopAdvance = money(positive(workshopReceived.sub(productionFunded)));

  return {
    dataComplete: true,
    totalSale,
    productionCost,
    plannedCompanyIncome,
    plannedLoss,
    clientReceived,
    clientRemaining,
    companyIncomeRetained,
    companyIncomeRemaining,
    productionFunded,
    workshopReceived,
    readyToPayWorkshop,
    workshopRemaining,
    awaitingClientForWorkshop,
    workshopAdvance,
    companyCashHeld,
    directWorkshopHeld,
  };
}
