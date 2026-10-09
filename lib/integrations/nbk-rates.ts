export type NbkRate = {
  rate: number;
  publishedFor: string | null;
  source: "NBK_DATED" | "NBK_PREVIOUS" | "NBK_CURRENT" | "LAST_SUCCESSFUL" | "CONFIGURED_FALLBACK" | "IDENTITY";
};

type NbkFallback = Pick<NbkRate, "rate" | "publishedFor"> & {
  source: "LAST_SUCCESSFUL" | "CONFIGURED_FALLBACK";
};

const NBK_TIMEOUT_MS = 8_000;

function nbkDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

export function effectiveNbkRateDate(at: Date, now = new Date()) {
  return at.getTime() > now.getTime() ? now : at;
}

export function nbkRateCandidateDates(at: Date, now = new Date(), lookbackDays = 7) {
  const effective = effectiveNbkRateDate(at, now);
  const candidates: string[] = [];
  for (let days = 0; days <= lookbackDays; days++) {
    const candidate = new Date(effective.getTime() - days * 24 * 60 * 60 * 1000);
    const formatted = nbkDate(candidate);
    if (!candidates.includes(formatted)) candidates.push(formatted);
  }
  return candidates;
}

function xmlValue(block: string, tag: string) {
  return block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([^<\\]]+)(?:\\]\\]>)?</${tag}>`, "i"))?.[1]?.trim() ?? "";
}

export function parseNbkRateXml(xml: string, currency: string) {
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    if (xmlValue(block, "title").toUpperCase() !== currency.toUpperCase()) continue;
    const amount = Number(xmlValue(block, "description").replace(",", "."));
    const quantity = Number(xmlValue(block, "quant").replace(",", ".")) || 1;
    if (Number.isFinite(amount) && amount > 0 && Number.isFinite(quantity) && quantity > 0)
      return {
        rate: amount / quantity,
        publishedFor: xmlValue(block, "pubDate") || xmlValue(xml, "date") || null,
      };
  }
  return null;
}

async function fetchNbkRate(url: URL | string, currency: string, source: NbkRate["source"]): Promise<NbkRate> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(NBK_TIMEOUT_MS) });
  if (!response.ok) throw new Error("NBK_UNAVAILABLE");
  const parsed = parseNbkRateXml(await response.text(), currency);
  if (!parsed) throw new Error("NBK_RATE_MISSING");
  return { ...parsed, source };
}

function normalizeFallback(fallback: number | NbkFallback): NbkFallback | null {
  if (typeof fallback === "number")
    return Number.isFinite(fallback) && fallback > 0
      ? { rate: fallback, publishedFor: null, source: "CONFIGURED_FALLBACK" }
      : null;
  return Number.isFinite(fallback.rate) && fallback.rate > 0 ? fallback : null;
}

export async function officialCurrencyRateToKzt(
  currency: string,
  at: Date,
  fallback: number | NbkFallback = 0,
  now = new Date(),
): Promise<NbkRate> {
  const code = currency.trim().toUpperCase();
  if (code === "KZT") return { rate: 1, publishedFor: null, source: "IDENTITY" };

  const candidateDates = nbkRateCandidateDates(at, now);
  for (const [index, date] of candidateDates.entries()) {
    const dated = new URL("https://nationalbank.kz/rss/get_rates.cfm");
    dated.searchParams.set("fdate", date);
    try {
      return await fetchNbkRate(dated, code, index === 0 ? "NBK_DATED" : "NBK_PREVIOUS");
    } catch (error) {
      if (error instanceof Error && error.message === "NBK_RATE_MISSING") continue;
      break;
    }
  }

  try {
    return await fetchNbkRate("https://nationalbank.kz/rss/rates_all.xml", code, "NBK_CURRENT");
  } catch {
    const safeFallback = normalizeFallback(fallback);
    if (safeFallback) return safeFallback;
    throw new Error("NBK_RATE_UNAVAILABLE");
  }
}
