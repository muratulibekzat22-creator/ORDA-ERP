export const CONTRACT_TEMPLATE_VERSION = "ALTYN_SAPA_ORDA_V1";
export const CONTRACT_TIME_ZONE = "Asia/Almaty";

export type ContractPaymentInput =
  | { mode: "PERCENT"; prepaymentPercent: number }
  | { mode: "AMOUNT"; prepaymentAmount: number };

export type ContractSnapshot = {
  contractNumber: string;
  contractDateIso: string;
  contractTime: string;
  contractDay: string;
  contractMonth: string;
  contractYear: string;
  contractCity: string;
  clientFullName: string;
  clientIin: string;
  clientPhone: string;
  clientAddress: string;
  installationAddress: string;
  stairMaterial: string;
  balusterType: string;
  contractAmount: string;
  contractAmountWords: string;
  contractAmountNumeric: number;
  prepaymentPercent: string;
  prepaymentAmount: string;
  prepaymentAmountWords: string;
  prepaymentAmountNumeric: number;
  balancePercent: string;
  balanceAmount: string;
  balanceAmountWords: string;
  balanceAmountNumeric: number;
  isFullPayment: boolean;
  prepaymentDueText: string;
  balanceDueText: string;
  fullPaymentDueText: string;
  termCalendarDays: string;
  termStartCondition: string;
  plannedCompletionDate: string;
  warrantyText: string;
  directorFullName: string;
  productionContactName: string;
  productionContactPhone: string;
  companyName: string;
  companyBin: string;
  companyIik: string;
  companyBank: string;
  companyBik: string;
  companyPhone: string;
  companyAddress: string;
};

const monthsRu = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const ones = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const onesFemale = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const teens = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const tens = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

function plural(value: number, forms: [string, string, string]) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 19) return forms[2];
  const mod10 = value % 10;
  return mod10 === 1 ? forms[0] : mod10 >= 2 && mod10 <= 4 ? forms[1] : forms[2];
}

function triplet(value: number, female = false) {
  const result: string[] = [];
  if (Math.floor(value / 100)) result.push(hundreds[Math.floor(value / 100)]);
  const rest = value % 100;
  if (rest >= 10 && rest < 20) result.push(teens[rest - 10]);
  else {
    if (Math.floor(rest / 10)) result.push(tens[Math.floor(rest / 10)]);
    if (rest % 10) result.push((female ? onesFemale : ones)[rest % 10]);
  }
  return result;
}

export function amountToRussianWords(input: number) {
  if (!Number.isSafeInteger(input) || input < 0 || input > 999_999_999_999) throw new Error("INVALID_AMOUNT");
  if (input === 0) return "ноль";
  const groups = [
    { divisor: 1_000_000_000, forms: ["миллиард", "миллиарда", "миллиардов"] as [string, string, string], female: false },
    { divisor: 1_000_000, forms: ["миллион", "миллиона", "миллионов"] as [string, string, string], female: false },
    { divisor: 1_000, forms: ["тысяча", "тысячи", "тысяч"] as [string, string, string], female: true },
  ];
  const result: string[] = [];
  let remainder = input;
  for (const group of groups) {
    const value = Math.floor(remainder / group.divisor);
    if (value) result.push(...triplet(value, group.female), plural(value, group.forms));
    remainder %= group.divisor;
  }
  if (remainder) result.push(...triplet(remainder));
  return result.join(" ");
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value).replace(/\u00a0/g, " ");
}

export function calculatePayment(total: number, payment: ContractPaymentInput) {
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error("INVALID_AMOUNT");
  let prepaymentAmount: number;
  let prepaymentPercent: number;
  if (payment.mode === "PERCENT") {
    if (!Number.isFinite(payment.prepaymentPercent) || payment.prepaymentPercent <= 0 || payment.prepaymentPercent > 100) throw new Error("INVALID_PAYMENT");
    prepaymentAmount = Math.round(total * payment.prepaymentPercent / 100);
    prepaymentPercent = payment.prepaymentPercent;
  } else {
    if (!Number.isSafeInteger(payment.prepaymentAmount) || payment.prepaymentAmount <= 0 || payment.prepaymentAmount > total) throw new Error("INVALID_PAYMENT");
    prepaymentAmount = payment.prepaymentAmount;
    prepaymentPercent = prepaymentAmount / total * 100;
  }
  const balanceAmount = total - prepaymentAmount;
  const balancePercent = 100 - prepaymentPercent;
  if (prepaymentAmount + balanceAmount !== total || Math.abs(prepaymentPercent + balancePercent - 100) > 0.000001) throw new Error("INVALID_PAYMENT");
  const percent = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return { prepaymentAmount, prepaymentPercent: percent(prepaymentPercent), balanceAmount, balancePercent: percent(balancePercent), isFullPayment: balanceAmount === 0 };
}

export function almatyDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("ru-RU", { timeZone: CONTRACT_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const monthIndex = Number(get("month")) - 1;
  return { day: get("day"), month: monthsRu[monthIndex], year: get("year"), time: `${get("hour")}:${get("minute")}` };
}

export function warrantyLabel(months: number) {
  if (!Number.isInteger(months) || months <= 0) throw new Error("INVALID_WARRANTY");
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} ${plural(years, ["год", "года", "лет"])}`;
  }
  return `${months} ${plural(months, ["месяц", "месяца", "месяцев"])}`;
}
