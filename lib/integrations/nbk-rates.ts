export type NbkRate = {
  rate: number;
  publishedFor: string | null;
  source: "NBK_DATED" | "NBK_CURRENT" | "CONFIGURED_FALLBACK" | "IDENTITY";
};

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
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("NBK_UNAVAILABLE");
  const parsed = parseNbkRateXml(await response.text(), currency);
  if (!parsed) throw new Error("NBK_RATE_MISSING");
  return { ...parsed, source };
}

export async function officialCurrencyRateToKzt(currency: string, at: Date, fallback = 0): Promise<NbkRate> {
  const code = currency.trim().toUpperCase();
  if (code === "KZT") return { rate: 1, publishedFor: null, source: "IDENTITY" };
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(at);
  const dated = new URL("https://nationalbank.kz/rss/get_rates.cfm");
  dated.searchParams.set("fdate", date);
  try {
    return await Promise.any([
      fetchNbkRate(dated, code, "NBK_DATED"),
      fetchNbkRate("https://nationalbank.kz/rss/rates_all.xml", code, "NBK_CURRENT"),
    ]);
  } catch {
    if (Number.isFinite(fallback) && fallback > 0)
      return { rate: fallback, publishedFor: null, source: "CONFIGURED_FALLBACK" };
    throw new Error("NBK_RATE_UNAVAILABLE");
  }
}
