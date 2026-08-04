function clipped(value, max = 500) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function compactChecks(evaluation = {}) {
  const checks = evaluation.system?.checks || evaluation.checks || [];
  return checks.slice(0, 20).map((check) => ({
    label: clipped(check.label || check.name, 160),
    passed: Boolean(check.passed),
    reason: clipped(check.reason, 240)
  }));
}

export function buildSuiteSummaryContext(suiteRun = {}) {
  const cases = new Map(
    (suiteRun.suiteSnapshot?.cases || []).map((item) => [item.id || item.caseId, item])
  );
  return {
    suite: {
      id: suiteRun.suiteId || null,
      name: clipped(suiteRun.suiteName, 200),
      runId: suiteRun.id || null,
      status: suiteRun.status || null,
      completedAt: suiteRun.completedAt || null,
      summary: suiteRun.summary || {}
    },
    cases: (suiteRun.caseRuns || []).slice(0, 100).map((result) => {
      const testCase = cases.get(result.caseId) || {};
      const evaluation = result.evaluation || {};
      const business = evaluation.business || {};
      return {
        caseId: result.caseId,
        title: clipped(result.title || testCase.title, 200),
        prompt: clipped(testCase.prompt, 700),
        status: result.status,
        error: clipped(result.error || result.skipReason, 300),
        systemScore: evaluation.system?.score ?? evaluation.score ?? null,
        businessGrade: business.grade ?? null,
        businessSummary: clipped(business.summary, 300),
        durationMs: result.runSummary?.durationMs ?? null,
        sqlCount: result.runSummary?.sqlCount ?? 0,
        chartCount: result.runSummary?.chartCount ?? 0,
        checks: compactChecks(evaluation),
        businessItems: (business.itemResults || []).slice(0, 20).map((item) => ({
          criterion: clipped(item.criterion, 180),
          mark: item.mark || item.symbol || null,
          reason: clipped(item.reason, 240)
        }))
      };
    })
  };
}

export function normalizeSuiteAiSummary(value = {}, audit = {}) {
  const list = (items, max = 4) =>
    (Array.isArray(items) ? items : [])
      .map((item) => clipped(item, 240))
      .filter(Boolean)
      .slice(0, max);
  return {
    status: "succeeded",
    headline: clipped(value.headline, 100) || "テスト結果の総括",
    comment: clipped(value.comment, 900) || "全ケースの評価結果を確認しました。",
    strengths: list(value.strengths),
    concerns: list(value.concerns),
    nextActions: list(value.nextActions),
    generatedAt: audit.completedAt || new Date().toISOString(),
    provider: "vertex-ai",
    model: audit.model || null,
    modelVersion: audit.modelVersion || null,
    promptTemplateVersion: "suite-summary-v1",
    authSource: audit.authSource || null,
    responseId: audit.responseId || null,
    usageMetadata: audit.usageMetadata || null
  };
}
