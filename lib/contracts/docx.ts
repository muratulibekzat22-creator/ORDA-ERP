import fs from "node:fs/promises";
import path from "node:path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

import type { ContractSnapshot } from "@/lib/contracts/domain";

const TEMPLATE_PATH = path.join(process.cwd(), "resources", "documents", "templates", "contract-altyn-sapa-v2.docx");

function plainParagraph(xml: string) {
  return xml.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function paymentBlocks(xml: string, fullPayment: boolean) {
  return xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = plainParagraph(paragraph);
    if (fullPayment && (text.startsWith("Первый платёж") || text.startsWith("Оставшаяся сумма"))) return "";
    if (!fullPayment && text.includes("{{fullPaymentDueText}}")) return "";
    return paragraph;
  });
}

function escapeXml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function companyDetails(xml: string, snapshot: ContractSnapshot) {
  const replacements: Array<[string, string]> = [
    ["ALTYN SAPA COMPANY", snapshot.companyName],
    ["220540017969", snapshot.companyBin],
    ["KZ188562203118864809", snapshot.companyIik],
    ["АО Банк ЦентрКредит", snapshot.companyBank],
    ["KCJBKZKX", snapshot.companyBik],
    ["г. Алматы, ул. Муканова, 101", snapshot.companyAddress],
  ];
  return replacements.reduce((result, [from, to]) => to ? result.split(from).join(escapeXml(to)) : result, xml);
}

export async function generateContractDocx(snapshot: ContractSnapshot) {
  const source = await fs.readFile(TEMPLATE_PATH);
  const zip = new PizZip(source);
  const document = zip.file("word/document.xml");
  if (!document) throw new Error("INVALID_CONTRACT_TEMPLATE");
  zip.file("word/document.xml", paymentBlocks(document.asText(), snapshot.isFullPayment));
  const template = new Docxtemplater(zip, { delimiters: { start: "{{", end: "}}" }, paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  template.render({
    ...snapshot,
    companyPhoneLines: (snapshot.companyPhones?.length
      ? snapshot.companyPhones
      : [snapshot.companyPhone]).join("\n"),
  });
  const rendered = template.getZip().file("word/document.xml");
  if (!rendered) throw new Error("INVALID_CONTRACT_TEMPLATE");
  template.getZip().file("word/document.xml", companyDetails(rendered.asText(), snapshot));
  return template.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}
