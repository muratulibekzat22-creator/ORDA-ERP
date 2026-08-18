import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", "approved-ui-baseline.json"), "utf8"),
) as Record<string, string>;

assert.ok(Object.keys(manifest).length >= 8, "approved UI baseline is incomplete");
for (const [file, expected] of Object.entries(manifest)) {
  const source = fs.readFileSync(path.join(root, file));
  const actual = createHash("sha256").update(source).digest("hex");
  assert.equal(
    actual,
    expected,
    `${file} changed without an approved visual-baseline update`,
  );
}

console.log("Approved shared UI baseline passed");
