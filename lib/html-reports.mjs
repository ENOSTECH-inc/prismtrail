import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import {
  extractChartPreview,
  extractFinalResponseText,
  extractRunSqlText,
  renderChartPreviewSvg
} from "./run-preview.mjs";

const templateDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
  "html-report"
);
const appBaseUrl = String(process.env.PRISMTRAIL_APP_BASE_URL || "http://127.0.0.1:4318").replace(/\/$/, "");

const environment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(templateDirectory, { noCache: true }),
  { autoescape: true, throwOnUndefined: false }
);

function safeJson(value) {
  return JSON.stringify(value ?? null)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

environment.addFilter("tojson", (value) => new nunjucks.runtime.SafeString(safeJson(value)));

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function markdownToSafeHtml(value) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let fence = [];
  let list = null;
  const closeList = () => {
    if (!list) return;
    output.push(`</${list}>`);
    list = null;
  };
  for (const line of lines) {
    if (/^```/.test(line)) {
      closeList();
      if (fence) {
        if (fence.length) {
          output.push(`<pre class="md-fence"><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
          fence = [];
        } else {
          fence = [""];
        }
      }
      continue;
    }
    if (fence.length) {
      fence.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || ordered) {
      const wanted = bullet ? "ul" : "ol";
      if (list !== wanted) {
        closeList();
        list = wanted;
        output.push(`<${list}>`);
      }
      output.push(`<li>${inlineMarkdown((bullet || ordered)[1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) output.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  if (fence.length) output.push(`<pre class="md-fence"><code>${escapeHtml(fence.slice(1).join("\n"))}</code></pre>`);
  return output.join("\n");
}

function sanitizeSvg(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<a\b[^>]*>/gi, "")
    .replace(/<\/a>/gi, "")
    .replace(/\s(?:on[a-z]+|href|xlink:href|style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function svgImageDataUrl(value) {
  const svg = sanitizeSvg(value);
  return svg ? `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}` : "";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDuration(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}秒`;
  return `${Math.floor(milliseconds / 60_000)}分${Math.round((milliseconds % 60_000) / 1_000)}秒`;
}

function readablePayload(payload) {
  if (payload == null) return "";
  if (typeof payload === "string" || typeof payload === "number" || typeof payload === "boolean") {
    return String(payload).trim();
  }
  if (Array.isArray(payload)) {
    return payload.map(readablePayload).filter(Boolean).join("\n");
  }
  if (Array.isArray(payload.parts)) return payload.parts.map(readablePayload).filter(Boolean).join("\n");
  for (const key of [
    "text",
    "content",
    "message",
    "reasoning",
    "naturalLanguage",
    "naturalLanguageQuery",
    "naturalLanguageQuestion",
    "question",
    "query",
    "result",
    "csvData",
    "referenceData",
    "output"
  ]) {
    if (payload[key] != null) {
      const text = readablePayload(payload[key]);
      if (text) return text;
    }
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function clipNarrative(value, max = 4_000) {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function responseAnalysisDetails(run = {}) {
  const detailKinds = new Set([
    "analysis.coder_instruction",
    "analysis.code",
    "analysis.execution_output",
    "analysis.execution_error",
    "analysis.result_csv_data",
    "analysis.result_reference_data",
    "analysis.error"
  ]);
  const seen = new Set();
  const analysisDetails = [];
  for (const event of run.events || []) {
    if (!detailKinds.has(event.kind)) continue;
    const text = String(readablePayload(event.payload) || "").replace(/\r\n?/g, "\n").trim();
    if (!text) continue;
    const key = `${event.kind}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    analysisDetails.push({ label: event.label || "分析イベント", kind: event.kind, text });
  }
  return analysisDetails;
}

function responseFollowups(run = {}) {
  const values = [];
  for (const event of run.events || []) {
    if (event.kind !== "text.followup_questions" && event.kind !== "example_queries") continue;
    const payload = event.payload;
    const candidates = Array.isArray(payload)
      ? payload
      : payload?.parts || payload?.questions || payload?.exampleQueries || payload?.queries || [payload];
    for (const candidate of candidates) {
      const text = clipNarrative(readablePayload(candidate), 1_000);
      if (text) values.push(text);
    }
  }
  return [...new Set(values)];
}

function cellValue(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function dataResultPreviews(run = {}, { maxRows = 500, maxCols = 50 } = {}) {
  return (run.events || [])
    .filter((event) => event.kind === "data.result")
    .map((event, eventIndex) => {
      const payload = event.payload || {};
      const rowsSource = Array.isArray(payload.formattedData)
        ? payload.formattedData
        : Array.isArray(payload.data)
          ? payload.data
          : Array.isArray(payload.rows)
            ? payload.rows
            : [];
      const first = rowsSource[0];
      let headers = [];
      let rows = [];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        headers = [...new Set(rowsSource.slice(0, maxRows).flatMap((row) => Object.keys(row || {})))].slice(0, maxCols);
        rows = rowsSource.slice(0, maxRows).map((row) => headers.map((key) => clipNarrative(cellValue(row?.[key]), 500)));
      } else if (Array.isArray(first)) {
        const schemaHeaders = (payload.schema?.fields || []).map((field) => field?.name).filter(Boolean);
        const width = Math.min(maxCols, Math.max(schemaHeaders.length, first.length));
        headers = Array.from({ length: width }, (_, index) => schemaHeaders[index] || `c${index + 1}`);
        rows = rowsSource.slice(0, maxRows).map((row) => headers.map((_, index) => clipNarrative(cellValue(row?.[index]), 500)));
      } else if (rowsSource.length) {
        headers = ["value"];
        rows = rowsSource.slice(0, maxRows).map((row) => [clipNarrative(cellValue(row), 500)]);
      }
      return {
        name: payload.name || `データ ${eventIndex + 1}`,
        headers,
        rows,
        totalRows: rowsSource.length,
        totalColumns: first && typeof first === "object"
          ? Array.isArray(first) ? first.length : Object.keys(first).length
          : rowsSource.length ? 1 : 0,
        rowTruncated: rowsSource.length > maxRows,
        columnTruncated: first && typeof first === "object" && (Array.isArray(first) ? first.length : Object.keys(first).length) > maxCols,
        truncated: rowsSource.length > maxRows || (first && typeof first === "object" && (Array.isArray(first) ? first.length : Object.keys(first).length) > maxCols)
      };
    })
    .filter((preview) => preview.headers.length);
}

function displayTable(preview, reportId, index = 0) {
  if (!preview?.headers?.length) return null;
  const columns = preview.headers.map((label, index) => ({
    key: `c${index}`,
    label,
    align: "left",
    format: "text"
  }));
  const rows = preview.rows.map((values) => Object.fromEntries(columns.map((column, index) => [column.key, values[index] ?? ""])));
  return {
    title: preview.name || "データテーブル",
    is_generic_title: !preview.name || preview.name === "result",
    dom_id: `table-${String(reportId).replace(/[^a-zA-Z0-9_-]/g, "-")}-${index + 1}`,
    columns,
    rows,
    body_rows_html: rows.map((row) => columns.map((column) => `<td style="text-align:left;">${escapeHtml(row[column.key] || "—")}</td>`).join("")),
    initial_rows: 20,
    page_size: 20,
    visible_count: Math.min(20, rows.length),
    display_total: rows.length,
    total_rows: preview.totalRows,
    total_columns: preview.totalColumns,
    row_truncated: preview.rowTruncated,
    column_truncated: preview.columnTruncated,
    truncated: preview.truncated
  };
}

async function buildSingleContext({ report, testCase, caseRun, run }) {
  const caseId = testCase?.id || testCase?.caseId || caseRun?.caseId || "case";
  const reportId = `${report.id || "report"}-${caseId}`;
  const answer = extractFinalResponseText(run || {});
  const tables = dataResultPreviews(run || {}).map((preview, index) => displayTable(preview, reportId, index));
  const table = tables[0] || null;
  const chart = extractChartPreview(run || {});
  const charts = [];
  for (const [index, spec] of (chart?.specs || []).entries()) {
    const dataUrl = svgImageDataUrl(await renderChartPreviewSvg(
      { specs: [spec] },
      { width: 860, height: 360, stripText: false }
    ));
    if (dataUrl) charts.push({ id: `chart-${index + 1}`, title: chart.titles?.[index] || `チャート ${index + 1}`, data_url: dataUrl });
  }
  const sql = extractRunSqlText(run || {});
  const generatedAt = formatDate(report.completedAt || report.updatedAt || report.createdAt || new Date().toISOString());
  const analysisDetails = responseAnalysisDetails(run || {});
  const followups = responseFollowups(run || {});
  const question = run?.question || testCase?.prompt || caseRun?.prompt || "";
  const title = question || testCase?.title || caseRun?.title || `分析レポート ${caseId}`;
  const totalRecords = tables.reduce((sum, item) => sum + Number(item.total_rows || 0), 0);
  const agentLabel = run?.agentLabel || report.agentLabel || "Data Agent";
  const sqlList = sql ? sql.split("\n\n-- 次の実行SQL --\n\n") : [];
  let sectionIndex = 0;
  const nextSectionNumber = (visible) => visible ? String(++sectionIndex).padStart(2, "0") : "";
  const sectionNumbers = {
    sql: nextSectionNumber(sqlList.length),
    table: nextSectionNumber(tables.length),
    chart: nextSectionNumber(charts.length),
    analysis: nextSectionNumber(analysisDetails.length),
    answer: nextSectionNumber(answer),
    followups: nextSectionNumber(followups.length),
    responseJson: nextSectionNumber(true)
  };
  return {
    report_id: reportId,
    log_id: caseRun?.runId || "",
    session_id: report.id || "",
    title,
    subtitle: `会話型分析 · ${agentLabel}`,
    eyebrow: "分析レポート",
    question,
    answer,
    answer_html: markdownToSafeHtml(answer),
    kpi_target: null,
    kpis: [],
    home_url: `${appBaseUrl}/#/reports/${encodeURIComponent(report.id || "")}/cases/${encodeURIComponent(caseId)}`,
    analysis_details: analysisDetails,
    followups,
    section_numbers: sectionNumbers,
    response_json: JSON.stringify(run?.rawMessages || run?.events || [], null, 2),
    table,
    tables,
    charts,
    sql_list: sqlList,
    csv_rows: table ? table.rows.map((row) => Object.fromEntries(table.columns.map((column) => [column.label, row[column.key]]))) : [],
    csv_filename: `prismtrail-${caseId}.csv`,
    meta_items: [
      { label: "Data Agent", value: agentLabel },
      { label: "レコード数", value: totalRecords ? `${totalRecords}件` : "—" },
      { label: "テーブル", value: tables.length ? `${tables.length}件` : "—" },
      { label: "チャート", value: charts.length ? `${charts.length}件` : "—" },
      { label: "処理時間", value: formatDuration(run?.summary?.durationMs) },
      { label: "生成日時", value: generatedAt }
    ],
    generated_at: generatedAt,
    footer_brand: "PrismTrail · Data Agent Analysis",
    category: "Data Agent分析"
  };
}

function selectedCases(report, caseIds) {
  const selected = caseIds?.length ? new Set(caseIds) : null;
  const caseRuns = new Map((report.caseRuns || []).map((item) => [item.caseId, item]));
  return (report.suiteSnapshot?.cases || [])
    .filter((item) => !selected || selected.has(item.id || item.caseId))
    .map((testCase) => ({ testCase, caseRun: caseRuns.get(testCase.id || testCase.caseId) || { caseId: testCase.id, status: "skipped" } }));
}

export async function renderHtmlReport({ report, caseIds = null, runsById = {} }) {
  const cases = selectedCases(report, caseIds).filter((entry) => entry.caseRun?.runId && runsById[entry.caseRun.runId]);
  if (!cases.length) {
    const error = new Error("出力対象に利用可能なData Agent応答がありません。");
    error.status = 404;
    throw error;
  }
  const singles = [];
  for (const entry of cases) {
    singles.push(await buildSingleContext({
      report,
      ...entry,
      run: entry.caseRun?.runId ? runsById[entry.caseRun.runId] : null
    }));
  }
  if (singles.length === 1) {
    return {
      html: environment.render("single_report.html.j2", singles[0]),
      filename: htmlReportFilename("case", cases[0].testCase.id || cases[0].testCase.caseId)
    };
  }
  const singleHtmls = singles.map((context) => environment.render("single_report.html.j2", context));
  const generatedAt = formatDate(report.completedAt || report.updatedAt || report.createdAt || new Date().toISOString());
  const items = singles.map((single, index) => ({
    index,
    num: index + 1,
    report_id: single.report_id,
    key: single.report_id,
    title: single.title,
    category: single.category,
    question: single.question,
    search_blob: [single.title, single.question].join(" "),
    kinds: "what",
    html_b64: Buffer.from(singleHtmls[index], "utf8").toString("base64"),
    updated_at: generatedAt
  }));
  const context = {
    report_id: report.id || "report",
    session_id: report.id || "",
    title: report.suiteSnapshot?.name || report.suiteName || "PrismTrail 統合レポート",
    subtitle: `${items.length} 件のData Agent分析を統合`,
    count: items.length,
    generated_at: generatedAt,
    groups: [{ name: "Data Agent分析", entries: items }],
    items
  };
  return {
    html: environment.render("integrated_report.html.j2", context),
    filename: htmlReportFilename("run", report.id || "report")
  };
}

export function htmlReportFilename(kind, id) {
  const safe = String(id || "report").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "report";
  return `prismtrail-${kind}-${safe}.html`;
}
