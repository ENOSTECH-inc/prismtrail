import { getAccessToken } from "./google-cloud.mjs";
import { formatCriteriaItems, parseCriteriaItems } from "./evaluate.mjs";
import { normalizeRelatedUrls } from "./related-urls.mjs";

export const SUITE_SHEET = "AgentEval_TestSuite";
export const REPORT_SHEET = "AgentEval_Report";
export const AGENTS_SHEET = "AgentEval_DataAgents";
export const SUITES_SHEET = "AgentEval_Suites";
export const SHEET_SCHEMA_VERSION = "5";
const SUPPORTED_SHEET_SCHEMA_VERSIONS = ["1", "2", "3", "4", SHEET_SCHEMA_VERSION];
export const MANAGED_SHEETS = [SUITE_SHEET, REPORT_SHEET, AGENTS_SHEET, SUITES_SHEET];
/** Max test cases per suite (API normalize, sheet import, and data-validation row span). */
export const MAX_SUITE_CASES = 120;

export const SUITE_HEADERS = [
  "case_id",
  "title",
  "prompt",
  "data_agent_id",
  "thinking_mode",
  "status",
  "require_sql",
  "require_chart",
  "max_duration_ms",
  "max_bytes_billed",
  "required_phrases",
  "required_sql_tables",
  "business_criteria",
  "knowledge_source_ids",
  "related_urls",
  "memo"
];

export const REPORT_HEADERS = [
  "case_id",
  "title",
  "status",
  "score",
  "system_status",
  "system_score",
  "system_checks",
  "business_grade",
  "business_mark",
  "business_score",
  "business_status",
  "business_reason",
  "business_criteria",
  "business_evidence",
  "business_model",
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
  "ステータス",
  "SQL必須",
  "チャート必須",
  "最大時間 (ms)",
  "最大課金バイト",
  "必須語句",
  "必須SQLテーブル",
  "ビジネス受入条件（;区切り）",
  "ナレッジID",
  "関連URL（1行1件）",
  "メモ"
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

const SUITE_HEADER_ALIASES = new Map([
  ...SUITE_HEADERS.map((header) => [header, header]),
  ...SUITE_DISPLAY_HEADERS.map((header, index) => [header, SUITE_HEADERS[index]]),
  ["accuracy_requirement", "business_criteria"],
  ["精度条件（自然言語）", "business_criteria"],
  ["ビジネス要件の検証内容", "business_criteria"],
  ["ビジネス要件の検証内容（自然言語）", "business_criteria"],
  ["ビジネス要件チェック（;区切り）", "business_criteria"],
  ["ビジネス要件チェック", "business_criteria"],
  ["ビジネス受入条件（;区切り）", "business_criteria"],
  ["ビジネス受入条件", "business_criteria"],
  ["精度検証ソース", "accuracy_sources_json"],
  ["精度検証ソースJSON", "accuracy_sources_json"],
  ["必須SQLテーブル", "required_sql_tables"],
  ["SQLテーブル", "required_sql_tables"],
  ["メモ", "memo"],
  ["備考", "memo"],
  ["参照メモ", "memo"],
  ["関連URL", "related_urls"],
  ["参考URL", "related_urls"],
  ["根拠URL", "related_urls"],
  ["ケースステータス", "status"],
  ["実行ステータス", "status"]
]);

export function normalizeCaseStatus(value, { fallback = "active" } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const key = raw.toLowerCase();
  if (raw === "実行可" || ["active", "enabled", "ready", "runnable"].includes(key)) return "active";
  if (raw === "下書き" || raw === "無効" || ["draft", "disabled", "paused", "skip", "skipped", "inactive"].includes(key)) {
    return "draft";
  }
  throw new Error(`ケースのステータスは「実行可」または「下書き」で指定してください: ${value}`);
}

export function caseStatusLabel(status) {
  return normalizeCaseStatus(status) === "active" ? "実行可" : "下書き";
}

export function isCaseRunnable(testCase = {}) {
  return normalizeCaseStatus(testCase.status) === "active";
}

/** Narrow a suite to selected case IDs for a partial (single-case) run. */
export function selectSuiteCasesForRun(suite, caseIds) {
  const ids = Array.isArray(caseIds)
    ? [...new Set(caseIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  if (!ids.length) return suite;
  const byId = new Map((suite?.cases || []).map((item) => [item.id, item]));
  const selected = [];
  for (const id of ids) {
    const match = byId.get(id);
    if (!match) {
      const error = new Error(`テストケースが見つかりません: ${id}`);
      error.status = 404;
      throw error;
    }
    selected.push(match);
  }
  return { ...suite, cases: selected };
}

function expectedSuiteHeaders(headers = []) {
  let expected = [...SUITE_HEADERS];
  if (headers.includes("accuracy_sources_json")) {
    expected.splice(expected.indexOf("business_criteria") + 1, 0, "accuracy_sources_json");
  }
  if (!headers.includes("status")) expected = expected.filter((header) => header !== "status");
  if (!headers.includes("business_criteria")) {
    expected = expected.filter((header) => header !== "business_criteria");
  }
  if (!headers.includes("required_sql_tables")) {
    expected = expected.filter((header) => header !== "required_sql_tables");
  }
  if (!headers.includes("knowledge_source_ids")) {
    expected = expected.filter((header) => header !== "knowledge_source_ids");
  }
  if (!headers.includes("memo")) {
    expected = expected.filter((header) => header !== "memo");
  }
  if (!headers.includes("related_urls")) {
    expected = expected.filter((header) => header !== "related_urls");
  }
  return expected;
}

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
  ["default_agent_id", "default_agent_id"],
  ["接続先Data Agent ID", "default_agent_id"],
  ["接続先DataAgent ID", "default_agent_id"],
  ["default_agent_name", "default_agent_name"],
  ["接続先Data Agent名", "default_agent_name"],
  ["接続先DataAgent名", "default_agent_name"],
  ["knowledge_source_ids", "knowledge_source_ids"],
  ["共通ナレッジ", "knowledge_source_ids"],
  ["exported_at", "exported_at"],
  ["最終出力", "exported_at"]
]);

/** Sheet-facing Data Agent ID: prefer GCP remote id over PrismTrail local id. */
export function agentSheetId(agent) {
  if (!agent) return "";
  const remote = String(agent.remoteId || "").trim();
  if (remote) return remote;
  const fromResource = String(agent.resourceName || "").match(/\/dataAgents\/([^/]+)$/)?.[1];
  if (fromResource) return fromResource;
  return String(agent.id || "").trim();
}

export function resolveAgentId(value, agents = []) {
  const input = String(value || "").trim();
  if (!input) return "";
  const list = Array.isArray(agents) ? agents : [];
  const byId = list.find((agent) => agent.id === input);
  if (byId) return byId.id;
  const bySheetId = list.find((agent) => agentSheetId(agent) === input);
  if (bySheetId) return bySheetId.id;
  const byResource = list.find((agent) => agent.resourceName === input);
  if (byResource) return byResource.id;
  return input;
}

export function normalizeSuiteAgentRefs(suite = {}, agents = []) {
  return {
    ...suite,
    defaultAgentId: resolveAgentId(suite.defaultAgentId, agents),
    cases: (suite.cases || []).map((testCase) => ({
      ...testCase,
      agentId: resolveAgentId(testCase.agentId, agents)
    }))
  };
}

function agentLookup(agents = []) {
  return new Map((agents || []).map((agent) => [agent.id, agent]));
}

function sheetAgentIdFor(value, agents = []) {
  const input = String(value || "").trim();
  if (!input) return "";
  const agent = agentLookup(agents).get(input) || (agents || []).find((item) => agentSheetId(item) === input);
  return agentSheetId(agent) || input;
}

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
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`0以上の数値を指定してください: ${value}`);
    }
    return value;
  }
  const raw = String(value).trim();
  if (!raw) return 0;
  // Sheets formatted copies often look like "120,000 ms" / "0 bytes".
  const normalized = raw
    .replace(/\u00a0/g, " ")
    .replace(/,/g, "")
    .replace(/\s*(milliseconds?|msecs?|ms|bytes?|byte|kib|mib|gib|kb|mb|gb|b)\s*$/i, "")
    .trim();
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`0以上の数値を指定してください: ${value}`);
  }
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
  const template = suiteToRows(targetSuite);
  const targetHeaderIndex = template.findIndex((row) => normalizeSuiteHeaders(row)[0] === "case_id");
  if (headerIndex >= 0) {
    const rows = [
      ...template.slice(0, targetHeaderIndex),
      parsed.rows[headerIndex],
      ...parsed.rows.slice(headerIndex + 1)
    ];
    return {
      suite: rowsToSuiteInput(rows),
      format: "table-with-header",
      delimiter: parsed.delimiter
    };
  }
  const rows = [...template];
  rows.splice(targetHeaderIndex + 1, rows.length - targetHeaderIndex - 1, ...parsed.rows);
  return {
    suite: rowsToSuiteInput(rows),
    format: "case-rows",
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

export function suiteToRows(suite, { agents = [] } = {}) {
  const primaryAgentId = resolveSuitePrimaryAgentId(suite, agents);
  const primaryAgent = agentLookup(agents).get(primaryAgentId);
  const primarySheetId = sheetAgentIdFor(primaryAgentId, agents);
  const primaryName =
    primaryAgent?.displayName ||
    primarySheetId ||
    String(suite.defaultAgentId || "").trim() ||
    "";
  return [
    ["PrismTrail | テストスイート管理"],
    ["スキーマ", SHEET_SCHEMA_VERSION],
    ["スイートID", suite.id || ""],
    ["スイート名", suite.name || ""],
    ["目的・説明", suite.description || ""],
    ["ステータス", suite.status || "draft"],
    ["接続先Data Agent ID", primarySheetId],
    ["接続先Data Agent名", primaryName],
    ["共通ナレッジ", (suite.knowledgeSourceIds || []).join(", ")],
    ["最終出力", new Date().toISOString()],
    ["", "▼ コピー範囲：次の青い見出し行から、入力済みの最終ケース行まで選択してください"],
    [...SUITE_DISPLAY_HEADERS],
    ...(suite.cases || []).map((testCase) => [
      testCase.id || "",
      testCase.title || "",
      testCase.prompt || "",
      sheetAgentIdFor(testCase.agentId, agents),
      testCase.thinkingMode === "THINKING" ? "THINKING" : "FAST",
      caseStatusLabel(testCase.status),
      testCase.expectations?.requireSql !== false,
      Boolean(testCase.expectations?.requireChart),
      Number(testCase.expectations?.maxDurationMs || 0),
      Number(testCase.expectations?.maxBytesBilled || 0),
      (testCase.expectations?.requiredPhrases || []).join(", "),
      (testCase.expectations?.requiredSqlTables ||
        testCase.expectations?.systemRequirements?.requiredSqlTables ||
        []).join(", "),
      formatCriteriaItems(
        testCase.expectations?.businessRequirements?.criteriaItems ??
          testCase.expectations?.businessRequirements?.accuracyCriteria ??
          testCase.expectations?.accuracyCriteria ??
          ""
      ),
      (testCase.knowledgeSourceIds || []).join(", "),
      (testCase.relatedUrls || []).join("\n"),
      testCase.memo || ""
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
  if (!SUPPORTED_SHEET_SCHEMA_VERSIONS.includes(schemaVersion)) {
    throw new Error(`未対応のschema_versionです。対応バージョン: ${SUPPORTED_SHEET_SCHEMA_VERSIONS.join(", ")}`);
  }
  const headers = normalizeSuiteHeaders(rows[headerIndex] || []);
  const expectedHeaders = expectedSuiteHeaders(headers);
  if (
    expectedHeaders.length !== headers.length ||
    expectedHeaders.some((header, index) => headers[index] !== header)
  ) {
    throw new Error(`列定義を変更しないでください: ${expectedHeaders.join(", ")}`);
  }
  const columnIndex = new Map(headers.map((header, index) => [header, index]));
  const cell = (row, header) => (columnIndex.has(header) ? row[columnIndex.get(header)] : undefined);
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
      let status = "active";
      try {
        status = normalizeCaseStatus(cell(row, "status"), { fallback: "active" });
      } catch (error) {
        throw new Error(`${rowNumber}行目: ${error.message}`);
      }
      const businessCriteriaCell = stringCell(cell(row, "business_criteria"));
      if (businessCriteriaCell.length > 5000) {
        throw new Error(`${rowNumber}行目: ビジネス要件チェックは5,000文字以内で指定してください。`);
      }
      const criteriaItems = parseCriteriaItems(businessCriteriaCell);
      const memo = stringCell(cell(row, "memo"));
      if (memo.length > 20000) {
        throw new Error(`${rowNumber}行目: メモは20,000文字以内で指定してください。`);
      }
      return {
        id: stringCell(cell(row, "case_id")) || undefined,
        title,
        prompt,
        agentId,
        thinkingMode,
        status,
        expectations: {
          requireSql: booleanCell(cell(row, "require_sql"), true),
          requireChart: booleanCell(cell(row, "require_chart"), false),
          maxDurationMs: numberCell(cell(row, "max_duration_ms")),
          maxBytesBilled: numberCell(cell(row, "max_bytes_billed")),
          requiredPhrases: listCell(cell(row, "required_phrases")),
          requiredSqlTables: listCell(cell(row, "required_sql_tables")),
          businessRequirements: {
            enabled: criteriaItems.length > 0,
            criteriaItems,
            passingGrade: "B"
          }
        },
        knowledgeSourceIds: listCell(cell(row, "knowledge_source_ids")),
        relatedUrls: normalizeRelatedUrls(stringCell(cell(row, "related_urls"))),
        memo
      };
    });
  if (cases.length > MAX_SUITE_CASES) {
    throw new Error(`1スイートに取り込めるテストケースは${MAX_SUITE_CASES}件までです。`);
  }
  return {
    sourceSuiteId: metadata.get("suite_id") || null,
    name: metadata.get("suite_name") || "Google Sheetsから取り込んだスイート",
    description: metadata.get("description") || "",
    status: metadata.get("status") === "active" ? "active" : "draft",
    defaultAgentId: metadata.get("default_agent_id") || "",
    knowledgeSourceIds: listCell(metadata.get("knowledge_source_ids")),
    cases
  };
}

/** Multiline business judgment cell — one checklist rule per block, like system ✓/× lines. */
function formatBusinessJudgmentCell(business = {}) {
  const lines = [];
  const summary = String(business.summary || "").trim();
  if (summary) lines.push(summary);
  const items = Array.isArray(business.itemResults) ? business.itemResults : [];
  if (items.length) {
    for (const entry of items) {
      const mark = entry.symbol || "?";
      const criterion = String(entry.criterion || "").trim();
      const reason = String(entry.reason || "").trim();
      if (!criterion && !reason) continue;
      lines.push(reason ? `${mark} ${criterion}\n   └ ${reason}` : `${mark} ${criterion}`);
    }
  } else if (Array.isArray(business.criteriaItems) && business.criteriaItems.length) {
    for (const criterion of business.criteriaItems) {
      const text = String(criterion || "").trim();
      if (text) lines.push(`— ${text}`);
    }
  }
  return lines.join("\n");
}

/** Expected checklist as numbered lines in one cell (not semicolon-joined). */
function formatBusinessCriteriaListCell(business = {}) {
  const items = Array.isArray(business.criteriaItems) && business.criteriaItems.length
    ? business.criteriaItems
    : Array.isArray(business.itemResults) && business.itemResults.length
      ? business.itemResults.map((entry) => entry.criterion)
      : String(business.expectedCriteria || "")
          .split(/;+/)
          .map((item) => item.trim())
          .filter(Boolean);
  return items
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n");
}

export function reportToRows(report) {
  const summaryGrades = report.summary?.businessGrades || report.summary?.accuracyGrades || {};
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
    review: "要確認",
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
    ["ビジネス要件 適合率", report.summary?.businessScore ?? "未設定"],
    ["システム合格率", report.summary?.systemPassRate || 0],
    ["ビジネス要件 合格率", businessPassRate],
    ["ビジネス等級分布", gradeCount ? `A ${grades.A || 0} / B ${grades.B || 0} / C ${grades.C || 0} / D ${grades.D || 0}` : "未設定"],
    ["", "◆ ビジネス要件の結果は、紫色の列（H〜O）に表示されます"],
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
      formatBusinessJudgmentCell(item.evaluation?.business || {}),
      formatBusinessCriteriaListCell(item.evaluation?.business || {}),
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
    `spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false&fields=spreadsheetId,properties.title,properties.locale,spreadsheetUrl,sheets(properties,charts.chartId,bandedRanges.bandedRangeId,conditionalFormats,rowGroups)`
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

const MANAGED_SUITE_TITLES = new Set([
  "PrismTrail | テストスイート管理",
  "Agent Eval テストスイート",
  "Agent Eval | テストスイート管理"
]);

export function isManagedSuiteTemplate(values = []) {
  return MANAGED_SUITE_TITLES.has(stringCell(values?.[0]?.[0]));
}

export function sampleSuiteCases({ agentId = "agent_tpcds_retail" } = {}) {
  return [
    {
      id: "case_sample_mau",
      title: "月次MAUの確認",
      prompt: "6月のMAUを教えて",
      agentId,
      thinkingMode: "FAST",
      status: "active",
      knowledgeSourceIds: [],
      memo: "",
      expectations: {
        requireSql: true,
        requireChart: false,
        maxDurationMs: 120000,
        maxBytesBilled: 0,
        requiredPhrases: ["MAU"],
        businessRequirements: {
          enabled: true,
          criteriaItems: ["6月のMAUが数値で回答されている", "対象期間が6月であることが明確"],
          passingGrade: "B"
        }
      }
    },
    {
      id: "case_sample_channel",
      title: "流入チャネル別ユーザー数",
      prompt: "6月の流入経路（チャネル別）のユーザー数内訳をチャート付きで教えて",
      agentId,
      thinkingMode: "FAST",
      status: "active",
      knowledgeSourceIds: [],
      memo: "",
      expectations: {
        requireSql: true,
        requireChart: true,
        maxDurationMs: 180000,
        maxBytesBilled: 0,
        requiredPhrases: ["チャネル"],
        businessRequirements: {
          enabled: true,
          criteriaItems: ["チャネル別のユーザー数が示されている", "表またはチャートがある"],
          passingGrade: "B"
        }
      }
    },
    {
      id: "case_sample_growth",
      title: "前月比の成長率",
      prompt: "5月と6月のMAUを比較し、成長率を教えて",
      agentId,
      thinkingMode: "THINKING",
      status: "active",
      knowledgeSourceIds: [],
      memo: "",
      expectations: {
        requireSql: true,
        requireChart: false,
        maxDurationMs: 180000,
        maxBytesBilled: 0,
        requiredPhrases: ["成長"],
        businessRequirements: {
          enabled: true,
          criteriaItems: ["5月と6月のMAUが回答に含まれる", "成長率または差分が示されている"],
          passingGrade: "B"
        }
      }
    }
  ];
}

export function emptySuiteTemplate(overrides = {}) {
  return {
    id: "",
    name: "新しいテストスイート",
    description: "Google Sheetsでケースを編集し、アプリへ取り込んでください。",
    status: "draft",
    knowledgeSourceIds: [],
    cases: [],
    ...overrides
  };
}

export function suiteWithSampleCases(suite = {}, { agentId } = {}) {
  if ((suite.cases || []).length > 0) return suite;
  const resolvedAgentId =
    agentId || suite.defaultAgentId || suite.cases?.[0]?.agentId || "agent_tpcds_retail";
  return {
    ...emptySuiteTemplate(),
    ...suite,
    defaultAgentId: suite.defaultAgentId || resolvedAgentId,
    cases: sampleSuiteCases({ agentId: resolvedAgentId })
  };
}

export function resolveSuitePrimaryAgentId(suite = {}, agents = []) {
  const preferred = String(suite.defaultAgentId || "").trim();
  if (preferred) return preferred;
  const counts = new Map();
  for (const testCase of suite.cases || []) {
    const id = String(testCase.agentId || "").trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  if (counts.size) {
    return [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    )[0][0];
  }
  return agents[0]?.id || "";
}

export function suiteWithAgentDefaults(suite = {}, agents = []) {
  const primaryAgentId = resolveSuitePrimaryAgentId(suite, agents);
  const cases = (suite.cases || []).map((testCase) => ({
    ...testCase,
    agentId: String(testCase.agentId || "").trim() || primaryAgentId
  }));
  return {
    ...suite,
    defaultAgentId: suite.defaultAgentId || primaryAgentId || "",
    cases
  };
}

export function prepareSuiteForSheetExport(suite = {}, agents = []) {
  return suiteWithSampleCases(suiteWithAgentDefaults(suite, agents), {
    agentId: resolveSuitePrimaryAgentId(suite, agents)
  });
}

export function sampleReportTemplate(suite = {}) {
  const seeded = suiteWithSampleCases(suite);
  const cases = (seeded.cases || []).slice(0, 3);
  const samples = [
    {
      status: "passed",
      score: 100,
      systemStatus: "passed",
      systemScore: 100,
      grade: "A",
      symbol: "◎",
      businessStatus: "passed",
      reason: "期待どおりの数値が回答に含まれています。（サンプル）"
    },
    {
      status: "passed",
      score: 85,
      systemStatus: "passed",
      systemScore: 100,
      grade: "B",
      symbol: "○",
      businessStatus: "passed",
      reason: "おおむね正しいです。単位の補足があるとより良いです。（サンプル）"
    },
    {
      status: "failed",
      score: 55,
      systemStatus: "passed",
      systemScore: 80,
      grade: "C",
      symbol: "△",
      businessStatus: "failed",
      reason: "期間の解釈がずれており、一部の数値が一致しません。（サンプル）"
    }
  ];
  const caseRuns = cases.map((testCase, index) => {
    const sample = samples[index] || samples[0];
    return {
      caseId: testCase.id,
      title: testCase.title,
      status: sample.status,
      evaluation: {
        score: sample.score,
        status: sample.status,
        system: {
          status: sample.systemStatus,
          score: sample.systemScore,
          checks: [
            { id: "sql", label: "SQLを生成・実行", passed: true },
            { id: "final-response", label: "最終回答", passed: sample.systemScore >= 100 },
            { id: "chart", label: "チャートを生成", passed: !testCase.expectations?.requireChart || index !== 2 }
          ]
        },
        business: {
          grade: sample.grade,
          symbol: sample.symbol,
          score: sample.score,
          status: sample.businessStatus,
          summary: sample.reason,
          criteriaItems: testCase.expectations?.businessRequirements?.criteriaItems || [],
          expectedCriteria: formatCriteriaItems(
            testCase.expectations?.businessRequirements?.criteriaItems ||
              testCase.expectations?.businessRequirements?.accuracyCriteria ||
              ""
          ),
          itemResults: (
            testCase.expectations?.businessRequirements?.criteriaItems ||
            String(testCase.expectations?.businessRequirements?.accuracyCriteria || "")
              .split(/;+/)
              .map((item) => item.trim())
              .filter(Boolean)
          ).map((criterion, itemIndex) => ({
            id: itemIndex + 1,
            criterion,
            mark: itemIndex === 0 ? "sun" : sample.grade === "A" ? "sun" : sample.grade === "B" ? "cloud" : "rain",
            symbol: itemIndex === 0 || sample.grade === "A" ? "☀️" : sample.grade === "B" ? "☁️" : "☔️",
            reason: itemIndex === 0 ? "サンプル根拠です" : sample.reason
          })),
          evidence: [
            {
              quote: "サンプル根拠テキスト",
              explanation: "シートの見た目確認用の例です"
            }
          ],
          judgeAudit: { model: "gemini-2.5-flash-lite" }
        }
      },
      runSummary: {
        durationMs: 42000 + index * 9000,
        totalBytesBilled: 1_500_000 * (index + 1)
      },
      runId: `run_sample_${index + 1}`,
      error: ""
    };
  });
  return {
    id: seeded.id ? `suite_run_sample_${seeded.id}` : "suite_run_sample",
    suiteId: seeded.id || "suite_sample",
    suiteName: seeded.name || "サンプル評価レポート",
    status: "failed",
    summary: {
      score: 80,
      passRate: 67,
      systemPassRate: 100,
      systemScore: 93,
      businessScore: 80,
      businessPassRate: 67,
      businessGrades: { A: 1, B: 1, C: 1, D: 0 }
    },
    caseRuns
  };
}

export function emptyReportTemplate(suite = {}) {
  return {
    id: "",
    suiteId: suite.id || "",
    suiteName: suite.name || "",
    status: "pending",
    summary: {
      score: 0,
      passRate: 0,
      systemPassRate: 0,
      systemScore: 0,
      businessScore: "未設定",
      businessGrades: { A: 0, B: 0, C: 0, D: 0 }
    },
    caseRuns: []
  };
}

export function agentsToRows(agents = []) {
  const sorted = [...agents].sort((left, right) =>
    String(left.displayName || left.id).localeCompare(String(right.displayName || right.id), "ja")
  );
  return [
    ["PrismTrail | Data Agent一覧"],
    ["スキーマ", SHEET_SCHEMA_VERSION],
    ["件数", sorted.length],
    ["最終出力", new Date().toISOString()],
    ["", "▼ アプリに登録済みのData Agentを全件表示します。絞り込みはせず、接続確認のたびに更新されます。"],
    [
      "Agent ID",
      "表示名",
      "リソース名",
      "プロジェクト",
      "ロケーション",
      "状態",
      "説明",
      "最終確認",
      "更新日時"
    ],
    ...sorted.map((agent) => [
      agentSheetId(agent) || agent.id || "",
      agent.displayName || "",
      agent.resourceName || "",
      agent.projectId || "",
      agent.location || "",
      agent.status || "",
      agent.description || "",
      agent.lastCheckedAt || "",
      agent.updatedAt || agent.createdAt || ""
    ])
  ];
}

export function suitesCatalogToRows(suites = [], agents = []) {
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
  const sorted = [...suites].sort((left, right) =>
    String(right.updatedAt || right.createdAt || "").localeCompare(
      String(left.updatedAt || left.createdAt || "")
    )
  );
  return [
    ["PrismTrail | テストスイート一覧"],
    ["スキーマ", SHEET_SCHEMA_VERSION],
    ["件数", sorted.length],
    ["最終出力", new Date().toISOString()],
    ["", "▼ アプリ内のテストスイートを全件表示します。ケースで参照しているData Agentも併記します。"],
    [
      "スイートID",
      "スイート名",
      "ステータス",
      "目的・説明",
      "ケース数",
      "Data Agent ID",
      "Data Agent表示名",
      "共通ナレッジ",
      "最終実行",
      "更新日時"
    ],
    ...sorted.map((suite) => {
      const agentIds = [
        ...new Set(
          (suite.cases || [])
            .map((item) => sheetAgentIdFor(item.agentId, agents))
            .filter(Boolean)
        )
      ];
      const agentNames = agentIds.map((id) => {
        const agent =
          agentMap.get(id) ||
          agents.find((item) => agentSheetId(item) === id);
        return agent?.displayName || id;
      });
      return [
        suite.id || "",
        suite.name || "",
        suite.status || "draft",
        suite.description || "",
        (suite.cases || []).length,
        agentIds.join(", "),
        agentNames.join(", "),
        (suite.knowledgeSourceIds || []).join(", "),
        suite.lastRunAt || "",
        suite.updatedAt || suite.createdAt || ""
      ];
    })
  ];
}

export async function getManagedSheetStatus(spreadsheetId) {
  const spreadsheet = await getSpreadsheet(spreadsheetId);
  const titles = new Set(
    (spreadsheet.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean)
  );
  const hasSuiteTab = titles.has(SUITE_SHEET);
  const hasReportTab = titles.has(REPORT_SHEET);
  const hasAgentsTab = titles.has(AGENTS_SHEET);
  const hasSuitesTab = titles.has(SUITES_SHEET);
  let suiteTemplateReady = false;
  if (hasSuiteTab) {
    const { result } = await googleRequest(
      `spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${quoteSheet(SUITE_SHEET)}!A1:B12`)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`
    );
    suiteTemplateReady = isManagedSuiteTemplate(result.values || []);
  }
  return {
    spreadsheet,
    hasSuiteTab,
    hasReportTab,
    hasAgentsTab,
    hasSuitesTab,
    suiteTemplateReady,
    needsSuiteBootstrap: !suiteTemplateReady,
    needsReportBootstrap: !hasReportTab,
    needsCatalogBootstrap: !hasAgentsTab || !hasSuitesTab
  };
}

export function writeAgentsSheet(spreadsheetId, agents = []) {
  return writeFixedSheet(spreadsheetId, AGENTS_SHEET, agentsToRows(agents), 5, {
    columnWidths: [180, 220, 520, 160, 120, 100, 320, 180, 180],
    tabColor: COLORS.cyan
  });
}

export function writeSuitesCatalogSheet(spreadsheetId, suites = [], agents = []) {
  return writeFixedSheet(spreadsheetId, SUITES_SHEET, suitesCatalogToRows(suites, agents), 5, {
    columnWidths: [180, 240, 100, 360, 90, 220, 240, 180, 180, 180],
    tabColor: COLORS.purple
  });
}

export async function writeCatalogSheets(spreadsheetId, { agents = [], suites = [] } = {}) {
  const agentsResult = await writeAgentsSheet(spreadsheetId, agents);
  const suitesResult = await writeSuitesCatalogSheet(spreadsheetId, suites, agents);
  return {
    spreadsheet: suitesResult.spreadsheet || agentsResult.spreadsheet,
    agentsTab: AGENTS_SHEET,
    suitesTab: SUITES_SHEET,
    agentCount: agents.length,
    suiteCount: suites.length,
    agentsRowCount: agentsResult.rowCount,
    suitesRowCount: suitesResult.rowCount
  };
}

export async function bootstrapManagedSheets(
  spreadsheetId,
  { suite, agents = [], suites = [], forceOperational = false } = {}
) {
  const status = await getManagedSheetStatus(spreadsheetId);
  const seedSuite = prepareSuiteForSheetExport(suite || emptySuiteTemplate(), agents);
  let suiteResult = null;
  let reportResult = null;

  const catalogResult = await writeCatalogSheets(spreadsheetId, { agents, suites });

  if (status.needsSuiteBootstrap || forceOperational) {
    suiteResult = await writeSuiteSheet(spreadsheetId, seedSuite, { agents });
  }
  if (status.needsReportBootstrap || forceOperational) {
    reportResult = await writeReportSheet(spreadsheetId, sampleReportTemplate(seedSuite));
  }

  const spreadsheet =
    suiteResult?.spreadsheet ||
    reportResult?.spreadsheet ||
    catalogResult.spreadsheet ||
    status.spreadsheet;
  return {
    spreadsheet,
    suiteBootstrapped: Boolean(suiteResult),
    reportBootstrapped: Boolean(reportResult),
    catalogsBootstrapped: true,
    suiteTab: SUITE_SHEET,
    reportTab: REPORT_SHEET,
    agentsTab: AGENTS_SHEET,
    suitesTab: SUITES_SHEET,
    suiteRowCount: suiteResult?.rowCount || null,
    reportRowCount: reportResult?.rowCount || null,
    agentCount: catalogResult.agentCount,
    suiteCount: catalogResult.suiteCount
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
  line: { red: 0.72, green: 0.76, blue: 0.82 },
  lineStrong: { red: 0.55, green: 0.6, blue: 0.68 },
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

function borderStyle(color = COLORS.line, style = "SOLID") {
  return { style, color };
}

/** Apply outer + inner grid borders to a range (used when hideGridlines is on). */
export function updateBordersRequest(range, { color = COLORS.line, style = "SOLID", outerStyle } = {}) {
  const inner = borderStyle(color, style);
  const outer = borderStyle(color, outerStyle || style);
  return {
    updateBorders: {
      range,
      top: outer,
      bottom: outer,
      left: outer,
      right: outer,
      innerHorizontal: inner,
      innerVertical: inner
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

export function metadataRowGroupRequests(sheet, sheetId, headerRowIndex) {
  if (!Number.isInteger(headerRowIndex) || headerRowIndex <= 1) return [];
  const existing = [...(sheet?.rowGroups || [])]
    .filter((group) => group?.range?.dimension === "ROWS")
    .sort((left, right) => Number(right.depth || 0) - Number(left.depth || 0));
  return [
    ...existing.map((group) => ({
      deleteDimensionGroup: {
        range: {
          sheetId: group.range.sheetId ?? sheetId,
          dimension: "ROWS",
          startIndex: group.range.startIndex,
          endIndex: group.range.endIndex
        }
      }
    })),
    {
      addDimensionGroup: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: 1,
          endIndex: headerRowIndex
        }
      }
    }
  ];
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
  const metadataMergeRequests = Array.from({ length: Math.max(headerRowIndex - 1, 0) }, (_, index) => index + 1)
    .map((rowIndex) => ({
      mergeCells: {
        range: gridRange(sheetId, rowIndex, rowIndex + 1, 1, lastColumn),
        mergeType: "MERGE_ALL"
      }
    }));
  const headerRange = gridRange(sheetId, headerRowIndex, headerRowIndex + 1, 0, lastColumn);
  const dataRange = gridRange(sheetId, dataStartRowIndex, dataEndRowIndex, 0, lastColumn);
  // Apply after repeatCell formats — full userEnteredFormat writes clear cell borders.
  const borderRequests = [
    ...(headerRowIndex > 1
      ? [
          updateBordersRequest(gridRange(sheetId, 0, 1, 0, lastColumn), {
            color: COLORS.navy,
            style: "SOLID"
          }),
          updateBordersRequest(gridRange(sheetId, 1, headerRowIndex, 0, lastColumn), {
            color: COLORS.line,
            style: "SOLID"
          })
        ]
      : [
          updateBordersRequest(gridRange(sheetId, 0, 1, 0, lastColumn), {
            color: COLORS.navy,
            style: "SOLID"
          })
        ]),
    updateBordersRequest(gridRange(sheetId, headerRowIndex, dataEndRowIndex, 0, lastColumn), {
      color: COLORS.lineStrong,
      style: "SOLID",
      outerStyle: "SOLID_MEDIUM"
    })
  ];
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
        repeatFormat(gridRange(sheetId, 1, Math.max(headerRowIndex - 1, 1), 0, 1), {
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
        repeatFormat(gridRange(sheetId, 1, Math.max(headerRowIndex - 1, 1), 1, lastColumn), {
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
        rowHeight(sheetId, 1, Math.max(headerRowIndex - 1, 1), 29),
        rowHeight(sheetId, 4, 5, 42),
        rowHeight(sheetId, Math.max(headerRowIndex - 1, 1), headerRowIndex, 16),
        rowHeight(sheetId, headerRowIndex, headerRowIndex + 1, 42),
        rowHeight(sheetId, dataStartRowIndex, dataEndRowIndex, title === REPORT_SHEET ? 110 : 54),
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
        }),
        ...borderRequests,
        ...metadataRowGroupRequests(sheet, sheetId, headerRowIndex)
      ]
    }
  });
  return { spreadsheet, sheetTitle: title, rowCount: rows.length };
}

export function writeSuiteSheet(spreadsheetId, suite, { agents = [] } = {}) {
  const agentIds = [
    ...new Set(
      agents
        .map((agent) => agentSheetId(agent))
        .filter(Boolean)
    )
  ];
  return writeFixedSheet(spreadsheetId, SUITE_SHEET, suiteToRows(suite, { agents }), 11, {
    columnWidths: [150, 220, 520, 180, 110, 100, 95, 105, 125, 145, 180, 200, 420, 180, 300, 360],
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
        gridRange(sheetId, headerRowIndex, headerRowIndex + 1, 12, 13),
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
      ...(agentIds.length
        ? [
            {
              setDataValidation: {
                range: gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + MAX_SUITE_CASES, 3, 4),
                rule: {
                  condition: {
                    type: "ONE_OF_LIST",
                    values: agentIds.map((id) => ({ userEnteredValue: id }))
                  },
                  strict: true,
                  showCustomUi: true
                }
              }
            }
          ]
        : []),
      {
        setDataValidation: {
          range: gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + MAX_SUITE_CASES, 4, 5),
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
      {
        setDataValidation: {
          range: gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + MAX_SUITE_CASES, 5, 6),
          rule: {
            condition: {
              type: "ONE_OF_LIST",
              values: [{ userEnteredValue: "実行可" }, { userEnteredValue: "下書き" }]
            },
            strict: true,
            showCustomUi: true
          }
        }
      },
      ...[6, 7].map((columnIndex) => ({
        setDataValidation: {
          range: gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + MAX_SUITE_CASES, columnIndex, columnIndex + 1),
          rule: {
            condition: { type: "BOOLEAN" },
            strict: true,
            showCustomUi: true
          }
        }
      })),
      repeatFormat(
        gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + MAX_SUITE_CASES, 8, 9),
        { numberFormat: { type: "NUMBER", pattern: "#,##0" }, horizontalAlignment: "RIGHT" },
        "userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment"
      ),
      repeatFormat(
        gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + MAX_SUITE_CASES, 9, 10),
        { numberFormat: { type: "NUMBER", pattern: "#,##0" }, horizontalAlignment: "RIGHT" },
        "userEnteredFormat.numberFormat,userEnteredFormat.horizontalAlignment"
      ),
      repeatFormat(
        gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + MAX_SUITE_CASES, 12, 13),
        {
          backgroundColor: COLORS.purpleSoft,
          textFormat: { foregroundColor: COLORS.ink },
          wrapStrategy: "WRAP"
        }
      ),
      repeatFormat(
        gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + MAX_SUITE_CASES, 14, 16),
        { wrapStrategy: "WRAP", verticalAlignment: "TOP" },
        "userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment"
      ),
      {
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + MAX_SUITE_CASES, 4, 5)],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "THINKING" }] },
              format: { backgroundColor: COLORS.amberSoft, textFormat: { foregroundColor: COLORS.amber, bold: true } }
            }
          }
        }
      },
      {
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [gridRange(sheetId, dataStartRowIndex, dataStartRowIndex + MAX_SUITE_CASES, 5, 6)],
            booleanRule: {
              condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "下書き" }] },
              format: { backgroundColor: COLORS.panel, textFormat: { foregroundColor: COLORS.muted, bold: true } }
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
      {
        setDataValidation: {
          range: gridRange(sheetId, 6, 7, 1, REPORT_HEADERS.length),
          rule: {
            condition: {
              type: "ONE_OF_LIST",
              values: [
                { userEnteredValue: "passed" },
                { userEnteredValue: "failed" },
                { userEnteredValue: "review_required" },
                { userEnteredValue: "pending" }
              ]
            },
            strict: true,
            showCustomUi: true
          }
        }
      },
      ...[2, 4].map((columnIndex) => ({
        setDataValidation: {
          range: gridRange(sheetId, dataStartRowIndex, Math.max(dataEndRowIndex, dataStartRowIndex + MAX_SUITE_CASES), columnIndex, columnIndex + 1),
          rule: {
            condition: {
              type: "ONE_OF_LIST",
              values: [
                { userEnteredValue: "passed" },
                { userEnteredValue: "failed" },
                { userEnteredValue: "review_required" }
              ]
            },
            strict: true,
            showCustomUi: true
          }
        }
      })),
      {
        setDataValidation: {
          range: gridRange(sheetId, dataStartRowIndex, Math.max(dataEndRowIndex, dataStartRowIndex + MAX_SUITE_CASES), 7, 8),
          rule: {
            condition: {
              type: "ONE_OF_LIST",
              values: [
                { userEnteredValue: "A" },
                { userEnteredValue: "B" },
                { userEnteredValue: "C" },
                { userEnteredValue: "D" }
              ]
            },
            strict: true,
            showCustomUi: true
          }
        }
      },
      {
        setDataValidation: {
          range: gridRange(sheetId, dataStartRowIndex, Math.max(dataEndRowIndex, dataStartRowIndex + MAX_SUITE_CASES), 10, 11),
          rule: {
            condition: {
              type: "ONE_OF_LIST",
              values: [
                { userEnteredValue: "合格" },
                { userEnteredValue: "不合格" },
                { userEnteredValue: "要確認" },
                { userEnteredValue: "判定保留" },
                { userEnteredValue: "未設定" }
              ]
            },
            strict: true,
            showCustomUi: true
          }
        }
      },
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
