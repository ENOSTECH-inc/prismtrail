import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReportAgentScope,
  assertSuiteAgentScope,
  reportAgentId,
  selectSheetConnectionBinding,
  suiteAgentId,
  suiteAgentIds,
  suitesForAgent
} from "../lib/sheet-scope.mjs";

test("suite scope resolves one effective agent and rejects mixed-agent suites", () => {
  const single = { defaultAgentId: "agent_a", cases: [{ agentId: "" }, { agentId: "agent_a" }] };
  const mixed = { defaultAgentId: "agent_a", cases: [{ agentId: "agent_b" }] };
  assert.deepEqual(suiteAgentIds(single), ["agent_a"]);
  assert.equal(suiteAgentId(single), "agent_a");
  assert.equal(suiteAgentId(mixed), null);
  assert.throws(() => assertSuiteAgentScope(mixed, "agent_a"), /一致しません/);
});

test("suite catalogs are isolated to the linked agent", () => {
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

test("sheet connection binding enforces one agent to one spreadsheet", () => {
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
