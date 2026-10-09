import { readSheet } from "read-excel-file/node";

export const MAX_BANK_STATEMENT_SIZE = 10 * 1024 * 1024;
export const MAX_BANK_STATEMENT_ROWS = 2_000;
export const BANK_STATEMENT_EXTENSIONS = new Set(["xlsx", "csv", "txt"]);

export type BankStatementDirection = "INCOME" | "EXPENSE";

export type ParsedBankStatementTransaction = {
  rowNumber: number;
  operationDate: Date;
  direction: BankStatementDirection;
  amount: number;
  currency: string;
  counterparty: string | null;
  description: string | null;
  reference: string | null;
  raw: Record<string, string | number | null>;
};

export type ParsedBankStatement = {
  provider: "KASPI";
  accountLabel: string | null;
  totalRows: number;
  skippedRows: number;
  transactions: ParsedBankStatementTransaction[];
};

type Cell = string | number | boolean | Date | null;

const clean = (value: unknown, limit = 500) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);

export function normalizeCounterparty(value: string | null | undefined) {
  return clean(value, 300)
    .toLocaleLowerCase("ru")
    .replace(/[«»"'`]/g, "")
    .replace(/\b(тоо|ип|ао|ооо|llp|ltd)\b/giu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extension(fileName: string) {
  return fileName.toLocaleLowerCase("en").split(".").pop() ?? "";
}

function decodeText(bytes: Buffer) {
  if (bytes.includes(0)) throw new Error("INVALID_STATEMENT_CONTENT");
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const replacements = (utf8.match(/�/g) ?? []).length;
  if (replacements <= Math.max(1, utf8.length / 500)) return utf8.replace(/^\uFEFF/, "");
  return new TextDecoder("windows-1251").decode(bytes).replace(/^\uFEFF/, "");
}

function parseDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      cells.push(cell);
      cell = "";
    } else cell += character;
  }
  cells.push(cell);
  return cells;
}

function parseDelimited(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const sample = lines.slice(0, 10).join("\n");
  const delimiters = [";", "\t", ","];
  const delimiter = delimiters
    .map((candidate) => ({ candidate, count: sample.split(candidate).length - 1 }))
    .sort((left, right) => right.count - left.count)[0]?.candidate ?? ";";
  return lines.map((line) => parseDelimitedLine(line, delimiter));
}

function numeric(value: Cell) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = clean(value).replace(/[₸₽$€]|KZT|тенге/giu, "").replace(/[\s\u00a0]/g, "");
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text);
  text = text.replace(/[()]/g, "");
  if (text.includes(",") && text.includes(".")) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) text = text.replace(/\./g, "").replace(",", ".");
    else text = text.replace(/,/g, "");
  } else if (text.includes(",")) text = text.replace(/,/g, ".");
  const result = Number(text);
  return Number.isFinite(result) ? (negative ? -Math.abs(result) : result) : null;
}

function dateValue(value: Cell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && value > 20_000 && value < 100_000)
    return new Date(Date.UTC(1899, 11, 30, 12) + Math.trunc(value) * 86_400_000);
  const text = clean(value);
  const match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    const result = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1]), Number(match[4] ?? 12), Number(match[5] ?? 0), Number(match[6] ?? 0)));
    return Number.isNaN(result.getTime()) ? null : result;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const result = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] ?? 12), Number(iso[5] ?? 0), Number(iso[6] ?? 0)));
    return Number.isNaN(result.getTime()) ? null : result;
  }
  return null;
}

function normalizedHeader(value: Cell) {
  return clean(value, 120).toLocaleLowerCase("ru").replace(/ё/g, "е");
}

type Columns = {
  date: number;
  income: number | null;
  expense: number | null;
  amount: number | null;
  direction: number | null;
  counterparty: number[];
  description: number[];
  reference: number | null;
  currency: number | null;
};

function columnKind(header: string) {
  if (/дата|date/.test(header)) return "date";
  if (/поступ|приход|зачисл|кредит|credit/.test(header)) return "income";
  if (/списан|расход|дебет|debit/.test(header)) return "expense";
  if (/сумм|amount|оборот/.test(header)) return "amount";
  if (/тип операции|вид операции|направлен|операция|категор/.test(header)) return "direction";
  if (/контрагент|отправител|получател|плательщик|бенефициар|наименован/.test(header)) return "counterparty";
  if (/назначен|описан|детал|коммент|description|основан/.test(header)) return "description";
  if (/номер документа|референс|reference|id операции|код операции/.test(header)) return "reference";
  if (/валют|currency/.test(header)) return "currency";
  return null;
}

function detectHeader(rows: Cell[][]) {
  let selected: { index: number; score: number; columns: Columns } | null = null;
  const candidates = rows.slice(0, 50);
  for (let index = 0; index < candidates.length; index += 1) {
    const row = candidates[index];
    const columns: Columns = { date: -1, income: null, expense: null, amount: null, direction: null, counterparty: [], description: [], reference: null, currency: null };
    let score = 0;
    row.forEach((cell, column) => {
      const kind = columnKind(normalizedHeader(cell));
      if (!kind) return;
      score += kind === "date" ? 4 : kind === "income" || kind === "expense" || kind === "amount" ? 3 : 1;
      if (kind === "date" && columns.date < 0) columns.date = column;
      else if (kind === "counterparty") columns.counterparty.push(column);
      else if (kind === "description") columns.description.push(column);
      else if (kind !== "date" && columns[kind] === null) columns[kind] = column;
    });
    const hasMoney = columns.amount !== null || columns.income !== null || columns.expense !== null;
    if (columns.date >= 0 && hasMoney && (!selected || score > selected.score)) selected = { index, score, columns };
  }
  return selected;
}

function joined(row: Cell[], columns: number[]) {
  const unique = [...new Set(columns.map((index) => clean(row[index], 500)).filter(Boolean))];
  return unique.length ? unique.join(" · ") : null;
}

function directionFrom(value: Cell) {
  const text = normalizedHeader(value);
  if (/поступ|приход|зачисл|credit|возврат средств/.test(text)) return "INCOME" as const;
  if (/списан|расход|оплат|перевод исход|debit|сняти/.test(text)) return "EXPENSE" as const;
  return null;
}

function accountLabel(rows: Cell[][]) {
  const text = rows.slice(0, 30).flat().map((item) => clean(item)).join(" ");
  const iban = text.match(/\bKZ[A-Z0-9]{16,22}\b/i)?.[0];
  if (iban) return `Kaspi • ${iban.slice(-4)}`;
  const card = text.match(/\b\d{4}[\s-]?\d{2,4}[\s-]?\*{2,8}[\s-]?\d{4}\b/)?.[0];
  return card ? `Kaspi • ${card.replace(/\D/g, "").slice(-4)}` : "Рабочий Kaspi";
}

function parseTable(rows: Cell[][]): ParsedBankStatement {
  const header = detectHeader(rows);
  if (!header) throw new Error("STATEMENT_HEADER_NOT_FOUND");
  const { columns } = header;
  const transactions: ParsedBankStatementTransaction[] = [];
  let skippedRows = 0;
  rows.slice(header.index + 1).forEach((row, relativeIndex) => {
    const rowNumber = header.index + relativeIndex + 2;
    const operationDate = dateValue(row[columns.date]);
    const income = columns.income === null ? null : numeric(row[columns.income]);
    const expense = columns.expense === null ? null : numeric(row[columns.expense]);
    const signed = columns.amount === null ? null : numeric(row[columns.amount]);
    let direction: BankStatementDirection | null = null;
    let amount: number | null = null;
    if (income !== null && Math.abs(income) > 0) { direction = "INCOME"; amount = Math.abs(income); }
    else if (expense !== null && Math.abs(expense) > 0) { direction = "EXPENSE"; amount = Math.abs(expense); }
    else if (signed !== null && signed !== 0) {
      direction = signed < 0 ? "EXPENSE" : columns.direction === null ? "INCOME" : directionFrom(row[columns.direction]);
      amount = Math.abs(signed);
    }
    if (!direction && columns.direction !== null) direction = directionFrom(row[columns.direction]);
    if (!operationDate || !direction || amount === null || amount <= 0 || amount > 9_999_999_999.99) {
      if (row.some((cell) => clean(cell))) skippedRows += 1;
      return;
    }
    const headers = rows[header.index];
    const raw = Object.fromEntries(row.map((cell, index) => [clean(headers[index]) || `Колонка ${index + 1}`, typeof cell === "number" ? cell : clean(cell)]).slice(0, 40));
    transactions.push({
      rowNumber,
      operationDate,
      direction,
      amount,
      currency: columns.currency === null ? "KZT" : clean(row[columns.currency], 10).toUpperCase() || "KZT",
      counterparty: joined(row, columns.counterparty),
      description: joined(row, columns.description),
      reference: columns.reference === null ? null : clean(row[columns.reference], 200) || null,
      raw,
    });
  });
  if (!transactions.length) throw new Error("STATEMENT_ROWS_NOT_FOUND");
  if (transactions.length > MAX_BANK_STATEMENT_ROWS) throw new Error("STATEMENT_TOO_MANY_ROWS");
  return { provider: "KASPI", accountLabel: accountLabel(rows), totalRows: transactions.length + skippedRows, skippedRows, transactions };
}

function parseOneC(text: string): ParsedBankStatement | null {
  if (!/^1CClientBankExchange/im.test(text) && !/СекцияРасчСчет=/i.test(text)) return null;
  const account = text.match(/^РасчСчет=(.+)$/im)?.[1]?.trim() ?? null;
  const sections = text.split(/^СекцияДокумент=.*$/gim).slice(1);
  const transactions: ParsedBankStatementTransaction[] = [];
  let skippedRows = 0;
  sections.forEach((section, index) => {
    const values = new Map<string, string>();
    section.split(/\r?\n/).forEach((line) => {
      const separator = line.indexOf("=");
      if (separator > 0) values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    });
    const operationDate = dateValue(values.get("Дата") ?? null);
    const amount = numeric(values.get("Сумма") ?? null);
    const payerAccount = clean(values.get("ПлательщикСчет"));
    const recipientAccount = clean(values.get("ПолучательСчет"));
    const direction = account && payerAccount === account ? "EXPENSE" : account && recipientAccount === account ? "INCOME" : null;
    if (!operationDate || !amount || amount <= 0 || !direction) { skippedRows += 1; return; }
    const counterparty = direction === "INCOME" ? clean(values.get("Плательщик1")) : clean(values.get("Получатель1"));
    transactions.push({
      rowNumber: index + 1,
      operationDate,
      direction,
      amount,
      currency: "KZT",
      counterparty: counterparty || null,
      description: clean(values.get("НазначениеПлатежа"), 1000) || null,
      reference: clean(values.get("Номер"), 200) || null,
      raw: Object.fromEntries([...values.entries()].slice(0, 40)),
    });
  });
  if (!transactions.length) throw new Error("STATEMENT_ROWS_NOT_FOUND");
  return { provider: "KASPI", accountLabel: account ? `Kaspi • ${account.slice(-4)}` : "Рабочий Kaspi", totalRows: transactions.length + skippedRows, skippedRows, transactions };
}

export async function parseKaspiStatement(input: { fileName: string; contentType: string; bytes: Buffer }) {
  if (input.bytes.byteLength <= 0 || input.bytes.byteLength > MAX_BANK_STATEMENT_SIZE) throw new Error("INVALID_STATEMENT_SIZE");
  const ext = extension(input.fileName);
  if (ext === "pdf") throw new Error("PDF_USE_EXCEL");
  if (!BANK_STATEMENT_EXTENSIONS.has(ext)) throw new Error("UNSUPPORTED_STATEMENT_FORMAT");
  if (ext === "xlsx") {
    if (input.bytes[0] !== 0x50 || input.bytes[1] !== 0x4b) throw new Error("INVALID_STATEMENT_CONTENT");
    const rows = await readSheet(input.bytes, { trim: true });
    return parseTable(rows as unknown as Cell[][]);
  }
  const text = decodeText(input.bytes);
  return parseOneC(text) ?? parseTable(parseDelimited(text));
}
