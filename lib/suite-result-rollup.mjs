import { summarizeSuiteRun } from "./evaluate.mjs";

const ACTIVE_RUN_STATUSES = new Set(["running", "cancelling"]);
const FAILURE_CASE_STATUSES = new Set(["failed", "review_required", "error"]);

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function runCompletedAt(run = {}) {
  return run.completedAt || run.updatedAt || run.createdAt || null;
}

function caseCompletedAt(caseRun = {}, run = {}) {
  return caseRun.completedAt || caseRun.updatedAt || runCompletedAt(run);
}

function relevantRuns(suiteId, suiteRuns = []) {
  return (suiteRuns || [])
    .filter((run) => run?.suiteId === suiteId && !ACTIVE_RUN_STATUSES.has(run.status))
    .sort((left, right) => timestamp(runCompletedAt(right)) - timestamp(runCompletedAt(left)));
}

function collectSuiteCaseHistory(suite = {}, suiteRuns = []) {
  const currentCases = suite.cases || [];
  const currentIds = new Set(currentCases.map((item) => item.id).filter(Boolean));
  const records = new Map(currentCases.map((testCase) => [testCase.id, {
    caseId: testCase.id,
    title: testCase.title || testCase.id,
    runnable: String(testCase.status || "active").toLowerCase() !== "draft",
    latestResult: null,
    latestResultAt: null,
    latestStatus: null,
    latestSuiteRunId: null,
    latestSuccessAt: null,
    latestSuccessSuiteRunId: null,
    latestFailureAt: null,
    latestFailureSuiteRunId: null
  }]));
  const runs = relevantRuns(suite.id, suiteRuns);

  for (const run of runs) {
    for (const caseRun of run.caseRuns || []) {
      if (!currentIds.has(caseRun.caseId)) continue;
      const record = records.get(caseRun.caseId);
      const completedAt = caseCompletedAt(caseRun, run);
      const source = { suiteRunId: run.id, completedAt, run, caseRun };
      if (!record.latestResult || timestamp(completedAt) > timestamp(record.latestResultAt)) {
        record.latestResult = source;
        record.latestResultAt = completedAt;
        record.latestStatus = caseRun.status || null;
        record.latestSuiteRunId = run.id;
      }
      if (
        caseRun.status === "passed" &&
        (!record.latestSuccessAt || timestamp(completedAt) > timestamp(record.latestSuccessAt))
      ) {
        record.latestSuccessAt = completedAt;
        record.latestSuccessSuiteRunId = run.id;
      }
      if (
        FAILURE_CASE_STATUSES.has(caseRun.status) &&
        (!record.latestFailureAt || timestamp(completedAt) > timestamp(record.latestFailureAt))
      ) {
        record.latestFailureAt = completedAt;
        record.latestFailureSuiteRunId = run.id;
      }
    }
  }
  return { records, runs };
}

export function buildSuiteCaseResultRollup(suite = {}, suiteRuns = [], { generatedAt = new Date().toISOString() } = {}) {
  const { records, runs } = collectSuiteCaseHistory(suite, suiteRuns);
  const cases = (suite.cases || []).map((testCase) => {
    const record = records.get(testCase.id);
    return {
      caseId: testCase.id,
      title: testCase.title || testCase.id,
      runnable: record?.runnable ?? true,
      latestResultAt: record?.latestResultAt || null,
      latestStatus: record?.latestStatus || null,
      latestSuiteRunId: record?.latestSuiteRunId || null,
      latestSuccessAt: record?.latestSuccessAt || null,
      latestSuccessSuiteRunId: record?.latestSuccessSuiteRunId || null,
      latestFailureAt: record?.latestFailureAt || null,
      latestFailureSuiteRunId: record?.latestFailureSuiteRunId || null,
      hasPassed: Boolean(record?.latestSuccessAt)
    };
  });
  const runnable = cases.filter((item) => item.runnable);
  const latestRun = runs[0] || null;
  return {
    suiteId: suite.id,
    generatedAt,
    latestRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          createdAt: latestRun.createdAt || null,
          completedAt: runCompletedAt(latestRun),
          summary: latestRun.summary || null
        }
      : null,
    cases,
    summary: {
      totalCaseCount: cases.length,
      runnableCaseCount: runnable.length,
      resultCaseCount: cases.filter((item) => item.latestResultAt).length,
      passedHistoryCaseCount: runnable.filter((item) => item.hasPassed).length,
      withoutSuccessCaseCount: runnable.filter((item) => !item.hasPassed).length
    }
  };
}

export function suiteCaseIdsWithoutSuccess(suite = {}, suiteRuns = []) {
  return buildSuiteCaseResultRollup(suite, suiteRuns).cases
    .filter((item) => item.runnable && !item.hasPassed)
    .map((item) => item.caseId);
}

export function buildLatestCaseResultReport(suite = {}, suiteRuns = [], { generatedAt = new Date().toISOString() } = {}) {
  const { records } = collectSuiteCaseHistory(suite, suiteRuns);
  const sourceRunIds = new Set();
  const snapshotCases = [];
  const caseRuns = (suite.cases || []).map((currentCase) => {
    const source = records.get(currentCase.id)?.latestResult;
    if (!source) {
      snapshotCases.push(currentCase);
      return {
        caseId: currentCase.id,
        title: currentCase.title || currentCase.id,
        status: "skipped",
        reason: "保存済みの実行結果がありません。",
        skipReason: "保存済みの実行結果がありません。",
        responseReceipt: { status: "not_run" },
        runId: null,
        runSummary: null,
        rollupSource: null
      };
    }
    sourceRunIds.add(source.suiteRunId);
    const sourceCase = (source.run.suiteSnapshot?.cases || []).find(
      (item) => (item.id || item.caseId) === currentCase.id
    );
    snapshotCases.push(sourceCase ? { ...currentCase, ...sourceCase, id: currentCase.id } : currentCase);
    return {
      ...source.caseRun,
      caseId: currentCase.id,
      title: source.caseRun.title || sourceCase?.title || currentCase.title || currentCase.id,
      startedAt: source.caseRun.startedAt || source.run.createdAt || null,
      completedAt: source.completedAt,
      rollupSource: {
        suiteRunId: source.suiteRunId,
        completedAt: source.completedAt
      }
    };
  });
  const summary = summarizeSuiteRun(caseRuns);
  const withResults = caseRuns.filter((item) => item.rollupSource).length;
  return {
    schemaVersion: 3,
    id: `latest_results_${suite.id}`,
    suiteId: suite.id,
    suiteName: suite.name,
    reportTitle: `${suite.name || suite.id}｜ケース別最新結果`,
    status: summary.status,
    createdAt: generatedAt,
    updatedAt: generatedAt,
    completedAt: generatedAt,
    suiteSnapshot: { ...suite, cases: snapshotCases },
    caseRuns,
    summary,
    responseReceipt: summary.responseReceipt,
    aiSummary: {
      status: "succeeded",
      headline: "ケースIDごとの最新実行結果を集約",
      comment: `現在のテストスイート ${caseRuns.length}件に対し、保存済みの最新結果 ${withResults}件をケースIDで対応付けました。未実行ケースは評価対象外として表示します。`,
      strengths: [],
      concerns: [],
      nextActions: [],
      provider: "prismtrail",
      model: "deterministic-rollup"
    },
    improvementProposals: { status: "succeeded" },
    rollup: {
      type: "latest_per_case",
      generatedAt,
      sourceSuiteRunIds: [...sourceRunIds],
      resultCaseCount: withResults,
      missingCaseCount: caseRuns.length - withResults
    }
  };
}
