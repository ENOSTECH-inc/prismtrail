import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCaseImprovementContext,
  IMPROVEMENT_SECTION_KEYS,
  improvementEligibility,
  improvementTargetCaseIds,
  normalizeCaseImprovementProposal
} from "../lib/improvement-proposals.mjs";

test("selects every non-A evaluated case and actionable unevaluated case", () => {
  const suiteRun = {
    caseRuns: [
      { caseId: "a", status: "passed", evaluation: { score: 100 } },
      { caseId: "b", status: "passed", evaluation: { score: 95 } },
      { caseId: "c", status: "failed", evaluation: { score: 70 } },
      { caseId: "review", status: "review_required", evaluation: { score: null } },
      { caseId: "error", status: "error", evaluation: { score: null } },
      { caseId: "skip", status: "skipped", evaluation: { score: null } },
      { caseId: "cancel", status: "cancelled", evaluation: { score: null } }
    ]
  };
  assert.deepEqual(improvementTargetCaseIds(suiteRun), ["b", "c", "review", "error"]);
  assert.deepEqual(improvementEligibility(suiteRun.caseRuns[0]), {
    eligible: false,
    reason: "overall_grade_a",
    score: 100,
    grade: "A"
  });
});

test("builds bounded evidence without raw messages or credentials", () => {
  const context = buildCaseImprovementContext({
    suiteRun: {
      id: "suite_run_1",
      suiteId: "suite_1",
      suiteName: "改善テスト",
      suiteSnapshot: {
        cases: [{ id: "case_1", prompt: "売上を教えて", memo: "martの列定義", expectations: { requireSql: true } }]
      }
    },
    caseRun: {
      caseId: "case_1",
      status: "failed",
      evaluation: { score: 80, system: { score: 80, checks: [{ passed: false, label: "SQL" }] } }
    },
    run: {
      rawMessages: [{ token: "secret-token", body: "do not include" }],
      events: [
        { kind: "data.generated_sql", payload: "SELECT 1" },
        { kind: "text.final_response", payload: { parts: ["回答"] } }
      ]
    },
    agentConfiguration: {
      systemInstruction: "必ず期間を確認する",
      authToken: "secret-token",
      exampleQueries: [{ query: "SELECT COUNT(*) FROM mart.fact" }]
    }
  });
  const serialized = JSON.stringify(context);
  assert.match(serialized, /必ず期間を確認する/);
  assert.match(serialized, /SELECT COUNT/);
  assert.match(serialized, /SELECT 1/);
  assert.doesNotMatch(serialized, /secret-token|rawMessages|do not include/);
});

test("bounds result columns, cell lengths, and nested expectations before Gemini", () => {
  const wideRow = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [`column_${index}`, "x".repeat(2_000)])
  );
  const context = buildCaseImprovementContext({
    suiteRun: {
      id: "suite_run_bounded",
      suiteId: "suite_1",
      suiteSnapshot: {
        cases: [{
          id: "case_bounded",
          expectations: { nested: { secretToken: "hide", notes: "y".repeat(20_000) } }
        }]
      }
    },
    caseRun: { caseId: "case_bounded", status: "failed", evaluation: { score: 50 } },
    run: { events: [{ kind: "data.result", payload: { formattedData: [wideRow] } }] }
  });
  assert.equal(context.evidence.sampleResults[0].headers.length, 5);
  assert.ok(context.evidence.sampleResults[0].rows[0].every((cell) => cell.length <= 36));
  assert.equal(JSON.stringify(context).includes("secretToken"), false);
  assert.ok(JSON.stringify(context).length < 30_000);
});

test("normalizes the fixed four sections and bounds actions", () => {
  const caseRun = { caseId: "case_1", agentId: "agent_1", status: "failed", evaluation: { score: 80 } };
  const actions = Array.from({ length: 5 }, (_, index) => ({
    proposal: `提案${index + 1}`,
    rationale: "根拠",
    expectedEffect: "効果"
  }));
  const proposal = normalizeCaseImprovementProposal({
    diagnosis: "期間解釈にずれがあります",
    sections: {
      systemPrompt: { summary: "指示改善", actions },
      referenceQuery: { status: "needs_action", summary: "SQL改善", actions: [] },
      sourceMart: { status: "no_issue", summary: "このコメントは破棄される", actions }
    },
    evidenceGaps: ["現在の前処理仕様"]
  }, { caseRun, audit: { model: "gemini-test", completedAt: "2026-08-07T00:00:00.000Z" } });
  assert.deepEqual(Object.keys(proposal.sections), ["systemPrompt", "referenceQuery", "sourceMart", "other"]);
  assert.equal(proposal.sections.systemPrompt.status, "needs_action");
  assert.equal(proposal.sections.systemPrompt.actions.length, 3);
  assert.deepEqual(proposal.sections.sourceMart, { status: "no_issue", summary: "", actions: [] });
  assert.deepEqual(proposal.sections.other, { status: "no_issue", summary: "", actions: [] });
  assert.equal(proposal.schemaVersion, 2);
  assert.equal(proposal.model, "gemini-test");
  assert.equal(proposal.sourceOverallGrade, "C");
});

test("keeps no-response commentary out of configuration and mart sections", () => {
  const proposal = normalizeCaseImprovementProposal({
    sections: Object.fromEntries(IMPROVEMENT_SECTION_KEYS.map((key) => [key, {
      summary: `${key}を変更`,
      actions: [{ proposal: `${key}の変更案` }]
    }]))
  }, {
    caseRun: {
      caseId: "case_no_response",
      status: "error",
      responseReceipt: { status: "not_received", httpStatus: 503 },
      evaluation: { score: null }
    }
  });
  for (const key of ["systemPrompt", "referenceQuery", "sourceMart"]) {
    assert.deepEqual(proposal.sections[key], { status: "no_issue", summary: "", actions: [] });
  }
  assert.equal(proposal.sections.other.status, "needs_action");
  assert.equal(proposal.sections.other.summary, "otherを変更");
});
