import "./require-test-database";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { POST } from "@/app/api/integrations/bekzat/control/route";
const secret = "test-only-bridge-secret-not-for-production-0001";
const path = "/api/integrations/bekzat/control";
async function request(raw: string, timestamp: string, signingSecret = secret) {
  const signature = createHmac("sha256", signingSecret).update(`${timestamp}.POST.${path}.${raw}`).digest("hex");
  return POST(new Request(`https://test.local${path}`, { method: "POST", headers: { "x-bekzat-timestamp": timestamp, "x-bekzat-signature": signature }, body: raw }));
}
async function main() {
  process.env.FOUNDER_CONTROL_COMPANY_SLUG = "test-company";
  delete process.env.BEKZAT_CONTROL_SECRET;
  const now = String(Math.floor(Date.now() / 1000));
  assert.equal((await request('{"action":"inspect"}', now)).status, 503);
  process.env.BEKZAT_CONTROL_SECRET = secret;
  assert.equal((await request('{"action":"inspect"}', now, "wrong-secret")).status, 401);
  assert.equal((await request('{"action":"inspect"}', String(Number(now) - 600))).status, 401);
  assert.equal((await request('null', now)).status, 400);
  assert.equal((await request('{"action":"payroll"}', now)).status, 400);
  assert.equal((await request('{"action":"assign","keys":[15]}', now)).status, 400);
  assert.equal((await request('{"action":"inspect","month":"2026-99"}', now)).status, 400);
  console.log("BEKZAT bridge rejects missing configuration, wrong/stale signatures and invalid actions before database access");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
