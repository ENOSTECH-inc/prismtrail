import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

test("suite run scope is recomputed from persisted success history on the server", () => {
  const source = server.slice(
    server.indexOf("async function startSuiteRun"),
    server.indexOf("async function rerunSuiteResponseFailures")
  );
  assert.match(source, /normalizedScope === "without_success"/);
  assert.match(source, /correctedSuiteRunsForRollup\(suite\.id, suiteRuns\)/);
  assert.match(source, /実行可能なケースはすべて成功履歴があります/);
  assert.match(source, /suiteRun\.runScope = normalizedScope/);
  assert.match(server, /scope: body\?\.scope/);
});

test("suite latest-result endpoints expose rollup metadata and shared export modes", () => {
  assert.match(server, /result-rollup/);
  assert.match(server, /buildSuiteCaseResultRollup\(suite, await correctedSuiteRunsForRollup\(suite\.id\)\)/);
  assert.match(server, /latest-results-pdf/);
  assert.match(server, /normalizedMode === "latest_run"/);
  assert.match(server, /\["latest_run", "latest_per_case"\]/);
  assert.match(server, /buildLatestCaseResultReport/);
  assert.match(server, /correctedSuiteRunView/);
  assert.match(server, /pdfRunBodies\(report\)/);
});

test("rollup history applies the same legacy SQL correction as report views", () => {
  const source = server.slice(
    server.indexOf("async function correctedSuiteRunsForRollup"),
    server.indexOf("function sheetConnectionProjection")
  );
  assert.match(source, /correctedSuiteRunView\(run\)/);
  assert.match(source, /isSuiteRunActive\(run\) \? run/);
});
