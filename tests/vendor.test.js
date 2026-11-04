import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

test("vendored files match their recorded hashes", () => {
  const dir = new URL("../public/vendor/", import.meta.url);
  const lines = readFileSync(new URL("SHA256SUMS", dir), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const [hash, name] = line.split(/\s+/);
    assert.equal(createHash("sha256").update(readFileSync(new URL(name, dir))).digest("hex"), hash, name);
  }
});
