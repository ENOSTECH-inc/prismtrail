import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const googleCloud = await readFile(new URL("../lib/google-cloud.mjs", import.meta.url), "utf8");

test("Data Agent HTTP outcome is retained without reusing the REST error status field", () => {
  assert.match(googleCloud, /httpStatus: response\.status/);
  assert.match(googleCloud, /error\.httpStatus = response\.status/);
  assert.match(googleCloud, /error\.responseErrorKind = "http_error"/);
  assert.match(googleCloud, /error\.responseErrorKind = "timeout"/);
  assert.doesNotMatch(googleCloud, /error\.status = response\.status/);
});

test("response-failure reruns use persisted targets and the immutable suite snapshot", () => {
  const source = server.slice(
    server.indexOf("async function rerunResponseFailures"),
    server.indexOf("async function cancelSuiteRun")
  );
  assert.match(source, /source\.responseReceipt\?\.retryCaseIds/);
  assert.match(source, /source\.suiteSnapshot/);
  assert.match(source, /retryOfSuiteRunId: source\.id/);
  assert.match(source, /retryReason: "response_not_received"/);
  assert.doesNotMatch(source, /body\?\.caseIds/);
  assert.match(server, /\/rerun-response-failures\$\//);
});

test("suite cases persist response receipt separately from evaluation", () => {
  assert.match(server, /responseReceipt: \{\s*status: "received"/s);
  assert.match(server, /status: "not_evaluated"/);
  assert.match(server, /suiteRun\.responseReceipt = suiteResponseReceipt/);
  assert.match(server, /if \(signal\.aborted\) \{/);
});
