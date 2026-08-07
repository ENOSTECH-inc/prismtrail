import test from "node:test";
import assert from "node:assert/strict";
import {
  appendContextEvaluation,
  collectRunSqlText,
  composeBusinessGrade,
  composeEvaluation,
  evaluateRun,
  formatCriteriaItems,
  parseCriteriaItems,
  sqlReferencesTable,
  summarizeSuiteRun
} from "../lib/evaluate.mjs";

test("evaluates configured expectations", () => {
  const run = {
    events: [
      { kind: "data.generated_sql", payload: "select 1" },
      { kind: "chart.result", payload: {} },
      { kind: "text.final_response", payload: { parts: ["売上の上位10件です"] } }
    ],
    summary: { errorCount: 0, sqlCount: 1, chartCount: 1, durationMs: 1000, totalBytesBilled: 200 }
  };
  const result = evaluateRun(run, {
    requireSql: true,
    requireChart: true,
    maxDurationMs: 2000,
    maxBytesBilled: 500,
    requiredPhrases: ["上位"]
  });
  assert.equal(result.status, "passed");
  assert.equal(result.score, 100);
});

test("response receipt is not an implicit system requirement", () => {
  const result = evaluateRun({ events: [], summary: { errorCount: 4 } }, {});
  assert.equal(result.status, "passed");
  assert.equal(result.score, 100);
  assert.deepEqual(result.checks, []);
  assert.equal(result.checks.some((check) => ["final-response", "no-error"].includes(check.id)), false);
});

test("response failures are reported separately and excluded from grades", () => {
  const summary = summarizeSuiteRun([
    {
      caseId: "ok",
      status: "passed",
      responseReceipt: { status: "received", httpStatus: 200 },
      evaluation: { score: 100, system: { status: "passed", score: 100 } }
    },
    {
      caseId: "retry",
      status: "error",
      error: "timeout",
      responseReceipt: { status: "not_received", httpStatus: null },
      evaluation: { status: "not_evaluated", score: null, system: { status: "not_evaluated", score: null } }
    }
  ]);
  assert.equal(summary.systemScore, 100);
  assert.equal(summary.passRate, 100);
  assert.equal(summary.evaluated, 1);
  assert.equal(summary.status, "failed");
  assert.deepEqual(summary.responseReceipt.retryCaseIds, ["retry"]);
  assert.equal(summary.responseReceipt.receiptRate, 50);
});

test("requiredSqlTables checks generated SQL identifiers, not answer text", () => {
  const run = {
    events: [
      {
        kind: "data.generated_sql",
        payload:
          "SELECT COUNT(*) AS cnt FROM `kyujinbox-prod-ds.marts_core.account_dim` WHERE partition_date = CURRENT_DATE()"
      },
      { kind: "text.final_response", payload: { parts: ["アカウント件数は100件です"] } }
    ],
    summary: { errorCount: 0, sqlCount: 1, chartCount: 0, durationMs: 800, totalBytesBilled: 10 }
  };
  const passed = evaluateRun(run, {
    requireSql: true,
    requiredSqlTables: ["account_dim", "marts_core.account_dim"]
  });
  assert.equal(passed.status, "passed");
  assert.ok(passed.checks.some((check) => check.id === "sql-table-account_dim" && check.passed));

  const failed = evaluateRun(run, {
    requireSql: true,
    requiredSqlTables: ["kyujin_dim"]
  });
  assert.equal(failed.status, "failed");
  assert.ok(failed.checks.some((check) => check.id === "sql-table-kyujin_dim" && !check.passed));
});

test("sqlReferencesTable uses identifier boundaries", () => {
  const sql = "SELECT * FROM account_dim JOIN account_dim_extra USING (id)";
  assert.equal(sqlReferencesTable(sql, "account_dim"), true);
  assert.equal(sqlReferencesTable(sql, "account_dim_extra"), true);
  assert.equal(sqlReferencesTable("SELECT * FROM account_dimension", "account_dim"), false);
  assert.equal(
    collectRunSqlText({
      events: [{ kind: "data.matched_query", payload: { exampleQuery: { sqlQuery: "SELECT 1 FROM visitor_dim" } } }]
    }),
    "SELECT 1 FROM visitor_dim"
  );
});

test("summarizes suite cases", () => {
  const summary = summarizeSuiteRun([
    { status: "passed", evaluation: { score: 100 }, run: { summary: { durationMs: 10, totalBytesBilled: 20 } } },
    { status: "failed", evaluation: { score: 50 }, run: { summary: { durationMs: 30, totalBytesBilled: 40 } } }
  ]);
  assert.equal(summary.passRate, 50);
  assert.equal(summary.score, 75);
  assert.equal(summary.systemScore, 75);
  assert.equal(summary.businessScore, null);
  assert.equal(summary.totalBytesBilled, 60);
});

test("skipped cases do not affect pass rate and still finish the suite", () => {
  const summary = summarizeSuiteRun([
    { status: "passed", evaluation: { score: 100 } },
    { status: "skipped", evaluation: { status: "skipped", score: null, checks: [] } },
    { status: "failed", evaluation: { score: 0 } }
  ]);
  assert.equal(summary.status, "failed");
  assert.equal(summary.skipped, 1);
  assert.equal(summary.evaluated, 2);
  assert.equal(summary.completed, 3);
  assert.equal(summary.passRate, 50);
});

test("cancelled cases finish the suite as cancelled without affecting pass rate", () => {
  const summary = summarizeSuiteRun([
    { status: "passed", evaluation: { score: 100 } },
    { status: "cancelled", evaluation: { status: "cancelled", score: null, checks: [] } },
    { status: "cancelled", evaluation: { status: "cancelled", score: null, checks: [] } }
  ]);
  assert.equal(summary.status, "cancelled");
  assert.equal(summary.cancelled, 2);
  assert.equal(summary.evaluated, 1);
  assert.equal(summary.passRate, 100);
});

test("summarizes system and business scores separately and weights the overall score", () => {
  const summary = summarizeSuiteRun([
    {
      status: "passed",
      evaluation: {
        score: 100,
        system: { status: "passed", score: 100 },
        business: { status: "passed", grade: "A", score: 100 }
      }
    },
    {
      status: "failed",
      evaluation: {
        score: 68,
        system: { status: "passed", score: 80 },
        business: { status: "review", grade: "C", score: 50 }
      }
    }
  ]);
  assert.equal(summary.systemScore, 90);
  assert.equal(summary.businessScore, 75);
  assert.equal(summary.score, 81);
  assert.deepEqual(summary.systemGrades, { A: 1, B: 0, C: 1, D: 0 });
  assert.deepEqual(summary.businessGrades, { A: 1, B: 0, C: 1, D: 0 });
});

test("adds Vertex knowledge-grounding result to deterministic checks", () => {
  const base = {
    status: "passed",
    score: 100,
    passedCount: 2,
    checkCount: 2,
    checks: [
      { id: "final", passed: true },
      { id: "error", passed: true }
    ]
  };
  const result = appendContextEvaluation(base, {
    passed: false,
    score: 40,
    reason: "資料の警告閾値と矛盾しています",
    citations: ["policy.md#2"]
  });
  assert.equal(result.status, "failed");
  assert.equal(result.checkCount, 3);
  assert.equal(result.contextJudge.citations[0], "policy.md#2");
});

test("combines system checks with checklist weather marks into A/B/C/D", () => {
  const system = evaluateRun({
    events: [{ kind: "text.final_response", payload: { parts: ["65,200件です"] } }],
    summary: { errorCount: 0, sqlCount: 1 }
  }, { requireSql: true });
  const result = composeEvaluation(system, {
    confidence: 0.94,
    summary: "軽微な表記差のみ",
    items: [
      { id: 1, criterion: "応募数が数値", mark: "sun", reason: "数値あり" },
      { id: 2, criterion: "期間が6月", mark: "cloud", reason: "月の明示が弱い" }
    ]
  }, {
    enabled: true,
    criteriaItems: ["応募数が数値", "期間が6月"],
    passingGrade: "B"
  });
  assert.equal(result.business.grade, "C"); // ratio 0.75
  assert.equal(result.business.score, 75);
  assert.equal(result.business.itemResults.length, 2);
  assert.equal(result.overall.businessPassed, false);
});

test("judges acceptance criteria even when legacy accuracy validation is disabled", () => {
  const system = evaluateRun({
    events: [{ kind: "text.final_response", payload: { parts: ["売上は100円です"] } }],
    summary: { errorCount: 0, sqlCount: 1 }
  }, { requireSql: true });
  const result = composeEvaluation(system, {
    items: [{ criterion: "売上が100円", mark: "sun", reason: "回答で確認" }]
  }, {
    enabled: true,
    criteriaItems: ["売上が100円"],
    passingGrade: "B",
    accuracyValidation: { enabled: false, sources: [] }
  });

  assert.equal(result.business.status, "passed");
  assert.equal(result.business.grade, "A");
});

test("composeBusinessGrade maps sun/cloud/rain ratios to A/B/C/D", () => {
  assert.equal(composeBusinessGrade(["sun", "sun"]).grade, "A");
  assert.equal(composeBusinessGrade(Array(9).fill("sun").concat("cloud")).grade, "B"); // 0.95
  assert.equal(composeBusinessGrade(["sun", "cloud"]).grade, "C"); // 0.75
  assert.equal(composeBusinessGrade(["rain", "rain"]).grade, "D");
  assert.equal(composeBusinessGrade(["sun", "bogus"]).invalid, true);
});

test("parseCriteriaItems prefers semicolon lists and keeps legacy prose as one item", () => {
  assert.deepEqual(parseCriteriaItems("a; b ; ;c"), ["a", "b", "c"]);
  assert.deepEqual(parseCriteriaItems("一文のまま、カンマあり"), ["一文のまま、カンマあり"]);
  assert.equal(formatCriteriaItems(["a", "b"]), "a; b");
});

test("keeps judge errors separate from D and requests review", () => {
  const system = evaluateRun({
    events: [{ kind: "text.final_response", payload: { parts: ["回答"] } }],
    summary: { errorCount: 0 }
  });
  const result = composeEvaluation(system, {
    evaluationError: true,
    reason: "Vertex AI timeout"
  }, {
    enabled: true,
    criteriaItems: ["正解条件"],
    passingGrade: "B"
  });
  assert.equal(result.status, "review_required");
  assert.equal(result.business.status, "judge_error");
  assert.equal(result.business.grade, null);
  assert.equal(result.score, null);
});
