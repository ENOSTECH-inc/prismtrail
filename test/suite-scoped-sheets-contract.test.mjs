import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = server.indexOf(`async function ${name}`);
  const end = server.indexOf(`async function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${nextName} must follow ${name}`);
  return server.slice(start, end);
}

test("legacy Sheet migration only auto-claims an unambiguous Suite", () => {
  const source = functionSource("migrateLegacySheetConnections", "sheetConnections");
  assert.match(source, /SHEET_CONNECTION_SCHEMA_VERSION/);
  assert.match(source, /!item\.suiteId && item\.migrationStatus !== "legacy_unbound"/);
  assert.match(source, /suitesForAgent\(suites, connection\.agentId\)/);
  assert.match(source, /candidates\.length === 1/);
  assert.match(source, /!claimedSpreadsheetIds\.has\(connection\.spreadsheetId\)/);
  assert.match(source, /item\.migrationStatus !== "legacy_unbound"/);
  assert.match(source, /migrationStatus: suiteId \? "claimed" : "legacy_unbound"/);
  assert.match(source, /status: suiteId \? connection\.status : "unbound"/);
  assert.doesNotMatch(source, /bootstrap\?*\.suiteId/);
});

test("Sheet catalogs contain one bound Suite and all of its registered Agents", () => {
  const source = functionSource("scopedSheetCatalog", "requireOwnedSheetConnection");
  assert.match(source, /new Set\(suiteAgentIds\(suite\)\)/);
  assert.match(source, /referencedIds\.has\(agent\.id\)/);
  assert.match(source, /agents\.length !== referencedIds\.size/);
  assert.match(source, /return \{ agents, suites: \[suite\] \}/);
  assert.doesNotMatch(source, /assertSuiteAgentScope/);
});

test("Suite Runs snapshot the Sheet destination at launch", () => {
  const source = functionSource("createSuiteRun", "autoExportSuiteRun");
  assert.match(source, /connection\.status === "ready" && connection\.suiteId === suite\.id/);
  assert.match(source, /sheetConnectionSnapshot: readyConnection/);
  assert.match(source, /connectionId: readyConnection\.id/);
  assert.match(source, /spreadsheetId: readyConnection\.spreadsheetId/);
  assert.match(source, /suiteId: suite\.id/);
});

test("automatic and manual report export route by Suite, never by similar Agent", () => {
  const automatic = functionSource("autoExportSuiteRun", "exportSuiteRunToSheetConnection");
  assert.match(automatic, /Object\.hasOwn\(suiteRun, "sheetConnectionSnapshot"\)/);
  assert.match(automatic, /hasSnapshot && !allowCurrentConnection \? null : currentConnection/);
  assert.match(automatic, /snapshotConflict/);
  assert.match(automatic, /item\.spreadsheetId === snapshot\.spreadsheetId && item\.suiteId !== suiteRun\.suiteId/);
  assert.match(automatic, /item\.suiteId === suiteRun\.suiteId/);
  assert.match(automatic, /assertConnectionSuiteScope\(connection, suiteRun\.suiteId/);
  assert.doesNotMatch(automatic, /reportAgentId/);
  assert.doesNotMatch(automatic, /item\.agentId ===/);

  const manual = functionSource("exportSuiteRunToSheetConnection", "createSuiteAiSummary");
  assert.match(manual, /assertConnectionSuiteScope\(connection, report\.suiteId/);
  assert.match(manual, /scopedSheetCatalog\(report\.suiteId\)/);
  assert.doesNotMatch(manual, /assertReportAgentScope/);
  assert.match(server, /autoExportSuiteRun\(suiteRun, \{ allowCurrentConnection: true \}\)/);
});

test("managed Sheet import updates only its bound Suite", () => {
  assert.match(server, /const existingSuite = await suiteStore\.get\(connection\.suiteId\)/);
  assert.match(server, /sourceSuiteId && sourceSuiteId !== existingSuite\.id/);
  assert.match(server, /シート内のSuite IDが一致しません/);
  assert.match(server, /normalizeSuite\(references\.suite, existingSuite\)/);
});
