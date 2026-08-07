function assertion(id, label, passed, actual, expected) {
  return { id, label, passed: Boolean(passed), actual, expected };
}

/** Collect SQL text from generated SQL, matched queries, and BigQuery job configs. */
export function collectRunSqlText(run = {}) {
  const parts = [];
  for (const event of run.events || []) {
    if (event.kind === "data.generated_sql") {
      const payload = event.payload;
      if (typeof payload === "string") parts.push(payload);
      else if (payload && typeof payload === "object") {
        parts.push(payload.query || payload.sql || payload.sqlQuery || "");
      }
    }
    if (event.kind === "data.matched_query") {
      const payload = event.payload || {};
      parts.push(
        payload.sqlQuery ||
          payload.exampleQuery?.sqlQuery ||
          payload.matchedQuery?.exampleQuery?.sqlQuery ||
          ""
      );
    }
  }
  for (const job of run.jobs || []) {
    const query = job?.configuration?.query?.query;
    if (query) parts.push(String(query));
  }
  return parts.map((item) => String(item || "").trim()).filter(Boolean).join("\n");
}

/**
 * True when SQL references the table as an identifier (bare name or dataset.table).
 * Does not require a FROM-only match so JOIN / subquery aliases still count.
 */
export function sqlReferencesTable(sqlText, tableName) {
  const raw = String(tableName || "").trim().toLowerCase();
  const sql = String(sqlText || "");
  if (!raw || !sql) return false;
  const bare = raw.includes(".") ? raw.split(".").pop() : raw;
  if (!/^[a-z_][a-z0-9_]*$/i.test(bare)) {
    const lower = sql.toLowerCase();
    return lower.includes(raw) || lower.includes(bare);
  }
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9_])${escaped}(?![a-z0-9_])`, "i").test(sql);
}

export function evaluateRun(run, expectations = {}) {
  const systemRequirements = expectations.systemRequirements || expectations;
  const summary = run.summary || {};
  const checks = [];

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

  const requiredSqlTables = Array.isArray(systemRequirements.requiredSqlTables)
    ? systemRequirements.requiredSqlTables.map(String).filter(Boolean)
    : [];
  if (requiredSqlTables.length) {
    const sqlText = collectRunSqlText(run);
    for (const table of requiredSqlTables) {
      const passed = sqlReferencesTable(sqlText, table);
      checks.push(
        assertion(
          `sql-table-${table}`,
          `SQLがテーブル「${table}」を参照`,
          passed,
          passed ? table : sqlText ? "未検出" : "SQLなし",
          table
        )
      );
    }
  }

  const passedCount = checks.filter((check) => check.passed).length;
  // API response receipt is tracked independently on SuiteRun.caseRuns. An empty
  // system contract therefore means "no configured requirement failed", not a
  // transport failure or a zero score.
  const score = checks.length ? Math.round((passedCount / checks.length) * 100) : 100;
  const system = {
    status: checks.every((check) => check.passed) ? "passed" : "failed",
    score,
    passedCount,
    checkCount: checks.length,
    checks
  };
  return {
    ...system,
    schemaVersion: 5,
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

export const BUSINESS_GRADES = {
  A: { score: 100, symbol: "◎", label: "完全一致", rank: 0 },
  B: { score: 80, symbol: "○", label: "おおむね一致", rank: 1 },
  C: { score: 50, symbol: "△", label: "一部不一致", rank: 2 },
  D: { score: 0, symbol: "×", label: "不一致", rank: 3 }
};

export const WEATHER_MARK_WEIGHTS = Object.freeze({ sun: 1, cloud: 0.5, rain: 0 });
export const WEATHER_MARK_SYMBOLS = Object.freeze({ sun: "☀️", cloud: "☁️", rain: "☔️" });
export const MAX_CRITERIA_ITEMS = 20;
export const MAX_CRITERIA_ITEM_LENGTH = 500;

/** Parse business criteria into checklist items (`;` preferred; legacy prose becomes one item). */
export function parseCriteriaItems(value, { maxItems = MAX_CRITERIA_ITEMS, maxItemLength = MAX_CRITERIA_ITEM_LENGTH } = {}) {
  const rawItems = Array.isArray(value)
    ? value
    : (() => {
        const text = String(value ?? "").trim();
        if (!text) return [];
        return text.includes(";") ? text.split(/;+/) : [text];
      })();
  return rawItems
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((item) => item.slice(0, maxItemLength))
    .slice(0, maxItems);
}

export function formatCriteriaItems(items) {
  return parseCriteriaItems(items).join("; ");
}

export function normalizeWeatherMark(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "sun" || raw === "☀️" || raw === "sunny" || raw === "ok" || raw === "pass") return "sun";
  if (raw === "cloud" || raw === "☁️" || raw === "cloudy" || raw === "partial" || raw === "warn") return "cloud";
  if (raw === "rain" || raw === "☔️" || raw === "☔" || raw === "fail" || raw === "ng") return "rain";
  return null;
}

/**
 * Deterministic overall grade from per-item weather marks.
 * sun=1, cloud=0.5, rain=0 → A: all sun / B: ratio≥0.9 / C: ratio≥0.5 / D: else
 */
export function composeBusinessGrade(marks = []) {
  const normalized = (Array.isArray(marks) ? marks : []).map(normalizeWeatherMark);
  if (!normalized.length || normalized.some((mark) => !mark)) {
    return {
      grade: null,
      ratio: null,
      score: null,
      marks: normalized,
      invalid: true
    };
  }
  const ratio = normalized.reduce((sum, mark) => sum + WEATHER_MARK_WEIGHTS[mark], 0) / normalized.length;
  let grade = "D";
  if (normalized.every((mark) => mark === "sun")) grade = "A";
  else if (ratio >= 0.9) grade = "B";
  else if (ratio >= 0.5) grade = "C";
  return {
    grade,
    ratio,
    score: Math.round(ratio * 100),
    marks: normalized,
    invalid: false
  };
}

export function composeEvaluation(systemEvaluation, judgeResult, businessRequirements = {}) {
  const system = systemEvaluation.system || systemEvaluation;
  const criteriaItems = parseCriteriaItems(
    businessRequirements.criteriaItems ?? businessRequirements.accuracyCriteria
  );
  const criteria = formatCriteriaItems(criteriaItems);
  const enabled = businessRequirements.enabled !== false && criteriaItems.length > 0;
  if (!enabled) {
    return {
      ...systemEvaluation,
      schemaVersion: 4,
      system,
      business: {
        status: "not_configured",
        grade: null,
        symbol: null,
        score: null,
        passed: null,
        expectedCriteria: "",
        criteriaItems: [],
        itemResults: []
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
      summary: String(judgeResult.reason || "ビジネス要件判定を完了できませんでした。"),
      expectedCriteria: criteria,
      criteriaItems,
      itemResults: [],
      extractedFacts: [],
      evidence: [],
      discrepancies: [],
      judgeAudit: judgeResult.judgeAudit || null
    };
    return {
      ...systemEvaluation,
      schemaVersion: 4,
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

  const rawItems = Array.isArray(judgeResult?.items) ? judgeResult.items : [];
  const itemResults = criteriaItems.map((criterion, index) => {
    const matched =
      rawItems.find((item) => Number(item?.id) === index + 1) ||
      rawItems.find((item) => String(item?.criterion || "").trim() === criterion) ||
      rawItems[index] ||
      null;
    const mark = normalizeWeatherMark(matched?.mark);
    return {
      id: index + 1,
      criterion,
      mark,
      symbol: mark ? WEATHER_MARK_SYMBOLS[mark] : null,
      reason: String(matched?.reason || "").trim()
    };
  });
  const graded = composeBusinessGrade(itemResults.map((item) => item.mark));
  if (graded.invalid || !BUSINESS_GRADES[graded.grade]) {
    return composeEvaluation(
      systemEvaluation,
      {
        evaluationError: true,
        reason: "Vertex AIから有効なチェック項目評価（☀️/☁️/☔️）が返りませんでした。",
        judgeAudit: judgeResult?.judgeAudit
      },
      businessRequirements
    );
  }

  const grade = graded.grade;
  const gradeDefinition = BUSINESS_GRADES[grade];
  const businessScore = graded.score;
  const passed = gradeDefinition.rank <= BUSINESS_GRADES[passingGrade].rank;
  const business = {
    status: passed ? "passed" : grade === "C" ? "review" : "failed",
    grade,
    symbol: gradeDefinition.symbol,
    label: gradeDefinition.label,
    score: businessScore,
    ratio: graded.ratio,
    passingGrade,
    passed,
    confidence: Math.max(0, Math.min(1, Number(judgeResult.confidence || 0))),
    summary: String(judgeResult.summary || judgeResult.reason || ""),
    expectedCriteria: criteria,
    criteriaItems,
    itemResults,
    extractedFacts: Array.isArray(judgeResult.extractedFacts) ? judgeResult.extractedFacts : [],
    evidence: Array.isArray(judgeResult.evidence) ? judgeResult.evidence : [],
    discrepancies: Array.isArray(judgeResult.discrepancies) ? judgeResult.discrepancies : [],
    judgeAudit: judgeResult.judgeAudit || null
  };
  const status = system.status === "passed" && passed ? "passed" : "failed";
  const score = Math.round(Number(system.score || 0) * 0.4 + businessScore * 0.6);
  return {
    ...systemEvaluation,
    schemaVersion: 4,
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
    ["passed", "failed", "review_required", "error", "skipped", "cancelled"].includes(item.status)
  );
  const completed = caseRuns.filter((item) =>
    ["passed", "failed", "review_required"].includes(item.status)
  );
  const skipped = caseRuns.filter((item) => item.status === "skipped").length;
  const cancelled = caseRuns.filter((item) => item.status === "cancelled").length;
  const responseRetryCaseIds = [];
  let responseReceived = 0;
  let responseNotReceived = 0;
  let responseNotRun = 0;
  let responsePending = 0;
  let responseUnknown = 0;
  for (const item of caseRuns) {
    const receiptStatus = item.responseReceipt?.status || "unknown";
    if (receiptStatus === "received") responseReceived += 1;
    else if (receiptStatus === "not_received") {
      responseNotReceived += 1;
      if (item.caseId) responseRetryCaseIds.push(item.caseId);
    } else if (receiptStatus === "not_run") responseNotRun += 1;
    else if (receiptStatus === "pending") responsePending += 1;
    else responseUnknown += 1;
  }
  const responseAttempted = responseReceived + responseNotReceived;
  const responseReceipt = {
    total: caseRuns.length,
    attempted: responseAttempted,
    received: responseReceived,
    notReceived: responseNotReceived,
    notRun: responseNotRun,
    pending: responsePending,
    unknown: responseUnknown,
    receiptRate: responseAttempted ? Math.round((responseReceived / responseAttempted) * 100) : null,
    retryCaseIds: responseRetryCaseIds
  };
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
  const systemGrades = { A: 0, B: 0, C: 0, D: 0 };
  for (const item of completed) {
    const rawScore = item.evaluation?.system?.score ?? item.evaluation?.score;
    const value = Number(rawScore);
    if (!Number.isFinite(value)) continue;
    const grade = value >= 100 ? "A" : value >= 90 ? "B" : value >= 50 ? "C" : "D";
    systemGrades[grade] += 1;
  }
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
        : cancelled
          ? "cancelled"
          : caseRuns.some((item) => ["failed", "error"].includes(item.status))
            ? "failed"
            : reviewRequired
              ? "review_required"
              : "passed",
    total: caseRuns.length,
    completed: finished.length,
    evaluated: completed.length,
    skipped,
    cancelled,
    responseReceipt,
    runnable: completed.length,
    passed,
    failed,
    reviewRequired,
    passRate: completed.length ? Math.round((passed / completed.length) * 100) : 0,
    score,
    systemScore,
    systemGrades,
    businessScore,
    systemPassed,
    systemPassRate: completed.length ? Math.round((systemPassed / completed.length) * 100) : 0,
    businessEvaluated,
    businessConfigured,
    businessPassed,
    businessPassRate: businessEvaluated ? Math.round((businessPassed / businessEvaluated) * 100) : 0,
    businessGrades: grades,
    totalDurationMs,
    totalBytesBilled
  };
}
