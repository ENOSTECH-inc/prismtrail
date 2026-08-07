import { collectRunSqlText } from "./evaluate.mjs";
import { extractDataResultPreview } from "./run-preview.mjs";

const SECTION_KEYS = ["systemPrompt", "referenceQuery", "sourceMart", "other"];

function clipped(value, max = 2_500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function numericScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

export function overallGrade(score) {
  const value = numericScore(score);
  if (value === null) return null;
  if (value >= 100) return "A";
  if (value >= 90) return "B";
  if (value >= 50) return "C";
  return "D";
}

export function improvementEligibility(caseRun = {}) {
  if (["skipped", "cancelled"].includes(caseRun.status)) {
    return { eligible: false, reason: "not_executed" };
  }
  const score = numericScore(caseRun.evaluation?.score);
  if (score === 100) return { eligible: false, reason: "overall_grade_a", score, grade: "A" };
  if (score !== null) {
    return { eligible: score < 100, reason: "overall_grade_below_a", score, grade: overallGrade(score) };
  }
  if (["review_required", "error"].includes(caseRun.status)) {
    return { eligible: true, reason: "not_evaluated", score: null, grade: null };
  }
  return { eligible: false, reason: "no_eligible_evaluation", score: null, grade: null };
}

export function improvementTargetCaseIds(suiteRun = {}) {
  return (suiteRun.caseRuns || [])
    .filter((caseRun) => improvementEligibility(caseRun).eligible)
    .map((caseRun) => caseRun.caseId)
    .filter(Boolean);
}

function compactAgentConfiguration(value, { maxEntries = 80 } = {}) {
  const entries = [];
  const relevant = /instruction|prompt|example|query|data.?source|table|schema|column|relationship|glossary|context/i;
  const denied = /token|authorization|credential|secret|password/i;
  const visit = (node, path = [], depth = 0) => {
    if (entries.length >= maxEntries || depth > 6 || node == null) return;
    if (Array.isArray(node)) {
      node.slice(0, 20).forEach((item, index) => visit(item, [...path, String(index)], depth + 1));
      return;
    }
    if (typeof node === "object") {
      for (const [key, item] of Object.entries(node)) {
        if (denied.test(key)) continue;
        visit(item, [...path, key], depth + 1);
        if (entries.length >= maxEntries) break;
      }
      return;
    }
    const joined = path.join(".");
    if (relevant.test(joined)) entries.push({ path: joined, value: clipped(node, 1200) });
  };
  visit(value);
  return entries;
}

function finalAnswer(run = {}) {
  return clipped(
    (run.events || [])
      .filter((event) => event.kind === "text.final_response")
      .flatMap((event) => event.payload?.parts || [])
      .join("\n"),
    2500
  );
}

function boundedJsonValue(value, depth = 0) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return clipped(value, 500);
  if (depth >= 4) return "[省略]";
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => boundedJsonValue(item, depth + 1));
  if (typeof value !== "object") return clipped(value, 500);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/token|authorization|credential|secret|password/i.test(key))
      .slice(0, 20)
      .map(([key, item]) => [key, boundedJsonValue(item, depth + 1)])
  );
}

function sampleResults(run = {}) {
  const preview = extractDataResultPreview(run, { maxRows: 5, maxCols: 5 });
  return preview ? [preview] : [];
}

function compactEvaluation(evaluation = {}) {
  const system = evaluation.system || evaluation;
  const business = evaluation.business || {};
  return {
    overallScore: numericScore(evaluation.score),
    systemScore: numericScore(system.score),
    failedSystemChecks: (system.checks || [])
      .filter((check) => !check.passed)
      .slice(0, 20)
      .map((check) => ({ label: clipped(check.label, 180), actual: clipped(check.actual, 240), expected: clipped(check.expected, 240), reason: clipped(check.reason, 300) })),
    businessGrade: business.grade || null,
    businessSummary: clipped(business.summary, 500),
    businessItems: (business.itemResults || []).slice(0, 20).map((item) => ({
      criterion: clipped(item.criterion, 240),
      mark: item.mark || item.symbol || null,
      reason: clipped(item.reason, 400)
    }))
  };
}

export function buildCaseImprovementContext({ suiteRun = {}, caseRun = {}, run = {}, agentConfiguration = null } = {}) {
  const testCase = (suiteRun.suiteSnapshot?.cases || []).find(
    (item) => (item.id || item.caseId) === caseRun.caseId
  ) || {};
  const eligibility = improvementEligibility(caseRun);
  return {
    suite: { id: suiteRun.suiteId || null, name: clipped(suiteRun.suiteName, 200), runId: suiteRun.id || null },
    case: {
      id: caseRun.caseId,
      title: clipped(caseRun.title || testCase.title, 200),
      agentId: caseRun.agentId || testCase.agentId || suiteRun.suiteSnapshot?.defaultAgentId || null,
      prompt: clipped(testCase.prompt || run.question, 2500),
      memo: clipped(testCase.memo, 5000),
      expectations: boundedJsonValue(testCase.expectations || {}),
      executionStatus: caseRun.status || null,
      error: clipped(caseRun.error || caseRun.skipReason, 600),
      responseReceipt: caseRun.responseReceipt || null,
      sourceOverallScore: eligibility.score,
      sourceOverallGrade: eligibility.grade,
      eligibilityReason: eligibility.reason
    },
    evaluation: compactEvaluation(caseRun.evaluation || {}),
    evidence: {
      finalAnswer: finalAnswer(run),
      sql: clipped(collectRunSqlText(run), 6000),
      sampleResults: sampleResults(run),
      chartCount: Number(caseRun.runSummary?.chartCount || run.summary?.chartCount || 0),
      runSummary: boundedJsonValue(caseRun.runSummary || run.summary || null)
    },
    publishedAgentConfiguration: agentConfiguration
      ? compactAgentConfiguration(agentConfiguration)
      : [],
    publishedAgentConfigurationAvailable: Boolean(agentConfiguration),
    evidenceLimits: {
      note: "公開Agent設定と実行証跡は安全のため抜粋・上限付きです。見えていない列・テーブル・仕様を断定しないでください。"
    }
  };
}

function normalizeAction(value = {}) {
  if (typeof value === "string") {
    return { proposal: clipped(value, 2_500), rationale: "", expectedEffect: "" };
  }
  return {
    proposal: clipped(value.proposal, 2_500),
    rationale: clipped(value.rationale, 2_500),
    expectedEffect: clipped(value.expectedEffect, 1_200)
  };
}

function normalizeSection(value = {}) {
  return {
    summary: clipped(value.summary, 2_500),
    actions: (Array.isArray(value.actions) ? value.actions : [])
      .map(normalizeAction)
      .filter((item) => item.proposal)
      .slice(0, 3)
  };
}

export function normalizeCaseImprovementProposal(value = {}, {
  caseRun = {},
  audit = {},
  eligibility = improvementEligibility(caseRun)
} = {}) {
  const sections = {};
  for (const key of SECTION_KEYS) sections[key] = normalizeSection(value.sections?.[key]);
  if (caseRun.responseReceipt?.status && caseRun.responseReceipt.status !== "received") {
    for (const key of ["systemPrompt", "referenceQuery", "sourceMart"]) {
      sections[key] = {
        summary: "Data Agentのレスポンスを受領していないため、この区分は判断できません。",
        actions: []
      };
    }
  }
  return {
    schemaVersion: 1,
    status: "succeeded",
    eligible: true,
    eligibilityReason: eligibility.reason,
    caseId: caseRun.caseId,
    agentId: caseRun.agentId || null,
    sourceOverallScore: eligibility.score,
    sourceOverallGrade: eligibility.grade,
    diagnosis: clipped(value.diagnosis, 800),
    sections,
    evidenceGaps: (Array.isArray(value.evidenceGaps) ? value.evidenceGaps : [])
      .map((item) => clipped(item, 300))
      .filter(Boolean)
      .slice(0, 6),
    generatedAt: audit.completedAt || new Date().toISOString(),
    provider: "vertex-ai",
    model: audit.model || null,
    modelVersion: audit.modelVersion || null,
    promptTemplateVersion: "case-improvement-v1",
    authSource: audit.authSource || null,
    responseId: audit.responseId || null,
    usageMetadata: audit.usageMetadata || null
  };
}

export function failedCaseImprovementProposal(caseRun, message) {
  const eligibility = improvementEligibility(caseRun);
  return {
    schemaVersion: 1,
    status: "failed",
    eligible: true,
    eligibilityReason: eligibility.reason,
    caseId: caseRun.caseId,
    agentId: caseRun.agentId || null,
    sourceOverallScore: eligibility.score,
    sourceOverallGrade: eligibility.grade,
    message: clipped(message, 800),
    sections: Object.fromEntries(SECTION_KEYS.map((key) => [key, { summary: "", actions: [] }]))
  };
}

export { SECTION_KEYS as IMPROVEMENT_SECTION_KEYS };
