function assertion(id, label, passed, actual, expected) {
  return { id, label, passed: Boolean(passed), actual, expected };
}

export function evaluateRun(run, expectations = {}) {
  const systemRequirements = expectations.systemRequirements || expectations;
  const summary = run.summary || {};
  const kinds = new Set((run.events || []).map((event) => event.kind));
  const checks = [
    assertion(
      "final-response",
      "最終回答が返る",
      kinds.has("text.final_response"),
      kinds.has("text.final_response"),
      true
    ),
    assertion("no-error", "エラーなく完了", Number(summary.errorCount || 0) === 0, summary.errorCount || 0, 0)
  ];

  if (systemRequirements.requireSql) {
    checks.push(assertion("sql", "SQLを生成・実行", Number(summary.sqlCount || 0) > 0, summary.sqlCount || 0, "1以上"));
  }
  if (systemRequirements.requireChart) {
    checks.push(assertion("chart", "チャートを生成", Number(summary.chartCount || 0) > 0, summary.chartCount || 0, "1以上"));
  }
  if (Number(systemRequirements.maxDurationMs) > 0) {
    checks.push(
      assertion(
        "duration",
        "実行時間の上限",
        Number(summary.durationMs || 0) <= Number(systemRequirements.maxDurationMs),
        summary.durationMs || 0,
        systemRequirements.maxDurationMs
      )
    );
  }
  if (Number(systemRequirements.maxBytesBilled) > 0) {
    checks.push(
      assertion(
        "bytes-billed",
        "課金バイトの上限",
        Number(summary.totalBytesBilled || 0) <= Number(systemRequirements.maxBytesBilled),
        summary.totalBytesBilled || 0,
        systemRequirements.maxBytesBilled
      )
    );
  }

  const requiredPhrases = Array.isArray(systemRequirements.requiredPhrases)
    ? systemRequirements.requiredPhrases.map(String).filter(Boolean)
    : [];
  const responseText = (run.events || [])
    .filter((event) => event.kind === "text.final_response")
    .flatMap((event) => event.payload?.parts || [])
    .join("\n");
  for (const phrase of requiredPhrases) {
    checks.push(
      assertion(
        `phrase-${phrase}`,
        `回答に「${phrase}」を含む`,
        responseText.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()),
        responseText.includes(phrase),
        true
      )
    );
  }

  const passedCount = checks.filter((check) => check.passed).length;
  const score = checks.length ? Math.round((passedCount / checks.length) * 100) : 0;
  const system = {
    status: checks.every((check) => check.passed) ? "passed" : "failed",
    score,
    passedCount,
    checkCount: checks.length,
    checks
  };
  return {
    ...system,
    schemaVersion: 2,
    system,
    business: {
      status: "not_configured",
      grade: null,
      symbol: null,
      score: null,
      passed: null
    },
    overall: {
      status: system.status,
      score: system.score,
      systemPassed: system.status === "passed",
      businessPassed: null
    }
  };
}

export const ACCURACY_GRADES = {
  A: { score: 100, symbol: "◎", label: "完全一致", rank: 0 },
  B: { score: 80, symbol: "○", label: "おおむね一致", rank: 1 },
  C: { score: 50, symbol: "△", label: "一部不一致", rank: 2 },
  D: { score: 0, symbol: "×", label: "不一致", rank: 3 }
};

export function composeEvaluation(systemEvaluation, judgeResult, businessRequirements = {}) {
  const system = systemEvaluation.system || systemEvaluation;
  const criteria = String(businessRequirements.accuracyCriteria || "").trim();
  const enabled = businessRequirements.enabled !== false && Boolean(criteria);
  if (!enabled) {
    return {
      ...systemEvaluation,
      schemaVersion: 2,
      system,
      business: {
        status: "not_configured",
        grade: null,
        symbol: null,
        score: null,
        passed: null,
        expectedCriteria: ""
      },
      overall: {
        status: system.status,
        score: system.score,
        systemPassed: system.status === "passed",
        businessPassed: null
      }
    };
  }

  const passingGrade = ["A", "B", "C", "D"].includes(businessRequirements.passingGrade)
    ? businessRequirements.passingGrade
    : "B";
  if (judgeResult?.evaluationError) {
    const business = {
      status: "judge_error",
      grade: null,
      symbol: null,
      score: null,
      passingGrade,
      passed: null,
      confidence: null,
      summary: String(judgeResult.reason || "精度判定を完了できませんでした。"),
      expectedCriteria: criteria,
      extractedFacts: [],
      evidence: [],
      discrepancies: [],
      judgeAudit: judgeResult.judgeAudit || null
    };
    return {
      ...systemEvaluation,
      schemaVersion: 2,
      status: "review_required",
      score: null,
      system,
      business,
      overall: {
        status: "review_required",
        score: null,
        systemPassed: system.status === "passed",
        businessPassed: null
      }
    };
  }

  const grade = String(judgeResult?.grade || "").toUpperCase();
  const gradeDefinition = ACCURACY_GRADES[grade];
  if (!gradeDefinition) {
    return composeEvaluation(systemEvaluation, {
      evaluationError: true,
      reason: "Vertex AIから有効なA/B/C/D評価が返りませんでした。",
      judgeAudit: judgeResult?.judgeAudit
    }, businessRequirements);
  }
  const passed = gradeDefinition.rank <= ACCURACY_GRADES[passingGrade].rank;
  const business = {
    status: passed ? "passed" : grade === "C" ? "review" : "failed",
    grade,
    symbol: gradeDefinition.symbol,
    label: gradeDefinition.label,
    score: gradeDefinition.score,
    passingGrade,
    passed,
    confidence: Math.max(0, Math.min(1, Number(judgeResult.confidence || 0))),
    summary: String(judgeResult.summary || judgeResult.reason || ""),
    expectedCriteria: criteria,
    extractedFacts: Array.isArray(judgeResult.extractedFacts) ? judgeResult.extractedFacts : [],
    evidence: Array.isArray(judgeResult.evidence) ? judgeResult.evidence : [],
    discrepancies: Array.isArray(judgeResult.discrepancies) ? judgeResult.discrepancies : [],
    judgeAudit: judgeResult.judgeAudit || null
  };
  const status = system.status === "passed" && passed ? "passed" : "failed";
  const score = Math.round(Number(system.score || 0) * 0.4 + gradeDefinition.score * 0.6);
  return {
    ...systemEvaluation,
    schemaVersion: 2,
    status,
    score,
    system,
    business,
    overall: {
      status,
      score,
      systemPassed: system.status === "passed",
      businessPassed: passed
    }
  };
}

export function appendContextEvaluation(evaluation, judge) {
  const passed = judge?.passed === true;
  const check = {
    id: "knowledge-grounding",
    label: "GCSナレッジとの整合",
    passed,
    actual: {
      score: Math.max(0, Math.min(100, Number(judge?.score || 0))),
      reason: String(judge?.reason || ""),
      citations: Array.isArray(judge?.citations) ? judge.citations : []
    },
    expected: "明確な矛盾・重要条件の欠落なし"
  };
  const checks = [...(evaluation.checks || []), check];
  const passedCount = checks.filter((item) => item.passed).length;
  const score = Math.round((passedCount / checks.length) * 100);
  const system = {
    status: checks.every((item) => item.passed) ? "passed" : "failed",
    score,
    passedCount,
    checkCount: checks.length,
    checks
  };
  return {
    ...evaluation,
    ...system,
    system,
    contextJudge: judge
  };
}

export function summarizeSuiteRun(caseRuns = []) {
  const finished = caseRuns.filter((item) =>
    ["passed", "failed", "review_required", "skipped"].includes(item.status)
  );
  const completed = caseRuns.filter((item) =>
    ["passed", "failed", "review_required"].includes(item.status)
  );
  const skipped = caseRuns.filter((item) => item.status === "skipped").length;
  const passed = completed.filter((item) => item.status === "passed").length;
  const reviewRequired = completed.filter((item) => item.status === "review_required").length;
  const totalDurationMs = caseRuns.reduce(
    (sum, item) => sum + Number(item.runSummary?.durationMs || item.run?.summary?.durationMs || 0),
    0
  );
  const totalBytesBilled = caseRuns.reduce(
    (sum, item) =>
      sum + Number(item.runSummary?.totalBytesBilled || item.run?.summary?.totalBytesBilled || 0),
    0
  );
  const systemScores = completed
    .map((item) => item.evaluation?.system?.score ?? item.evaluation?.score)
    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(Number);
  const systemScore = systemScores.length
    ? Math.round(systemScores.reduce((sum, value) => sum + value, 0) / systemScores.length)
    : 0;
  const grades = { A: 0, B: 0, C: 0, D: 0 };
  for (const item of completed) {
    const grade = item.evaluation?.business?.grade;
    if (grade in grades) grades[grade] += 1;
  }
  const businessEvaluated = Object.values(grades).reduce((sum, count) => sum + count, 0);
  const businessConfigured = completed.filter(
    (item) => item.evaluation?.business && item.evaluation.business.status !== "not_configured"
  ).length;
  const businessScores = completed
    .map((item) => item.evaluation?.business?.score)
    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(Number);
  const businessScore = businessScores.length
    ? Math.round(businessScores.reduce((sum, value) => sum + value, 0) / businessScores.length)
    : null;
  const score =
    businessConfigured === 0
      ? systemScore
      : businessScore === null || businessScores.length < businessConfigured
        ? null
        : Math.round(systemScore * 0.4 + businessScore * 0.6);
  const businessPassed = grades.A + grades.B;
  const systemPassed = completed.filter(
    (item) => (item.evaluation?.system?.status || item.evaluation?.status) === "passed"
  ).length;
  const failed = completed.filter((item) => item.status === "failed").length;
  return {
    status:
      finished.length !== caseRuns.length
        ? "running"
        : completed.some((item) => item.status === "failed")
          ? "failed"
          : reviewRequired
            ? "review_required"
            : "passed",
    total: caseRuns.length,
    completed: finished.length,
    evaluated: completed.length,
    skipped,
    runnable: completed.length,
    passed,
    failed,
    reviewRequired,
    passRate: completed.length ? Math.round((passed / completed.length) * 100) : 0,
    score,
    systemScore,
    businessScore,
    systemPassed,
    systemPassRate: completed.length ? Math.round((systemPassed / completed.length) * 100) : 0,
    businessEvaluated,
    businessConfigured,
    businessPassed,
    businessPassRate: businessEvaluated ? Math.round((businessPassed / businessEvaluated) * 100) : 0,
    accuracyGrades: grades,
    totalDurationMs,
    totalBytesBilled
  };
}
