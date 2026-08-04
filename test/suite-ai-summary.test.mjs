import assert from "node:assert/strict";
import test from "node:test";
import { buildSuiteSummaryContext, normalizeSuiteAiSummary } from "../lib/suite-ai-summary.mjs";

test("builds a compact suite context without raw response traces", () => {
  const context = buildSuiteSummaryContext({
    id: "suite_run_1",
    suiteId: "suite_1",
    suiteName: "売上テスト",
    status: "failed",
    summary: { passed: 1, failed: 1, score: 70 },
    suiteSnapshot: {
      cases: [{ id: "case_1", title: "売上", prompt: "売上をSQL付きで回答してください" }]
    },
    caseRuns: [{
      caseId: "case_1",
      title: "売上",
      status: "failed",
      run: { rawMessages: [{ secret: "should-not-leak" }] },
      runSummary: { durationMs: 1200, sqlCount: 1, chartCount: 0 },
      evaluation: {
        system: { score: 50, checks: [{ label: "チャート必須", passed: false, reason: "図表なし" }] },
        business: { grade: "B", summary: "概ね一致", itemResults: [] }
      }
    }]
  });

  assert.equal(context.cases[0].prompt, "売上をSQL付きで回答してください");
  assert.equal(context.cases[0].sqlCount, 1);
  assert.equal(context.cases[0].checks[0].reason, "図表なし");
  assert.doesNotMatch(JSON.stringify(context), /should-not-leak|rawMessages/);
});

test("normalizes Gemini output into a bounded persisted AI comment", () => {
  const summary = normalizeSuiteAiSummary({
    headline: "全体として安定",
    comment: "10ケースの傾向を確認しました。",
    strengths: ["SQL生成が安定", "応答が高速"],
    concerns: ["図表不足"],
    nextActions: ["図表ケースを再確認"]
  }, {
    completedAt: "2026-08-04T00:00:00.000Z",
    model: "gemini-2.5-flash",
    responseId: "response_1"
  });

  assert.equal(summary.status, "succeeded");
  assert.equal(summary.headline, "全体として安定");
  assert.deepEqual(summary.nextActions, ["図表ケースを再確認"]);
  assert.equal(summary.promptTemplateVersion, "suite-summary-v1");
  assert.equal(summary.responseId, "response_1");
});
