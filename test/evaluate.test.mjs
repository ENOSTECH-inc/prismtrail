import test from "node:test";
import assert from "node:assert/strict";
import {
  appendContextEvaluation,
  composeEvaluation,
  evaluateRun,
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
  assert.deepEqual(summary.accuracyGrades, { A: 1, B: 0, C: 1, D: 0 });
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

test("combines system checks with A/B/C/D business accuracy grades", () => {
  const system = evaluateRun({
    events: [{ kind: "text.final_response", payload: { parts: ["65,200件です"] } }],
    summary: { errorCount: 0, sqlCount: 1 }
  }, { requireSql: true });
  const result = composeEvaluation(system, {
    grade: "B",
    confidence: 0.94,
    summary: "表記差のみです"
  }, {
    enabled: true,
    accuracyCriteria: "2026年6月の応募数は65,200件",
    passingGrade: "B"
  });
  assert.equal(result.status, "passed");
  assert.equal(result.business.grade, "B");
  assert.equal(result.business.score, 80);
  assert.equal(result.overall.businessPassed, true);
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
    accuracyCriteria: "正解条件",
    passingGrade: "B"
  });
  assert.equal(result.status, "review_required");
  assert.equal(result.business.status, "judge_error");
  assert.equal(result.business.grade, null);
  assert.equal(result.score, null);
});
