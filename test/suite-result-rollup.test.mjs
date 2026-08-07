import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLatestCaseResultReport,
  buildSuiteCaseResultRollup,
  suiteCaseIdsWithoutSuccess
} from "../lib/suite-result-rollup.mjs";

const suite = {
  id: "suite_1",
  name: "回帰テスト",
  cases: [
    { id: "case_a", title: "A", status: "active", prompt: "current A" },
    { id: "case_b", title: "B", status: "active", prompt: "current B" },
    { id: "case_c", title: "C", status: "active", prompt: "current C" },
    { id: "case_draft", title: "Draft", status: "draft" }
  ]
};

const suiteRuns = [
  {
    id: "run_new",
    suiteId: "suite_1",
    status: "failed",
    createdAt: "2026-08-07T03:00:00.000Z",
    completedAt: "2026-08-07T03:05:00.000Z",
    suiteSnapshot: { cases: [{ id: "case_a", title: "A latest", prompt: "executed A" }] },
    caseRuns: [{ caseId: "case_a", title: "A latest", status: "failed", runId: "single_a_new", evaluation: { score: 80 } }]
  },
  {
    id: "run_middle",
    suiteId: "suite_1",
    status: "passed",
    createdAt: "2026-08-07T02:00:00.000Z",
    completedAt: "2026-08-07T02:05:00.000Z",
    suiteSnapshot: { cases: [{ id: "case_b", title: "B", prompt: "executed B" }] },
    caseRuns: [{ caseId: "case_b", title: "B", status: "passed", runId: "single_b", evaluation: { score: 100 } }]
  },
  {
    id: "run_old",
    suiteId: "suite_1",
    status: "passed",
    createdAt: "2026-08-07T01:00:00.000Z",
    completedAt: "2026-08-07T01:05:00.000Z",
    suiteSnapshot: { cases: [{ id: "case_a", title: "A old", prompt: "old A" }] },
    caseRuns: [{ caseId: "case_a", title: "A old", status: "passed", runId: "single_a_old", evaluation: { score: 100 } }]
  },
  {
    id: "run_active",
    suiteId: "suite_1",
    status: "running",
    createdAt: "2026-08-07T04:00:00.000Z",
    caseRuns: [{ caseId: "case_c", status: "passed" }]
  },
  {
    id: "other_suite",
    suiteId: "suite_2",
    status: "passed",
    completedAt: "2026-08-07T05:00:00.000Z",
    caseRuns: [{ caseId: "case_c", status: "passed" }]
  }
];

test("rolls up latest, success, and failure timestamps by current case id", () => {
  const rollup = buildSuiteCaseResultRollup(suite, suiteRuns, {
    generatedAt: "2026-08-07T06:00:00.000Z"
  });
  const byId = new Map(rollup.cases.map((item) => [item.caseId, item]));
  assert.equal(byId.get("case_a").latestStatus, "failed");
  assert.equal(byId.get("case_a").latestSuiteRunId, "run_new");
  assert.equal(byId.get("case_a").latestSuccessSuiteRunId, "run_old");
  assert.equal(byId.get("case_a").latestFailureSuiteRunId, "run_new");
  assert.equal(byId.get("case_b").hasPassed, true);
  assert.equal(byId.get("case_c").latestResultAt, null);
  assert.equal(rollup.latestRun.id, "run_new");
  assert.deepEqual(rollup.summary, {
    totalCaseCount: 4,
    runnableCaseCount: 3,
    resultCaseCount: 2,
    passedHistoryCaseCount: 2,
    withoutSuccessCaseCount: 1
  });
});

test("selects only runnable cases that have never passed", () => {
  assert.deepEqual(suiteCaseIdsWithoutSuccess(suite, suiteRuns), ["case_c"]);
});

test("builds a synthetic report from each case latest result and keeps missing cases", () => {
  const report = buildLatestCaseResultReport(suite, suiteRuns, {
    generatedAt: "2026-08-07T06:00:00.000Z"
  });
  assert.equal(report.rollup.type, "latest_per_case");
  assert.deepEqual(report.rollup.sourceSuiteRunIds.sort(), ["run_middle", "run_new"]);
  assert.equal(report.caseRuns.length, 4);
  assert.equal(report.caseRuns[0].runId, "single_a_new");
  assert.equal(report.caseRuns[0].rollupSource.suiteRunId, "run_new");
  assert.equal(report.suiteSnapshot.cases[0].prompt, "executed A");
  assert.equal(report.caseRuns[2].status, "skipped");
  assert.match(report.caseRuns[2].skipReason, /実行結果がありません/);
  assert.equal(report.summary.total, 4);
  assert.equal(report.rollup.missingCaseCount, 2);
});
