import assert from "node:assert/strict";
import test from "node:test";
import {
  assertConnectionSuiteScope,
  assertReportAgentScope,
  assertSuiteAgentScope,
  reportAgentId,
  selectSheetConnectionBinding,
  selectSuiteSheetConnectionBinding,
  suiteAgentId,
  suiteAgentIds,
  suitesForAgent
} from "../lib/sheet-scope.mjs";

test("suite sheet scope is independent from the suite's agent composition", () => {
  const connection = { id: "sheet_a", suiteId: "suite_a", spreadsheetId: "spreadsheet_a" };
  assert.equal(assertConnectionSuiteScope(connection, "suite_a"), "suite_a");
  assert.throws(
    () => assertConnectionSuiteScope(connection, "suite_b"),
    /一致しません/
  );
  assert.throws(
    () => assertConnectionSuiteScope({ ...connection, suiteId: null }, "suite_a"),
    /再接続/
  );
});

test("suite sheet binding enforces one suite to one spreadsheet in both directions", () => {
  const connections = [
    { id: "sheet_a", suiteId: "suite_a", spreadsheetId: "spreadsheet_a" },
    { id: "legacy", suiteId: null, spreadsheetId: "spreadsheet_legacy" }
  ];
  assert.equal(
    selectSuiteSheetConnectionBinding(connections, "suite_a", "spreadsheet_new").id,
    "sheet_a"
  );
  assert.equal(
    selectSuiteSheetConnectionBinding(connections, "suite_b", "spreadsheet_legacy").id,
    "legacy"
  );
  assert.throws(
    () => selectSuiteSheetConnectionBinding(connections, "suite_b", "spreadsheet_a"),
    /別のテストスイート/
  );
  assert.throws(
    () => selectSuiteSheetConnectionBinding([
      ...connections,
      { id: "sheet_b", suiteId: "suite_b", spreadsheetId: "spreadsheet_b" }
    ], "suite_b", "spreadsheet_legacy"),
    /重複した接続/
  );
});

test("legacy Agent scope helper still rejects mixed-agent ownership", () => {
  const single = { defaultAgentId: "agent_a", cases: [{ agentId: "" }, { agentId: "agent_a" }] };
  const mixed = { defaultAgentId: "agent_a", cases: [{ agentId: "agent_b" }] };
  assert.deepEqual(suiteAgentIds(single), ["agent_a"]);
  assert.equal(suiteAgentId(single), "agent_a");
  assert.equal(suiteAgentId(mixed), null);
  assert.throws(() => assertSuiteAgentScope(mixed, "agent_a"), /一致しません/);
});

test("legacy Agent catalog helper remains available during migration", () => {
  const suites = [
    { id: "a", defaultAgentId: "agent_a", cases: [] },
    { id: "b", defaultAgentId: "agent_b", cases: [{ agentId: "agent_b" }] },
    { id: "mixed", defaultAgentId: "agent_a", cases: [{ agentId: "agent_b" }] }
  ];
  assert.deepEqual(suitesForAgent(suites, "agent_a").map((suite) => suite.id), ["a"]);
  assert.deepEqual(suitesForAgent(suites, "agent_b").map((suite) => suite.id), ["b"]);
});

test("report scope follows the immutable suite snapshot", () => {
  const report = { suiteSnapshot: { defaultAgentId: "agent_a", cases: [{ agentId: "agent_a" }] } };
  assert.equal(reportAgentId(report), "agent_a");
  assert.equal(assertReportAgentScope(report, "agent_a"), "agent_a");
  assert.throws(() => assertReportAgentScope(report, "agent_b"), /一致しません/);
});

test("single-case report falls back to its executed case agent", () => {
  const report = {
    partialRun: true,
    suiteSnapshot: {
      defaultAgentId: "agent_default",
      cases: [{ id: "case_1", agentId: "agent_case" }]
    },
    caseRuns: [{ caseId: "case_1", agentId: "agent_case" }]
  };
  assert.equal(reportAgentId(report), "agent_case");
  assert.equal(assertReportAgentScope(report, "agent_case"), "agent_case");
});

test("legacy Agent binding helper remains available during migration", () => {
  const connections = [
    { id: "sheet_a", agentId: "agent_a", spreadsheetId: "spreadsheet_a" },
    { id: "legacy", agentId: null, spreadsheetId: "spreadsheet_legacy" }
  ];
  assert.equal(selectSheetConnectionBinding(connections, "agent_a", "spreadsheet_new").id, "sheet_a");
  assert.equal(selectSheetConnectionBinding(connections, "agent_b", "spreadsheet_legacy").id, "legacy");
  assert.throws(
    () => selectSheetConnectionBinding(connections, "agent_b", "spreadsheet_a"),
    /別のData Agent/
  );
});
