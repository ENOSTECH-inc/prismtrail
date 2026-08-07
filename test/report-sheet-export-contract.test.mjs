import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

test("manual report export persists a successful Sheet destination on the Suite Run", () => {
  const source = server.slice(
    server.indexOf("async function exportSuiteRunToSheetConnection"),
    server.indexOf("async function createSuiteAiSummary")
  );
  assert.match(source, /suiteRunStore\.get\(String\(suiteRunId/);
  assert.match(source, /isSuiteRunActive\(storedReport\)/);
  assert.match(source, /assertConnectionSuiteScope\(connection, report\.suiteId/);
  assert.match(source, /scopedSheetCatalog\(report\.suiteId\)/);
  assert.match(source, /writeReportSheet\(connection\.spreadsheetId, report\)/);
  assert.match(source, /writeCatalogSheets\(connection\.spreadsheetId, catalog\)/);
  assert.match(source, /trigger: "manual"/);
  assert.match(source, /suiteRunStore\.save\(\{\s*\.\.\.storedReport,\s*sheetExport,/s);
  assert.match(source, /report: slimSuiteRun\(\{ \.\.\.report, sheetExport, updatedAt: now \}\)/);
});

test("REST and MCP report exports share the persisted export path", () => {
  const matches = server.match(/exportSuiteRunToSheetConnection\(/g) || [];
  assert.ok(matches.length >= 3);
  assert.match(server, /await exportSuiteRunToSheetConnection\(connection, body\.suiteRunId\)/);
  assert.match(server, /const result = await exportSuiteRunToSheetConnection\(connection, reportId\)/);
});

test("latest-result Sheet export uses the shared corrected rollup without persisting a synthetic run", () => {
  const source = server.slice(
    server.indexOf("async function exportLatestSuiteResultsToSheetConnection"),
    server.indexOf("async function createSuiteAiSummary")
  );
  assert.match(source, /suiteStore\.get\(String\(suiteId/);
  assert.match(source, /assertConnectionSuiteScope\(connection, suite\.id/);
  assert.match(source, /latestSuiteResultsReport\(suite, mode\)/);
  assert.match(source, /normalizedMode === "latest_run"/);
  assert.match(source, /exportSuiteRunToSheetConnection\(connection, report\.id\)/);
  assert.match(source, /withSpreadsheetLock\(connection\.spreadsheetId/);
  assert.match(source, /writeReportSheet\(connection\.spreadsheetId, report\)/);
  assert.match(source, /writeCatalogSheets\(connection\.spreadsheetId, catalog\)/);
  assert.match(source, /latest-results-export:\$\{normalizedMode\}:\$\{suite\.id\}/);
  assert.doesNotMatch(source, /suiteRunStore\.save/);
  assert.match(server, /export-latest-results/);
  assert.match(server, /body\.suiteId/);
  assert.match(server, /body\.mode/);
});
