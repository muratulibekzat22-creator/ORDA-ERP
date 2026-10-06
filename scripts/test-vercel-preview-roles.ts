import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const deployment = process.env.ORDA_PREVIEW_DEPLOYMENT;
const passwordFile = process.env.PREVIEW_TEST_PASSWORD_FILE;
if (!deployment || !/^https:\/\/[a-z0-9-]+\.vercel\.app$/u.test(deployment))
  throw new Error("ORDA_PREVIEW_DEPLOYMENT must be an HTTPS Vercel host");
if (!passwordFile) throw new Error("PREVIEW_TEST_PASSWORD_FILE is required");

const secrets = new Map<string, string>();
for (const line of readFileSync(passwordFile, "utf8").split(/\r?\n/u)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u);
  if (!match) continue;
  const quoted = match[2];
  secrets.set(match[1],
    ((quoted.startsWith('"') && quoted.endsWith('"')) || (quoted.startsWith("'") && quoted.endsWith("'")))
      ? quoted.slice(1, -1)
      : quoted,
  );
}

const accounts = [
  ["DIRECTOR", "director.test@altynsapa.kz", "ORDA_TEST_DIRECTOR_PASSWORD", "/api/settings"],
  ["MANAGER", "manager.test@altynsapa.kz", "ORDA_TEST_MANAGER_PASSWORD", "/api/orders"],
  ["ACCOUNTANT", "accountant.test@altynsapa.kz", "ORDA_TEST_ACCOUNTANT_PASSWORD", "/api/finance"],
  ["MEASURER", "measurer.test@altynsapa.kz", "ORDA_TEST_MEASURER_PASSWORD", "/api/measurements"],
  ["PRODUCTION", "production.test@altynsapa.kz", "ORDA_TEST_PRODUCTION_PASSWORD", "/api/production"],
  ["INSTALLER", "installer.test@altynsapa.kz", "ORDA_TEST_INSTALLER_PASSWORD", "/api/production"],
  ["PARTNER", "workshop.test@altynsapa.kz", "ORDA_TEST_WORKSHOP_PASSWORD", "/api/partner/dashboard"],
] as const;

const vercel = process.platform === "win32" ? process.execPath : "vercel";
const vercelPrefix = process.platform === "win32"
  ? [path.join(process.env.APPDATA ?? "", "npm", "node_modules", "vercel", "dist", "vc.js")]
  : [];
function request(route: string, curlArguments: string[]) {
  return execFileSync(
    vercel,
    [...vercelPrefix, "curl", route, "--deployment", deployment!, "--", "--silent", "--show-error", ...curlArguments],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function csrf(cookieJar: string) {
  return JSON.parse(request("/api/auth/csrf", ["--cookie-jar", cookieJar, "--cookie", cookieJar])) as { csrfToken: string };
}

for (const [role, email, passwordVariable, allowedRoute] of accounts) {
  const password = secrets.get(passwordVariable);
  assert(password, `missing ${passwordVariable}`);
  const temporary = mkdtempSync(path.join(tmpdir(), "orda-preview-login-"));
  const cookieJar = path.join(temporary, "cookies.txt");
  const responseHeaders = path.join(temporary, "callback-headers.txt");
  try {
    const token = csrf(cookieJar).csrfToken;
    const body = new URLSearchParams({ csrfToken: token, email, password, callbackUrl: deployment, json: "true" }).toString();
    request("/api/auth/callback/credentials", [
      "--cookie-jar", cookieJar,
      "--cookie", cookieJar,
      "--dump-header", responseHeaders,
      "--header", "Content-Type: application/x-www-form-urlencoded",
      "--data-raw", body,
    ]);
    const session = JSON.parse(request("/api/auth/session", ["--cookie", cookieJar])) as { user?: { role?: string } };
    assert.equal(session.user?.role, role, `${role} session role mismatch`);
    const status = request(allowedRoute, ["--cookie", cookieJar, "--output", process.platform === "win32" ? "NUL" : "/dev/null", "--write-out", "%{http_code}"]);
    assert.equal(status.trim(), "200", `${role} cannot access ${allowedRoute}`);

    const headers = readFileSync(responseHeaders, "utf8");
    const sessionCookie = headers.split(/\r?\n/u).find((line) => /^set-cookie:\s*(?:__Secure-)?next-auth\.session-token=/iu.test(line));
    assert(sessionCookie, `${role} session cookie is missing`);
    assert(/;\s*HttpOnly/iu.test(sessionCookie), `${role} session cookie is not HttpOnly`);
    assert(/;\s*Secure/iu.test(sessionCookie), `${role} session cookie is not Secure`);
    assert(/;\s*SameSite=Lax/iu.test(sessionCookie), `${role} session cookie SameSite is not Lax`);
    assert(!/;\s*Domain=/iu.test(sessionCookie), `${role} session cookie is not host-only`);

    if (role === "DIRECTOR") {
      const signoutToken = csrf(cookieJar).csrfToken;
      request("/api/auth/signout", [
        "--cookie-jar", cookieJar,
        "--cookie", cookieJar,
        "--header", "Content-Type: application/x-www-form-urlencoded",
        "--data-raw", new URLSearchParams({ csrfToken: signoutToken, callbackUrl: `${deployment}/login`, json: "true" }).toString(),
      ]);
      const signedOut = JSON.parse(request("/api/auth/session", ["--cookie", cookieJar])) as { user?: unknown };
      assert(!signedOut.user, "logout left the director session active");
    }
    console.log(`Preview role login passed: ${role}`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

console.log(`Preview auth, cookie and logout checks passed: ${accounts.length} roles`);
