const EVENT_LABELS = {
  "text.final_response": "最終回答",
  "text.progress": "進捗",
  "text.thought": "エージェント思考",
  "text.followup_questions": "フォローアップ候補",
  "text.text_type_unspecified": "テキスト",
  "schema.query": "スキーマ検索",
  "schema.result": "スキーマ解決",
  "data.query": "データ取得計画",
  "data.generated_sql": "生成SQL",
  "data.result": "データ取得",
  "data.big_query_job": "BigQuery Job",
  "data.matched_query": "ゴールデンクエリ照合",
  "analysis.query": "高度な分析",
  "analysis.planner_reasoning": "分析計画",
  "analysis.coder_instruction": "コード生成指示",
  "analysis.code": "Pythonコード",
  "analysis.execution_output": "コード実行結果",
  "analysis.execution_error": "コード実行エラー",
  "analysis.result_vega_chart_json": "分析チャート",
  "analysis.result_natural_language": "分析結果",
  "analysis.result_csv_data": "分析CSV",
  "analysis.result_reference_data": "分析参照データ",
  "analysis.error": "分析エラー",
  "chart.query": "チャート生成",
  "chart.result": "チャート",
  error: "ツールエラー",
  example_queries: "質問例",
  unknown: "未分類イベント"
};

function snakeCase(value = "") {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function detectVariant(container, orderedKeys) {
  for (const key of orderedKeys) {
    if (container?.[key] !== undefined && container?.[key] !== null) {
      return [key, container[key]];
    }
  }
  return ["unknown", container];
}

export function normalizeMessage(message, sequence = 0) {
  const base = {
    sequence,
    timestamp: message?.timestamp ?? null,
    messageId: message?.messageId ?? null,
    groupId: message?.systemMessage?.groupId ?? null,
    citation: message?.systemMessage?.citation ?? null,
    raw: message
  };

  if (message?.userMessage) {
    return {
      ...base,
      kind: "user.message",
      label: "ユーザー質問",
      phase: "input",
      severity: "info",
      payload: message.userMessage
    };
  }

  const system = message?.systemMessage;
  if (!system) {
    return {
      ...base,
      kind: "unknown",
      label: EVENT_LABELS.unknown,
      phase: "unknown",
      severity: "warning",
      payload: message
    };
  }

  if (system.text) {
    const textType = snakeCase(system.text.textType || "TEXT_TYPE_UNSPECIFIED");
    const kind = `text.${textType}`;
    return {
      ...base,
      kind,
      label: EVENT_LABELS[kind] ?? "テキスト",
      phase: textType === "final_response" ? "answer" : "reasoning",
      severity: "info",
      payload: system.text
    };
  }

  if (system.schema) {
    const [variant, payload] = detectVariant(system.schema, ["query", "result"]);
    const kind = `schema.${snakeCase(variant)}`;
    return {
      ...base,
      kind,
      label: EVENT_LABELS[kind] ?? "スキーマ",
      phase: "schema",
      severity: "info",
      payload
    };
  }

  if (system.data) {
    const [variant, payload] = detectVariant(system.data, [
      "query",
      "generatedSql",
      "result",
      "bigQueryJob",
      "matchedQuery"
    ]);
    const kind = `data.${snakeCase(variant)}`;
    return {
      ...base,
      kind,
      label: EVENT_LABELS[kind] ?? "データ取得",
      phase: "retrieval",
      severity: "info",
      payload
    };
  }

  if (system.analysis) {
    if (system.analysis.query) {
      return {
        ...base,
        kind: "analysis.query",
        label: EVENT_LABELS["analysis.query"],
        phase: "analysis",
        severity: "info",
        payload: system.analysis.query
      };
    }
    const [variant, payload] = detectVariant(system.analysis.progressEvent, [
      "plannerReasoning",
      "coderInstruction",
      "code",
      "executionOutput",
      "executionError",
      "resultVegaChartJson",
      "resultNaturalLanguage",
      "resultCsvData",
      "resultReferenceData",
      "error"
    ]);
    const kind = `analysis.${snakeCase(variant)}`;
    const isError = variant === "executionError" || variant === "error";
    return {
      ...base,
      kind,
      label: EVENT_LABELS[kind] ?? "分析イベント",
      phase: "analysis",
      severity: isError ? "error" : "info",
      payload
    };
  }

  if (system.chart) {
    const [variant, payload] = detectVariant(system.chart, ["query", "result"]);
    const kind = `chart.${snakeCase(variant)}`;
    return {
      ...base,
      kind,
      label: EVENT_LABELS[kind] ?? "チャート",
      phase: "visualization",
      severity: "info",
      payload
    };
  }

  if (system.error) {
    return {
      ...base,
      kind: "error",
      label: EVENT_LABELS.error,
      phase: "error",
      severity: "error",
      payload: system.error
    };
  }

  if (system.exampleQueries) {
    return {
      ...base,
      kind: "example_queries",
      label: EVENT_LABELS.example_queries,
      phase: "answer",
      severity: "info",
      payload: system.exampleQueries
    };
  }

  return {
    ...base,
    kind: "unknown",
    label: EVENT_LABELS.unknown,
    phase: "unknown",
    severity: "warning",
    payload: system
  };
}

export function normalizeMessages(messages = []) {
  return messages.map((message, index) => normalizeMessage(message, index));
}

export function summarizeRun(events, jobDetails = [], durationMs = 0) {
  const count = (kind) => events.filter((event) => event.kind === kind).length;
  const errorCount = events.filter((event) => event.severity === "error").length;
  const hasFinalResponse = count("text.final_response") > 0;
  const generatedSqlCount = count("data.generated_sql");
  const matchedSqlCount = events.filter((event) => {
    if (event.kind !== "data.matched_query") return false;
    const payload = event.payload || {};
    return Boolean(
      String(
        payload.sqlQuery ||
        payload.exampleQuery?.sqlQuery ||
        payload.matchedQuery?.exampleQuery?.sqlQuery ||
        ""
      ).trim()
    );
  }).length;
  const hasQueryJob =
    count("data.big_query_job") > 0 ||
    jobDetails.some((job) => job?.statistics?.query || job?.configuration?.query);
  const sqlCount =
    generatedSqlCount + matchedSqlCount || (hasQueryJob ? 1 : 0);
  const total = (field) =>
    jobDetails.reduce((sum, job) => sum + Number(job?.statistics?.query?.[field] ?? 0), 0);

  return {
    status: hasFinalResponse ? (errorCount ? "warning" : "passed") : "failed",
    eventCount: events.length,
    errorCount,
    sqlCount,
    chartCount: count("chart.result") + count("analysis.result_vega_chart_json"),
    jobCount: jobDetails.length,
    durationMs,
    totalBytesProcessed: total("totalBytesProcessed"),
    totalBytesBilled: total("totalBytesBilled"),
    totalSlotMs: total("totalSlotMs")
  };
}
