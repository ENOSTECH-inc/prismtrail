import { getAccessToken } from "./google-cloud.mjs";

export const SUITE_SHEET = "AgentEval_TestSuite";
export const REPORT_SHEET = "AgentEval_Report";
export const SHEET_SCHEMA_VERSION = "2";

export const SUITE_HEADERS = [
  "case_id",
  "title",
  "prompt",
  "data_agent_id",
  "thinking_mode",
  "require_sql",
  "require_chart",
  "max_duration_ms",
  "max_bytes_billed",
  "required_phrases",
  "accuracy_requirement",
  "knowledge_source_ids"
];

export const REPORT_HEADERS = [
  "case_id",
  "title",
  "status",
  "score",
  "system_status",
  "system_score",
  "system_checks",
  "accuracy_grade",
  "accuracy_mark",
  "accuracy_score",
  "accuracy_status",
  "accuracy_reason",
  "accuracy_requirement",
  "accuracy_evidence",
  "accuracy_model",
  "duration_ms",
  "bytes_billed",
  "run_id",
  "error"
];

export const SUITE_DISPLAY_HEADERS = [
  "ケースID",
  "テストケース",
  "検証プロンプト",
  "Data Agent ID",
  "思考モード",
  "SQL必須",
  "チャート必須",
  "最大時間 (ms)",
  "最大課金バイト",
  "必須語句",
  "ビジネス要件の検証内容（自然言語）",
  "ナレッジID"
];

export const REPORT_DISPLAY_HEADERS = [
  "ケースID",
  "テストケース",
  "結果",
  "総合スコア",
  "システム結果",
  "システムスコア",
  "システム要件の判定",
  "ビジネス評価 (A/B/C/D)",
  "評価記号",
  "ビジネススコア",
  "ビジネス結果",
  "ビジネス判定理由",
  "ビジネス要件の検証内容",
  "回答内の根拠",
  "判定モデル",
  "実行時間 (ms)",
  "課金対象バイト",
  "Run ID",
  "エラー"
];

const LEGACY_SUITE_HEADERS = SUITE_HEADERS.filter((header) => header !== "accuracy_requirement");

const SUITE_HEADER_ALIASES = new Map([
  ...SUITE_HEADERS.map((header) => [header, header]),
  ...SUITE_DISPLAY_HEADERS.map((header, index) => [header, SUITE_HEADERS[index]]),
  ["精度条件（自然言語）", "accuracy_requirement"],
  ["ビジネス要件の検証内容", "accuracy_requirement"]
]);

const SUITE_METADATA_KEYS = new Map([
  ["schema_version", "schema_version"],
  ["スキーマ", "schema_version"],
  ["suite_id", "suite_id"],
  ["スイートID", "suite_id"],
  ["suite_name", "suite_name"],
  ["スイート名", "suite_name"],
  ["description", "description"],
  ["目的・説明", "description"],
  ["status", "status"],
  ["ステータス", "status"],
  ["knowledge_source_ids", "knowledge_source_ids"],
  ["共通ナレッジ", "knowledge_source_ids"],
  ["exported_at", "exported_at"],
  ["最終出力", "exported_at"]
]);

function stringCell(value) {
  return String(value ?? "").trim();
}

function booleanCell(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "yes", "y", "はい"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "いいえ"].includes(normalized)) return false;
  throw new Error(`真偽値は TRUE または FALSE で指定してください: ${value}`);
}

function numberCell(value) {
  if (value === "" || value == null) return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`0以上の数値を指定してください: ${value}`);
  return number;
}

function listCell(value) {
  return stringCell(value)
    .split(/[,、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSuiteHeaders(row) {
  return (row || []).map((value) => {
    const header = stringCell(value);
    return SUITE_HEADER_ALIASES.get(header) || header;
  });
}

function detectDelimiter(text) {
  let commas = 0;
  let tabs = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (character === "\n" || character === "\r")) {
      break;
    } else if (!quoted && character === "\t") {
      tabs += 1;
    } else if (!quoted && character === ",") {
      commas += 1;
    }
  }
  return tabs > 0 ? "\t" : commas > 0 ? "," : "\t";
}

export function parseDelimitedText(value) {
  const text = String(value || "").replace(/^\uFEFF/, "");
  if (!text.trim()) throw new Error("Google Sheetsからコピーしたセルを貼り付けてください。");
  if (text.length > 500_000) throw new Error("貼り付け可能な文字数は500,000文字までです。");
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && (quoted || cell.length === 0)) {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("引用符が閉じられていないCSV/TSVです。");
  row.push(cell);
  rows.push(row);
  while (rows.length && rows.at(-1).every((item) => !stringCell(item))) rows.pop();
  if (!rows.length) throw new Error("貼り付けデータにセルがありません。");
  return { rows, delimiter: delimiter === "\t" ? "tsv" : "csv" };
}

export function pastedTextToSuiteInput(
  value,
  { targetSuite = null, preferTargetSuite = false, includeSuiteMetadata = true } = {}
) {
  const parsed = parseDelimitedText(value);
  const firstCell = stringCell(parsed.rows[0]?.[0]);
  if (["PrismTrail | テストスイート管理", "Agent Eval テストスイート", "Agent Eval | テストスイート管理"].includes(firstCell)) {
    const suite = rowsToSuiteInput(parsed.rows);
    if (preferTargetSuite && targetSuite) {
      suite.sourceSuiteId = targetSuite.id;
      if (!includeSuiteMetadata) {
        suite.name = targetSuite.name;
        suite.description = targetSuite.description;
        suite.status = targetSuite.status;
        suite.knowledgeSourceIds = [...(targetSuite.knowledgeSourceIds || [])];
      }
    }
    return {
      suite,
      format: "full",
      delimiter: parsed.delimiter
    };
  }
  if (!targetSuite) {
    throw new Error("ケース表だけを貼り付ける場合は、更新対象のテストスイートを選択してください。");
  }
  const headerIndex = parsed.rows.findIndex((row) => {
    const headers = normalizeSuiteHeaders(row);
    return headers[0] === SUITE_HEADERS[0] && headers[1] === SUITE_HEADERS[1];
  });
  const caseRows = headerIndex >= 0 ? parsed.rows.slice(headerIndex + 1) : parsed.rows;
  const rows = suiteToRows(targetSuite);
  const targetHeaderIndex = rows.findIndex((row) => normalizeSuiteHeaders(row)[0] === "case_id");
  rows.splice(targetHeaderIndex + 1, rows.length - targetHeaderIndex - 1, ...caseRows);
  return {
    suite: rowsToSuiteInput(rows),
    format: headerIndex >= 0 ? "table-with-header" : "case-rows",
    delimiter: parsed.delimiter
  };
}

export function parseSpreadsheetId(value) {
  const input = String(value || "").trim();
  const urlMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = urlMatch?.[1] || (/^[a-zA-Z0-9-_]{20,}$/.test(input) ? input : "");
  if (!id) throw new Error("GoogleスプレッドシートのURLまたはSpreadsheet IDを指定してください。");
  return id;
}

export function suiteToRows(suite) {
  return [
    ["PrismTrail | テストスイート管理"],
    ["スキーマ", SHEET_SCHEMA_VERSION],
    ["スイートID", suite.id || ""],
    ["スイート名", suite.name || ""],
    ["目的・説明", suite.description || ""],
    ["ステータス", suite.status || "draft"],
    ["共通ナレッジ", (suite.knowledgeSourceIds || []).join(", ")],
    ["最終出力", new Date().toISOString()],
    ["", "▼ コピー範囲：次の青い見出し行から、入力済みの最終ケース行まで選択してください"],
    [...SUITE_DISPLAY_HEADERS],
    ...(suite.cases || []).map((testCase) => [
      testCase.id || "",
      testCase.title || "",
      testCase.prompt || "",
      testCase.agentId || "",
      testCase.thinkingMode === "THINKING" ? "THINKING" : "FAST",
      testCase.expectations?.requireSql !== false,
      Boolean(testCase.expectations?.requireChart),
      Number(testCase.expectations?.maxDurationMs || 0),
      Number(testCase.expectations?.maxBytesBilled || 0),
      (testCase.expectations?.requiredPhrases || []).join(", "),
      testCase.expectations?.businessRequirements?.accuracyCriteria ||
        testCase.expectations?.accuracyCriteria ||
        "",
      (testCase.knowledgeSourceIds || []).join(", ")
    ])
  ];
}

export function rowsToSuiteInput(rows) {
  if (
    !Array.isArray(rows) ||
    !["PrismTrail | テストスイート管理", "Agent Eval テストスイート", "Agent Eval | テストスイート管理"].includes(rows[0]?.[0])
  ) {
    throw new Error(`${SUITE_SHEET} の1行目が正しいテンプレートではありません。`);
  }
  const headerIndex = rows.findIndex((row) => {
    const normalized = normalizeSuiteHeaders(row);
    return normalized[0] === "case_id" && normalized[1] === "title" && normalized[2] === "prompt";
  });
  if (headerIndex < 0) {
    throw new Error(`ケース表の列定義を変更しないでください: ${SUITE_HEADERS.join(", ")}`);
  }
  const metadata = new Map(
    rows.slice(1, headerIndex).map((row) => [
      SUITE_METADATA_KEYS.get(stringCell(row?.[0])) || stringCell(row?.[0]),
      stringCell(row?.[1])
    ])
  );
  const schemaVersion = metadata.get("schema_version") || "1";
  if (!["1", SHEET_SCHEMA_VERSION].includes(schemaVersion)) {
    throw new Error(`未対応のschema_versionです。対応バージョン: 1, ${SHEET_SCHEMA_VERSION}`);
  }
  const headers = normalizeSuiteHeaders(rows[headerIndex] || []);
  const expectedHeaders = schemaVersion === "1" || !headers.includes("accuracy_requirement")
    ? LEGACY_SUITE_HEADERS
    : SUITE_HEADERS;
  if (expectedHeaders.some((header, index) => headers[index] !== header)) {
    throw new Error(`列定義を変更しないでください: ${expectedHeaders.join(", ")}`);
  }
  const columnIndex = new Map(headers.map((header, index) => [header, index]));
  const cell = (row, header) => row[columnIndex.get(header)];
  const cases = rows
    .slice(headerIndex + 1)
    .filter((row) => row?.slice(0, 5).some((value) => stringCell(value)))
    .map((row, index) => {
      const rowNumber = headerIndex + index + 2;
      const title = stringCell(cell(row, "title"));
      const prompt = stringCell(cell(row, "prompt"));
      const agentId = stringCell(cell(row, "data_agent_id"));
      if (!title || !prompt || !agentId) {
        throw new Error(`${rowNumber}行目: title、prompt、data_agent_idは必須です。`);
      }
      const thinkingMode = stringCell(cell(row, "thinking_mode")).toUpperCase() || "FAST";
      if (!["FAST", "THINKING"].includes(thinkingMode)) {
        throw new Error(`${rowNumber}行目: thinking_modeはFASTまたはTHINKINGです。`);
      }
      const accuracyCriteria = stringCell(cell(row, "accuracy_requirement"));
      if (accuracyCriteria.length > 5000) {
        throw new Error(`${rowNumber}行目: 精度条件は5,000文字以内で指定してください。`);
      }
      return {
        id: stringCell(cell(row, "case_id")) || undefined,
        title,
        prompt,
        agentId,
        thinkingMode,
        expectations: {
          requireSql: booleanCell(cell(row, "require_sql"), true),
          requireChart: booleanCell(cell(row, "require_chart"), false),
          maxDurationMs: numberCell(cell(row, "max_duration_ms")),
          maxBytesBilled: numberCell(cell(row, "max_bytes_billed")),
          requiredPhrases: listCell(cell(row, "required_phrases")),
          businessRequirements: {
            enabled: Boolean(accuracyCriteria),
            accuracyCriteria,
            passingGrade: "B"
          }
        },
        knowledgeSourceIds: listCell(cell(row, "knowledge_source_ids"))
      };
    });
  if (cases.length > 50) throw new Error("1スイートに取り込めるテストケースは50件までです。");
  return {
    sourceSuiteId: metadata.get("suite_id") || null,
    name: metadata.get("suite_name") || "Google Sheetsから取り込んだスイート",
    description: metadata.get("description") || "",
    status: metadata.get("status") === "active" ? "active" : "draft",
    knowledgeSourceIds: listCell(metadata.get("knowledge_source_ids")),
    cases
  };
}

export function reportToRows(report) {
  const summaryGrades = report.summary?.accuracyGrades || {};
  const summaryGradeCount = ["A", "B", "C", "D"].reduce(
    (total, grade) => total + Number(summaryGrades[grade] || 0),
    0
  );
  const grades = summaryGradeCount
    ? summaryGrades
    : (report.caseRuns || []).reduce((counts, item) => {
        const grade = item.evaluation?.business?.grade;
        if (["A", "B", "C", "D"].includes(grade)) counts[grade] += 1;
        return counts;
      }, { A: 0, B: 0, C: 0, D: 0 });
  const gradeCount = ["A", "B", "C", "D"].reduce((total, grade) => total + Number(grades[grade] || 0), 0);
  const businessPassRate = gradeCount
    ? (report.summary?.businessPassRate ?? Math.round((((grades.A || 0) + (grades.B || 0)) / gradeCount) * 100))
    : "未設定";
  const businessStatusLabel = (status) => ({
    passed: "合格",
    failed: "不合格",
    review_required: "要確認",
    judge_error: "判定保留",
    not_configured: "未設定"
  })[status] || status || "未設定";
  return [
    ["PrismTrail | 評価レポート"],
    ["スキーマ", SHEET_SCHEMA_VERSION],
    ["出力日時", new Date().toISOString()],
    ["Suite Run ID", report.id],
    ["スイートID", report.suiteId],
    ["スイート名", report.suiteName],
    ["総合結果", report.status],
    ["総合スコア", report.summary?.score ?? ""],
    ["合格率", report.summary?.passRate || 0],
    ["システム要件 正解率", report.summary?.systemScore ?? report.summary?.score ?? 0],
    ["ビジネス要件 正解率", report.summary?.businessScore ?? "未設定"],
    ["システム合格率", report.summary?.systemPassRate || 0],
    ["精度合格率", businessPassRate],
    ["精度分布", gradeCount ? `A ${grades.A || 0} / B ${grades.B || 0} / C ${grades.C || 0} / D ${grades.D || 0}` : "未設定"],
    ["", "◆ ビジネス要件の評価結果は、紫色の列（H〜O）に表示されます"],
    [...REPORT_DISPLAY_HEADERS],
    ...(report.caseRuns || []).map((item) => [
      item.caseId || "",
      item.title || "",
      item.status || "",
      item.evaluation?.score ?? "",
      item.evaluation?.system?.status || item.evaluation?.status || "",
      item.evaluation?.system?.score ?? item.evaluation?.score ?? "",
      (item.evaluation?.system?.checks || item.evaluation?.checks || [])
        .map((check) => `${check.passed ? "✓" : "×"} ${check.label}`)
        .join("\n"),
      item.evaluation?.business?.grade || "",
      item.evaluation?.business?.symbol || "",
      item.evaluation?.business?.score ?? "",
      businessStatusLabel(item.evaluation?.business?.status),
      item.evaluation?.business?.summary || "",
      item.evaluation?.business?.expectedCriteria || "",
      (item.evaluation?.business?.evidence || [])
        .map((evidence) => `${evidence.quote || ""}${evidence.explanation ? ` — ${evidence.explanation}` : ""}`)
        .join("\n"),
      item.evaluation?.business?.judgeAudit?.model || "",
      item.runSummary?.durationMs || 0,
      item.runSummary?.totalBytesBilled || 0,
      item.runId || "",
      item.error || ""
    ])
  ];
}

async function googleRequest(path, { method = "GET", body, timeoutMs = 30_000 } = {}) {
  const { token, source: authSource } = await getAccessToken();
  const quotaProject = process.env.GOOGLE_CLOUD_QUOTA_PROJECT || process.env.BQ_AGENT_BILLING_PROJECT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(quotaProject ? { "x-goog-user-project": quotaProject } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let result = {};
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Google Sheets APIからJSONではない応答が返されました (${response.status})。`);
    }
    if (!response.ok) {
      const message = result?.error?.message || `HTTP ${response.status}`;
      if (response.status === 403) {
        throw new Error(
          `Google Sheetsへアクセスできません: ${message}。ADCのGoogleアカウントへシートを共有し、Sheets API scopeを付けて再ログインしてください。`
        );
      }
      throw new Error(`Google Sheets API error ${response.status}: ${message}`);
    }
    return { result, authSource };
  } finally {
    clearTimeout(timer);
  }
}

export async function getSpreadsheet(spreadsheetId) {
  const { result, authSource } = await googleRequest(
    `spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false&fields=spreadsheetId,properties.title,properties.locale,spreadsheetUrl,sheets(properties,charts.chartId,bandedRanges.bandedRangeId,conditionalFormats)`
  );
  return {
    spreadsheetId: result.spreadsheetId,
    title: result.properties?.title || "無題のスプレッドシート",
    locale: result.properties?.locale || null,
    spreadsheetUrl: result.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    sheets: result.sheets || [],
    authSource
  };
}

async function ensureSheet(spreadsheetId, title) {
  let spreadsheet = await getSpreadsheet(spreadsheetId);
  let sheet = spreadsheet.sheets.find((item) => item.properties?.title === title);
  if (!sheet) {
    await googleRequest(`spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: "POST",
      body: { requests: [{ addSheet: { properties: { title, gridProperties: { rowCount: 1000, columnCount: 20 } } } }] }
    });
    spreadsheet = await getSpreadsheet(spreadsheetId);
    sheet = spreadsheet.sheets.find((item) => item.properties?.title === title);
  }
  return { spreadsheet, sheet };
}

function quoteSheet(title) {
  return `'${String(title).replaceAll("'", "''")}'`;
}

const COLORS = {
  navy: { red: 0.055, green: 0.102, blue: 0.19 },
  blue: { red: 0.192, green: 0.369, blue: 0.984 },
  ink: { red: 0.075, green: 0.133, blue: 0.22 },
  muted: { red: 0.4, green: 0.475, blue: 0.58 },
  white: { red: 1, green: 1, blue: 1 },
  panel: { red: 0.965, green: 0.975, blue: 0.99 },
  panelAlt: { red: 0.925, green: 0.945, blue: 0.985 },
  line: { red: 0.84, green: 0.87, blue: 0.91 },
  green: { red: 0.055, green: 0.58, blue: 0.36 },
  greenSoft: { red: 0.89, green: 0.965, blue: 0.93 },
  red: { red: 0.82, green: 0.2, blue: 0.28 },
  redSoft: { red: 0.99, green: 0.9, blue: 0.92 },
  amber: { red: 0.93, green: 0.55, blue: 0.12 },
  amberSoft: { red: 1, green: 0.95, blue: 0.84 },
  purple: { red: 0.486, green: 0.227, blue: 0.929 },
  purpleSoft: { red: 0.953, green: 0.91, blue: 1 },
  cyan: { red: 0.01, green: 0.52, blue: 0.78 },
  cyanSoft: { red: 0.88, green: 0.96, blue: 0.99 },
  graySoft: { red: 0.93, green: 0.94, blue: 0.96 }
};

function gridRange(sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex) {
  return { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex };
}

function repeatFormat(range, userEnteredFormat, fields = "userEnteredFormat") {
  return {
    repeatCell: {
      range,
      cell: { userEnteredFormat },
      fields
    }
  };
}

function rowHeight(sheetId, startIndex, endIndex, pixelSize) {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex, endIndex },
      properties: { pixelSize },
      fields: "pixelSize"
    }
  };
}

async function writeFixedSheet(
  spreadsheetId,
  title,
  rows,
  headerRowIndex,
  {
    hiddenColumnIndexes = [],
    columnWidths = [],
    tabColor = COLORS.blue,
    extraValues = [],
    customRequests = () => []
  } = {}
) {
  const { spreadsheet, sheet } = await ensureSheet(spreadsheetId, title);
  const range = `${quoteSheet(title)}!A:Z`;
  await googleRequest(
    `spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
    { method: "POST", body: {} }
  );
  await googleRequest(
    `spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${quoteSheet(title)}!A1`)}?valueInputOption=RAW`,
    { method: "PUT", body: { range: `${quoteSheet(title)}!A1`, majorDimension: "ROWS", values: rows } }
  );
  for (const block of extraValues) {
    await googleRequest(
      `spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${quoteSheet(title)}!${block.range}`)}?valueInputOption=RAW`,
      {
        method: "PUT",
        body: {
          range: `${quoteSheet(title)}!${block.range}`,
          majorDimension: "ROWS",
          values: block.values
        }
      }
    );
  }
  const sheetId = sheet.properties.sheetId;
  const lastColumn = Math.max(...rows.map((row) => row.length), 1);
  const dataStartRowIndex = headerRowIndex + 1;
  const dataEndRowIndex = Math.max(rows.length, dataStartRowIndex + 1);
  const dimensionRequests = columnWidths.map((pixelSize, columnIndex) => ({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: columnIndex,
        endIndex: columnIndex + 1
      },
      properties: { pixelSize },
      fields: "pixelSize"
    }
  }));
  const hiddenRequests = hiddenColumnIndexes.map((columnIndex) => ({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: "COLUMNS",
        startIndex: columnIndex,
        endIndex: columnIndex + 1
      },
      properties: { hiddenByUser: true },
      fields: "hiddenByUser"
    }
  }));
  const cleanupRequests = [
    ...(sheet.charts || []).map((chart) => ({
      deleteEmbeddedObject: { objectId: chart.chartId }
    })),
    ...(sheet.bandedRanges || []).map((banding) => ({
      deleteBanding: { bandedRangeId: banding.bandedRangeId }
    })),
    ...Array.from({ length: sheet.conditionalFormats?.length || 0 }, () => ({
      deleteConditionalFormatRule: { sheetId, index: 0 }
    }))
  ];
  const metadataMergeRequests = Array.from({ length: headerRowIndex - 1 }, (_, index) => index + 1)
    .map((rowIndex) => ({
      mergeCells: {
        range: gridRange(sheetId, rowIndex, rowIndex + 1, 1, lastColumn),
        mergeType: "MERGE_ALL"
      }
    }));
  const headerRange = gridRange(sheetId, headerRowIndex, headerRowIndex + 1, 0, lastColumn);
  const dataRange = gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 0, lastColumn);
  await googleRequest(`spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    body: {
      requests: [
        ...cleanupRequests,
        { clearBasicFilter: { sheetId } },
        {
          unmergeCells: {
            range: gridRange(sheetId, 0, 1000, 0, 20)
          }
        },
        {
          setDataValidation: {
            range: gridRange(sheetId, 0, 1000, 0, 20)
          }
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                frozenRowCount: headerRowIndex + 1,
                frozenColumnCount: 1,
                hideGridlines: true
              },
              tabColor
            },
            fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.hideGridlines,tabColor"
          }
        },
        ...metadataMergeRequests,
        repeatFormat(gridRange(sheetId, 0, rows.length, 0, lastColumn), {
          backgroundColor: COLORS.white,
          textFormat: {
            foregroundColor: COLORS.ink,
            fontFamily: "Arial",
            fontSize: 10
          },
          verticalAlignment: "MIDDLE"
        }),
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: lastColumn },
            cell: {
              userEnteredFormat: {
                backgroundColor: COLORS.navy,
                horizontalAlignment: "LEFT",
                verticalAlignment: "MIDDLE",
                textFormat: {
                  foregroundColor: COLORS.white,
                  bold: true,
                  fontFamily: "Arial",
                  fontSize: 18
                }
              }
            },
            fields: "userEnteredFormat"
          }
        },
        repeatFormat(gridRange(sheetId, 1, headerRowIndex - 1, 0, 1), {
          backgroundColor: COLORS.panelAlt,
          textFormat: {
            foregroundColor: COLORS.muted,
            bold: true,
            fontFamily: "Arial",
            fontSize: 9
          },
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE"
        }),
        repeatFormat(gridRange(sheetId, 1, headerRowIndex - 1, 1, lastColumn), {
          backgroundColor: COLORS.panel,
          textFormat: {
            foregroundColor: COLORS.ink,
            fontFamily: "Arial",
            fontSize: 10
          },
          verticalAlignment: "MIDDLE",
          wrapStrategy: "WRAP"
        }),
        {
          repeatCell: {
            range: headerRange,
            cell: {
              userEnteredFormat: {
                backgroundColor: COLORS.blue,
                textFormat: {
                  foregroundColor: COLORS.white,
                  bold: true,
                  fontFamily: "Arial",
                  fontSize: 9
                },
                horizontalAlignment: "LEFT",
                verticalAlignment: "MIDDLE",
                wrapStrategy: "WRAP"
              }
            },
            fields: "userEnteredFormat"
          }
        },
        {
          updateBorders: {
            range: headerRange,
            bottom: {
              style: "SOLID_THICK",
              color: COLORS.navy
            }
          }
        },
        {
          addBanding: {
            bandedRange: {
              range: gridRange(sheetId, headerRowIndex, dataEndRowIndex, 0, lastColumn),
              rowProperties: {
                headerColor: COLORS.blue,
                firstBandColor: COLORS.white,
                secondBandColor: COLORS.panel
              }
            }
          }
        },
        repeatFormat(dataRange, {
          textFormat: {
            foregroundColor: COLORS.ink,
            fontFamily: "Arial",
            fontSize: 9
          },
          verticalAlignment: "MIDDLE",
          wrapStrategy: "WRAP"
        }, "userEnteredFormat.textFormat,userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy"),
        {
          setBasicFilter: {
            filter: {
              range: {
                sheetId,
                startRowIndex: headerRowIndex,
                endRowIndex: Math.max(rows.length, headerRowIndex + 1),
                startColumnIndex: 0,
                endColumnIndex: lastColumn
              }
            }
          }
        },
        rowHeight(sheetId, 0, 1, 46),
        rowHeight(sheetId, 1, headerRowIndex - 1, 29),
        rowHeight(sheetId, 4, 5, 42),
        rowHeight(sheetId, headerRowIndex - 1, headerRowIndex, 16),
        rowHeight(sheetId, headerRowIndex, headerRowIndex + 1, 42),
        rowHeight(sheetId, dataStartRowIndex, dataEndRowIndex, title === REPORT_SHEET ? 76 : 54),
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 20 },
            properties: { hiddenByUser: false },
            fields: "hiddenByUser"
          }
        },
        ...dimensionRequests,
        ...hiddenRequests,
        ...customRequests({
          sheetId,
          headerRowIndex,
          dataStartRowIndex,
          dataEndRowIndex,
          lastColumn,
          rows
        })
      ]
    }
  });
  return { spreadsheet, sheetTitle: title, rowCount: rows.length };
}

export function writeSuiteSheet(spreadsheetId, suite) {
  return writeFixedSheet(spreadsheetId, SUITE_SHEET, suiteToRows(suite), 9, {
    columnWidths: [150, 220, 520, 180, 110, 95, 105, 125, 145, 200, 420, 210],
    tabColor: COLORS.blue,
    customRequests: ({ sheetId, headerRowIndex, dataStartRowIndex, dataEndRowIndex, lastColumn }) => [
      rowHeight(sheetId, headerRowIndex - 1, headerRowIndex, 34),
      repeatFormat(
        gridRange(sheetId, headerRowIndex - 1, headerRowIndex, 0, lastColumn),
        {
          backgroundColor: COLORS.greenSoft,
          textFormat: {
            foregroundColor: COLORS.green,
            bold: true,
            fontFamily: "Arial",
            fontSize: 10
          },
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE"
        }
      ),
      {
        updateBorders: {
          range: gridRange(sheetId, headerRowIndex, dataEndRowIndex, 0, lastColumn),
          top: { style: "SOLID_THICK", color: COLORS.green },
          bottom: { style: "SOLID_THICK", color: COLORS.green },
          left: { style: "SOLID_THICK", color: COLORS.green },
          right: { style: "SOLID_THICK", color: COLORS.green }
        }
      },
      repeatFormat(
        gridRange(sheetId, headerRowIndex, headerRowIndex + 1, 10, 11),
        {
          backgroundColor: COLORS.purple,
          textFormat: {
            foregroundColor: COLORS.white,
            bold: true,
            fontFamily: "Arial",
            fontSize: 9
          },
          wrapStrategy: "WRAP"
        }
      ),
      {
        setDataValidation: {
          range: gridRange(sheetId, 5, 6, 1, lastColumn),
          rule: {
            condition: {
              type: "ONE_OF_LIST",
              values: [{ userEnteredValue: "draft" }, { userEnteredValue: "active" }]
            },
            strict: true,
            showCustomUi: true
          }
        }
      },
      {
        setDataValidation: {
          range: gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + 50, 4, 5),
          rule: {
            condition: {
              type: "ONE_OF_LIST",
              values: [{ userEnteredValue: "FAST" }, { userEnteredValue: "THINKING" }]
            },
            strict: true,
            showCustomUi: true
          }
        }
      },
      ...[5, 6].map((columnIndex) => ({
        setDataValidation: {
          range: gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + 50, columnIndex, columnIndex + 1),
          rule: {
            condition: { type: "BOOLEAN" },
            strict: true,
            showCustomUi: true
          }
        }
      })),
      repeatFormat(
        gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + 50, 7, 8),
        { numberFormat: { type: "NUMBER", pattern: '#,##0 "ms"' }, horizontalAlignment: "RIGHT" },
        "userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment"
      ),
      repeatFormat(
        gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + 50, 8, 9),
        { numberFormat: { type: "NUMBER", pattern: '#,##0 "bytes"' }, horizontalAlignment: "RIGHT" },
        "userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment"
      ),
      repeatFormat(
        gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + 50, 10, 11),
        {
          backgroundColor: COLORS.purpleSoft,
          textFormat: { foregroundColor: COLORS.ink },
          wrapStrategy: "WRAP"
        }
      ),
      {
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + 50, 4, 5)],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "THINKING" }] },
              format: { backgroundColor: COLORS.amberSoft, textFormat: { foregroundColor: COLORS.amber, bold: true } }
            }
          }
        }
      }
    ]
  });
}

export function writeReportSheet(spreadsheetId, report) {
  return writeFixedSheet(spreadsheetId, REPORT_SHEET, reportToRows(report), 15, {
    columnWidths: [150, 230, 105, 100, 115, 110, 320, 90, 75, 105, 130, 320, 420, 300, 170, 125, 145, 175, 250],
    tabColor: COLORS.green,
    customRequests: ({ sheetId, headerRowIndex, dataStartRowIndex, dataEndRowIndex }) => [
      rowHeight(sheetId, headerRowIndex - 1, headerRowIndex, 34),
      repeatFormat(
        gridRange(sheetId, headerRowIndex - 1, headerRowIndex, 0, REPORT_HEADERS.length),
        {
          backgroundColor: COLORS.purpleSoft,
          textFormat: {
            foregroundColor: COLORS.purple,
            bold: true,
            fontFamily: "Arial",
            fontSize: 10
          },
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE"
        }
      ),
      repeatFormat(
        gridRange(sheetId, headerRowIndex, headerRowIndex + 1, 7, 15),
        {
          backgroundColor: COLORS.purple,
          textFormat: {
            foregroundColor: COLORS.white,
            bold: true,
            fontFamily: "Arial",
            fontSize: 9
          },
          wrapStrategy: "WRAP"
        }
      ),
      repeatFormat(
        gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 7, 15),
        {
          backgroundColor: COLORS.purpleSoft,
          textFormat: { foregroundColor: COLORS.ink },
          wrapStrategy: "WRAP"
        }
      ),
      repeatFormat(
        gridRange(sheetId, 6, 7, 1, REPORT_HEADERS.length),
        {
          backgroundColor: report.status === "passed" ? COLORS.greenSoft : COLORS.redSoft,
          textFormat: {
            foregroundColor: report.status === "passed" ? COLORS.green : COLORS.red,
            bold: true,
            fontFamily: "Arial",
            fontSize: 12
          }
        }
      ),
      repeatFormat(
        gridRange(sheetId, 7, 14, 1, REPORT_HEADERS.length),
        {
          backgroundColor: COLORS.panel,
          textFormat: {
            foregroundColor: COLORS.blue,
            bold: true,
            fontFamily: "Arial",
            fontSize: 16
          }
        }
      ),
      repeatFormat(
        gridRange(sheetId, 10, 14, 1, REPORT_HEADERS.length),
        {
          backgroundColor: COLORS.purpleSoft,
          textFormat: {
            foregroundColor: COLORS.purple,
            bold: true,
            fontFamily: "Arial",
            fontSize: 14
          }
        }
      ),
      repeatFormat(
        gridRange(sheetId, 8, 13, 1, REPORT_HEADERS.length),
        { numberFormat: { type: "NUMBER", pattern: '0"%"' } },
        "userEnteredFormat.numberFormat"
      ),
      repeatFormat(
        gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 3, 4),
        { numberFormat: { type: "NUMBER", pattern: "0" }, horizontalAlignment: "RIGHT" },
        "userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment"
      ),
      repeatFormat(
        gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 15, 16),
        { numberFormat: { type: "NUMBER", pattern: '#,##0 "ms"' }, horizontalAlignment: "RIGHT" },
        "userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment"
      ),
      repeatFormat(
        gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 16, 17),
        {
          numberFormat: {
            type: "NUMBER",
            pattern: '[>=1000000]0.0,," MB";[>=1000]0.0," KB";0 "B"'
          },
          horizontalAlignment: "RIGHT"
        },
        "userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment"
      ),
      ...[
        ["passed", COLORS.greenSoft, COLORS.green],
        ["failed", COLORS.redSoft, COLORS.red],
        ["review_required", COLORS.graySoft, COLORS.muted]
      ].map(([value, backgroundColor, foregroundColor], index) => ({
        addConditionalFormatRule: {
          index,
          rule: {
            ranges: [gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 2, 3)],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: value }] },
              format: {
                backgroundColor,
                textFormat: { foregroundColor, bold: true }
              }
            }
          }
        }
      })),
      ...[
        ["passed", COLORS.greenSoft, COLORS.green],
        ["failed", COLORS.redSoft, COLORS.red]
      ].map(([value, backgroundColor, foregroundColor], offset) => ({
        addConditionalFormatRule: {
          index: 8 + offset,
          rule: {
            ranges: [gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 4, 5)],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: value }] },
              format: {
                backgroundColor,
                textFormat: { foregroundColor, bold: true }
              }
            }
          }
        }
      })),
      ...[
        [
          `=AND(REGEXMATCH($G${dataStartRowIndex + 1},"✓"),NOT(REGEXMATCH($G${dataStartRowIndex + 1},"×")))`,
          COLORS.greenSoft,
          COLORS.green
        ],
        [`=REGEXMATCH($G${dataStartRowIndex + 1},"×")`, COLORS.redSoft, COLORS.red]
      ].map(([formula, backgroundColor, foregroundColor], offset) => ({
        addConditionalFormatRule: {
          index: 10 + offset,
          rule: {
            ranges: [gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 6, 7)],
            booleanRule: {
              condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: formula }] },
              format: {
                backgroundColor,
                textFormat: { foregroundColor, bold: true }
              }
            }
          }
        }
      })),
      ...[
        ["A", COLORS.purpleSoft, COLORS.purple],
        ["B", COLORS.cyanSoft, COLORS.cyan],
        ["C", COLORS.amberSoft, COLORS.amber],
        ["D", COLORS.redSoft, COLORS.red]
      ].map(([value, backgroundColor, foregroundColor], offset) => ({
        addConditionalFormatRule: {
          index: 4 + offset,
          rule: {
            ranges: [gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 7, 8)],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: value }] },
              format: { backgroundColor, textFormat: { foregroundColor, bold: true } }
            }
          }
        }
      })),
      {
        addConditionalFormatRule: {
          index: 3,
          rule: {
            ranges: [gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 3, 4)],
            gradientRule: {
              minpoint: { color: COLORS.redSoft, type: "NUMBER", value: "0" },
              midpoint: { color: COLORS.amberSoft, type: "NUMBER", value: "80" },
              maxpoint: { color: COLORS.greenSoft, type: "NUMBER", value: "100" }
            }
          }
        }
      },
      {
        addChart: {
          chart: {
            spec: {
              title: "システム／精度スコア",
              titleTextFormat: {
                foregroundColor: COLORS.ink,
                bold: true,
                fontFamily: "Arial",
                fontSize: 13
              },
              backgroundColor: COLORS.white,
              fontName: "Arial",
              basicChart: {
                chartType: "BAR",
                legendPosition: "NO_LEGEND",
                headerCount: 0,
                axis: [
                  {
                    position: "BOTTOM_AXIS",
                    title: "スコア"
                  },
                  {
                    position: "LEFT_AXIS",
                    title: "テストケース"
                  }
                ],
                domains: [
                  {
                    domain: {
                      sourceRange: {
                        sources: [gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 1, 2)]
                      }
                    }
                  }
                ],
                series: [
                  {
                    series: {
                      sourceRange: {
                        sources: [gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 5, 6)]
                      }
                    },
                    targetAxis: "BOTTOM_AXIS",
                    color: COLORS.blue
                  },
                  {
                    series: {
                      sourceRange: {
                        sources: [gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 9, 10)]
                      }
                    },
                    targetAxis: "BOTTOM_AXIS",
                    color: COLORS.purple
                  }
                ]
              }
            },
            position: {
              overlayPosition: {
                anchorCell: { sheetId, rowIndex: dataEndRowIndex + 2, columnIndex: 1 },
                offsetXPixels: 0,
                offsetYPixels: 8,
                widthPixels: 720,
                heightPixels: 340
              }
            }
          }
        }
      }
    ]
  });
}

export async function readSuiteSheet(spreadsheetId) {
  const range = `${quoteSheet(SUITE_SHEET)}!A1:L1000`;
  const { result, authSource } = await googleRequest(
    `spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`
  );
  return { suite: rowsToSuiteInput(result.values || []), authSource };
}
