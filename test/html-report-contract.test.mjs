import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

test("HTML report HTTP routes reuse suite scopes and support inline or attachment delivery", () => {
  assert.match(server, /latest-results-html/);
  assert.match(server, /suite-runs\\\/\(\[a-zA-Z0-9_-\]\+\)\\\/export\\\/html/);
  assert.match(server, /\["all", "failed"\]\.includes\(normalizedScope\)/);
  assert.match(server, /\["latest_run", "latest_per_case"\]/);
  assert.match(server, /download: \["1", "true"\]\.includes/);
});

test("HTML report responses alone permit same-origin framing with a restrictive CSP", () => {
  assert.match(server, /function sendHtmlReport/);
  assert.match(server, /"frame-ancestors 'self'"/);
  assert.match(server, /"X-Frame-Options": "SAMEORIGIN"/);
  assert.match(server, /"connect-src 'none'"/);
  assert.match(server, /"object-src 'none'"/);
  assert.match(server, /"Cache-Control": "no-store"/);
  assert.match(server, /download \? "attachment" : "inline"/);
  assert.match(server, /"X-Frame-Options": "DENY"/);
});
