import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function applicationSecret() {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value || value.length < 32) throw new Error("MFA_KEY_UNAVAILABLE");
  return value;
}

function encryptionKey() {
  return createHash("sha256").update(`orda:mfa:v1:${applicationSecret()}`).digest();
}

function base32Encode(bytes: Buffer) {
  let bits = 0, value = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string) {
  let bits = 0, accumulator = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error("INVALID_MFA_SECRET");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function encryptTotpSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function decryptTotpSecret(payload: string) {
  const [version, iv, ciphertext, tag] = payload.split(".");
  if (version !== "v1" || !iv || !ciphertext || !tag) throw new Error("INVALID_MFA_SECRET");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function totpAt(secret: string, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, now = Date.now()) {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(now / 30_000);
  return [-1, 0, 1].some((offset) => {
    const expected = Buffer.from(totpAt(secret, counter + offset));
    const actual = Buffer.from(normalized);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}

export function recoveryCodeHash(code: string) {
  return createHmac("sha256", applicationSecret()).update(`orda:recovery:v1:${code.replace(/[^a-z0-9]/gi, "").toUpperCase()}`).digest("hex");
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(9).toString("base64url").replace(/[^A-Z0-9]/gi, "").toUpperCase().padEnd(12, "X").slice(0, 12);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

export function provisioningUri(secret: string, email: string) {
  const issuer = "ORDA ERP";
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
