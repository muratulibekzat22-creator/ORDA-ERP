export const DEFAULT_COMPANY_PHONE_VALUES = [
  "+77085750881",
  "+77760027555",
] as const;

export type CompanyContactsInput = {
  phone?: unknown;
  secondaryPhone?: unknown;
  phones?: unknown;
} | null | undefined;

export function normalizeCompanyPhone(value: unknown) {
  if (typeof value !== "string") return "";
  let digits = value.replace(/\D/g, "");
  if (digits.length === 10) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (digits.length !== 11 || !digits.startsWith("7")) return "";
  return `+${digits}`;
}

export function formatCompanyPhone(value: unknown) {
  const normalized = normalizeCompanyPhone(value);
  if (!normalized) return "";
  const digits = normalized.slice(1);
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 11)}`;
}

export function companyPhoneValues(company?: CompanyContactsInput) {
  const candidates = Array.isArray(company?.phones)
    ? company.phones
    : company
      ? [company.phone, company.secondaryPhone]
      : DEFAULT_COMPANY_PHONE_VALUES;
  const normalized = candidates
    .map(normalizeCompanyPhone)
    .filter((value): value is string => Boolean(value));
  const unique = [...new Set(normalized)];
  return unique.length ? unique : [...DEFAULT_COMPANY_PHONE_VALUES];
}

export function companyDisplayPhones(company?: CompanyContactsInput) {
  return companyPhoneValues(company).map(formatCompanyPhone);
}

export function companyPhoneLines(company?: CompanyContactsInput) {
  return companyDisplayPhones(company).join("\n");
}
