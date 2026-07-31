import { generate } from "@pdfme/generator";
import { PDFDocument, PDFName, PDFString } from "@pdfme/pdf-lib";
import { line, rectangle, svg, table, text } from "@pdfme/schemas";
import { buildPieChartSvg, buildStackedBarSvg, pct, withCountPct } from "./pdf-chart.mjs";
import { FONT_NAME, FONT_NAME_BOLD, FONT_NAME_REGULAR, loadPdfFontOptions } from "./pdf-font.mjs";
import { buildRunEvidencePreview, clipText } from "./run-preview.mjs";

export const APP_BASE_URL = process.env.PRISMTRAIL_APP_BASE_URL || "http://127.0.0.1:4318";

/** TestRail-inspired palette: navy headers, status colors as meaning. */
const NAVY = "#1a365d";
const NAVY_DEEP = "#122744";
const BLUE = "#2c5aa0";
const MUTED = "#5a6b7d";
const LINE = "#d5deed";
const BAND = "#e8eef5";
const GREEN = "#1f8a4c";
const RED = "#c0392b";
const AMBER = "#d68910";
const GRAY = "#7f8c9a";
const WHITE = "#ffffff";

const PAGE = { width: 210, height: 297, padding: [12, 12, 14, 12] };
const CONTENT_WIDTH = 186;
const LEFT = 12;
const MM_TO_PT = 72 / 25.4;
const OPEN_LINK_BOX = { xMm: LEFT, yMm: 36, wMm: 160, hMm: 7 };

const STATUS_COLORS = {
  passed: GREEN,
  failed: RED,
  review_required: AMBER,
  skipped: GRAY,
  cancelled: GRAY
};

const GRADE_COLORS = {
  A: GREEN,
  B: BLUE,
  C: AMBER,
  D: RED
};

const plugins = {
  Text: text,
  Table: table,
  Line: line,
  Rectangle: rectangle,
  Svg: svg
};

export function caseEditorUrl(suiteId, caseId) {
  return `${APP_BASE_URL}/#/suites/${encodeURIComponent(suiteId)}/edit/${encodeURIComponent(caseId)}`;
}

export function suiteRunReportUrl(suiteRunId) {
  return `${APP_BASE_URL}/#/reports/${encodeURIComponent(suiteRunId)}`;
}

export function runDetailUrl(runId) {
  return `${APP_BASE_URL}/#/runs/${encodeURIComponent(runId)}`;
}

function textSchema(
  name,
  {
    x = LEFT,
    y,
    width = CONTENT_WIDTH,
    height = 8,
    fontSize = 10,
    fontColor = NAVY,
    fontName = FONT_NAME,
    align = "left",
    overflow,
    lineHeight = 1.4
  } = {}
) {
  return {
    name,
    type: "text",
    position: { x, y },
    width,
    height,
    fontName,
    fontSize,
    fontColor,
    alignment: align,
    verticalAlignment: "top",
    lineHeight,
    characterSpacing: 0,
    ...(overflow ? { overflow } : {})
  };
}

function lineSchema(name, y) {
  return {
    name,
    type: "line",
    position: { x: LEFT, y },
    width: CONTENT_WIDTH,
    height: 0.4,
    color: LINE
  };
}

function rectSchema(name, { x = 0, y, width = 210, height, color }) {
  return {
    name,
    type: "rectangle",
    position: { x, y },
    width,
    height,
    rotate: 0,
    opacity: 1,
    borderWidth: 0,
    borderColor: color,
    color,
    readOnly: true,
    radius: 0
  };
}

function svgSchema(name, { x = LEFT, y, width, height }) {
  return {
    name,
    type: "svg",
    position: { x, y },
    width,
    height,
    content: ""
  };
}

function tableSchema(name, y, head, widths, { bodySize = 8.5, headSize = 8.5, headBg = NAVY } = {}) {
  return {
    name,
    type: "table",
    position: { x: LEFT, y },
    width: CONTENT_WIDTH,
    height: 28,
    showHead: true,
    head,
    headWidthPercentages: widths,
    tableStyles: { borderWidth: 0.3, borderColor: LINE },
    headStyles: {
      fontName: FONT_NAME_BOLD,
      fontSize: headSize,
      characterSpacing: 0,
      alignment: "left",
      verticalAlignment: "middle",
      lineHeight: 1.2,
      fontColor: WHITE,
      backgroundColor: headBg,
      borderColor: headBg,
      borderWidth: { top: 0, right: 0, bottom: 0, left: 0 },
      padding: { top: 4, right: 5, bottom: 4, left: 5 }
    },
    bodyStyles: {
      fontName: FONT_NAME,
      fontSize: bodySize,
      characterSpacing: 0,
      alignment: "left",
      verticalAlignment: "middle",
      lineHeight: 1.25,
      fontColor: NAVY,
      borderColor: LINE,
      backgroundColor: WHITE,
      alternateBackgroundColor: "#f7fafc",
      borderWidth: { top: 0.2, right: 0.2, bottom: 0.2, left: 0.2 },
      padding: { top: 4, right: 5, bottom: 4, left: 5 }
    },
    columnStyles: {}
  };
}

function sectionBand(name, y) {
  return rectSchema(name, { x: LEFT, y, width: CONTENT_WIDTH, height: 7, color: BAND });
}

function stamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function agentLabel(agents, agentId) {
  const match = (agents || []).find((agent) => agent.id === agentId);
  return match?.displayName || agentId || "—";
}

function boolJa(value) {
  return value ? "あり" : "なし";
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!value) return "—";
  if (value < 1000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} 秒`;
  return `${Math.floor(value / 60_000)}分 ${Math.round((value % 60_000) / 1000)}秒`;
}

function statusColor(status) {
  return STATUS_COLORS[status] || MUTED;
}

function gradeColor(grade) {
  return GRADE_COLORS[grade] || MUTED;
}

function statusLabel(status) {
  return (
    {
      passed: "PASS 合格",
      failed: "FAIL 不合格",
      review_required: "REVIEW 要確認",
      skipped: "SKIP スキップ",
      cancelled: "CANCEL 中止"
    }[status] || status || "—"
  );
}

function statusShort(status) {
  return (
    {
      passed: "PASS",
      failed: "FAIL",
      review_required: "REVIEW",
      skipped: "SKIP",
      cancelled: "CANCEL"
    }[status] || status || "—"
  );
}

function gradeSymbol(grade) {
  return { A: "A*", B: "B", C: "C", D: "D" }[grade] || "";
}

function formatBusinessGrade(business = {}) {
  if (!business || business.status === "not_configured") return "Biz 未設定";
  if (!business.grade) return "Biz —";
  const symbol = business.symbol && !/[\u{1F300}-\u{1FAFF}]/u.test(business.symbol)
    ? business.symbol
    : gradeSymbol(business.grade);
  // Prefer A/B/C/D + JP mark that embeds reliably in Noto Sans JP.
  const mark = { A: "優", B: "良", C: "可", D: "不可" }[business.grade] || "";
  return `等級 ${business.grade}${mark ? `（${mark}）` : ""} · ${business.score ?? "—"}点`;
}

function systemRequirementRows(testCase = {}) {
  const system = testCase.expectations?.systemRequirements || testCase.expectations || {};
  const rows = [
    ["SQL必須", boolJa(system.requireSql !== false)],
    ["チャート必須", boolJa(Boolean(system.requireChart))],
    ["最大実行時間", system.maxDurationMs ? `${Math.round(Number(system.maxDurationMs) / 1000)} 秒` : "制限なし"],
    ["最大課金", system.maxBytesBilled ? formatBytes(system.maxBytesBilled) : "制限なし"]
  ];
  const phrases = system.requiredPhrases || [];
  if (phrases.length) rows.push(["必須語句", clipText(phrases.join(", "), 70)]);
  const tables = system.requiredSqlTables || [];
  if (tables.length) rows.push(["必須SQLテーブル", clipText(tables.join(", "), 70)]);
  return rows;
}

function businessCriteriaRows(testCase = {}) {
  const business = testCase.expectations?.businessRequirements || {};
  if (business.enabled === false) return [["—", "ビジネス要件: 未設定"]];
  const items = Array.isArray(business.criteriaItems) && business.criteriaItems.length
    ? business.criteriaItems
    : String(business.accuracyCriteria || "")
        .split(/;+/)
        .map((item) => item.trim())
        .filter(Boolean);
  if (!items.length) return [["—", "ビジネス要件: 未設定"]];
  return items.map((item, index) => [String(index + 1), clipText(item, 72)]);
}

function systemCheckRows(evaluation = {}) {
  const checks = evaluation.system?.checks || evaluation.checks || [];
  if (!checks.length) return [["—", "システム要件の判定結果はありません"]];
  const max = 10;
  const rows = checks.slice(0, max).map((check) => [
    check.passed ? "OK" : "NG",
    clipText(check.label || check.id || "check", 58)
  ]);
  if (checks.length > max) {
    rows.push(["…", `他 ${checks.length - max} 件（アプリの実行詳細を参照）`]);
  }
  return rows;
}

function businessResultRows(business = {}) {
  if (!business || business.status === "not_configured") {
    return [["—", "ビジネス要件は未設定です"]];
  }
  const items = Array.isArray(business.itemResults) ? business.itemResults : [];
  if (!items.length) {
    const criteria = Array.isArray(business.criteriaItems) ? business.criteriaItems : [];
    if (!criteria.length) return [["—", clipText(business.summary || "判定結果がありません", 62)]];
    return criteria.map((item, index) => [String(index + 1), clipText(item, 62)]);
  }
  return items.map((item) => {
    const mark =
      item.mark === "sun" || item.symbol === "☀️"
        ? "OK"
        : item.mark === "cloud" || item.symbol === "☁️"
          ? "一部"
          : item.mark === "rain" || item.symbol === "☔️"
            ? "NG"
            : "—";
    return [mark, clipText(String(item.criterion || "").trim() || "—", 48)];
  });
}

function businessReasonLines(business = {}) {
  const items = Array.isArray(business?.itemResults) ? business.itemResults : [];
  if (!items.length) return "—";
  return items
    .map((item, index) => {
      const mark =
        item.mark === "sun" || item.symbol === "☀️"
          ? "OK"
          : item.mark === "cloud" || item.symbol === "☁️"
            ? "一部"
            : item.mark === "rain" || item.symbol === "☔️"
              ? "NG"
              : "•";
      const criterion = clipText(item.criterion || `項目${index + 1}`, 40);
      const reason = clipText(item.reason || "根拠なし", 90);
      return `[${mark}] ${criterion}\n　根拠: ${reason}`;
    })
    .join("\n");
}

function formatSampleTableText(table) {
  if (!table) return "結果テーブル: （取得データなし）";
  if (!table.rows?.length) return `結果テーブル: ${table.name || "result"}（0行）`;
  const headers = table.headers.length ? table.headers : ["—"];
  const rows = table.rows.slice(0, 3);
  return [
    `結果テーブル: ${table.name || "result"}（全${table.totalRows}行 · 先頭${rows.length}行）`,
    headers.join(" | "),
    ...rows.map((row) => row.join(" | "))
  ].join("\n");
}

function formatChartNote(chart, runSummary = {}) {
  const count = chart?.count || Number(runSummary.chartCount || 0);
  if (!count) return "チャート: なし";
  const marks = chart?.marks?.length ? chart.marks.join(", ") : "vega";
  const titles = chart?.titles?.length ? ` · ${chart.titles.join(" / ")}` : "";
  return `チャート: あり（${count}件 · mark: ${marks}${titles}）`;
}

function formatEvidenceBlock(evidence, runSummary = {}) {
  const answer = evidence?.answer ? clipText(evidence.answer, 220) : "（最終回答テキストなし）";
  const table = formatSampleTableText(evidence?.table);
  const chart = formatChartNote(evidence?.chart, runSummary);
  return [`【回答】${answer}`, clipText(table, 300), chart].join("\n");
}

function countByStatus(caseRuns = []) {
  const counts = { passed: 0, failed: 0, review_required: 0, skipped: 0, cancelled: 0 };
  for (const item of caseRuns) {
    const key = counts[item.status] != null ? item.status : "skipped";
    counts[key] += 1;
  }
  return counts;
}

function statusSlices(counts) {
  return [
    { label: "Passed", value: counts.passed, color: GREEN },
    { label: "Failed", value: counts.failed, color: RED },
    { label: "Review", value: counts.review_required, color: AMBER },
    { label: "Blocked", value: counts.skipped + counts.cancelled, color: GRAY }
  ];
}

function gradeSlices(grades = {}) {
  return [
    { label: "A", value: grades.A || 0, color: GREEN },
    { label: "B", value: grades.B || 0, color: BLUE },
    { label: "C", value: grades.C || 0, color: AMBER },
    { label: "D", value: grades.D || 0, color: RED }
  ];
}

function legendLines(slices, total) {
  return slices
    .map((slice) => `■ ${slice.label.padEnd(8, " ")}  ${withCountPct(slice.value, total)}`)
    .join("\n");
}

function caseIndexRows(selected, completed, { limit = 16 } = {}) {
  const rows = selected.slice(0, limit).map((testCase, index) => {
    const caseId = testCase.id || testCase.caseId;
    const item = completed.get(caseId) || {};
    const evaluation = item.evaluation || {};
    const system = evaluation.system || evaluation;
    const business = evaluation.business || {};
    const title = clipText(item.title || testCase.title || caseId || `ケース ${index + 1}`, 34);
    return [
      statusShort(item.status || "—"),
      title,
      system.score == null ? "—" : `${system.score}`,
      business.grade ? String(business.grade) : "—",
      evaluation.score == null ? "—" : `${evaluation.score}`,
      formatDuration(item.runSummary?.durationMs)
    ];
  });
  return rows;
}

function checkSlices(evaluation = {}) {
  const checks = evaluation.system?.checks || evaluation.checks || [];
  const ok = checks.filter((check) => check.passed).length;
  const ng = Math.max(0, checks.length - ok);
  return [
    { label: "Pass", value: ok, color: GREEN },
    { label: "Fail", value: ng, color: RED }
  ];
}

function weatherSlices(business = {}) {
  const items = Array.isArray(business.itemResults) ? business.itemResults : [];
  let sun = 0;
  let cloud = 0;
  let rain = 0;
  for (const item of items) {
    if (item.mark === "sun" || item.symbol === "☀️") sun += 1;
    else if (item.mark === "cloud" || item.symbol === "☁️") cloud += 1;
    else if (item.mark === "rain" || item.symbol === "☔️") rain += 1;
  }
  return [
    { label: "OK", value: sun, color: GREEN },
    { label: "一部", value: cloud, color: AMBER },
    { label: "NG", value: rain, color: RED }
  ];
}

/** Cover: TestRail-like Status & Statistics + case index. */
function suiteRunCoverSchemas(input = {}) {
  return [
    rectSchema("headerBar", { y: 0, height: 18, color: NAVY_DEEP }),
    textSchema("docType", {
      y: 5,
      height: 8,
      fontSize: 9,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("title", { y: 22, height: 10, fontSize: 16, fontName: FONT_NAME_BOLD }),
    textSchema("subtitle", { y: 33, height: 5, fontSize: 8.5, fontColor: MUTED, fontName: FONT_NAME_REGULAR }),
    textSchema("openLink", { y: 39, height: 6, fontSize: 9, fontColor: BLUE, fontName: FONT_NAME_BOLD }),
    lineSchema("rule1", 46),
    sectionBand("bandStatus", 50),
    textSchema("sectionStatus", {
      y: 51,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("heroMetric", {
      x: LEFT,
      y: 60,
      width: 70,
      height: 14,
      fontSize: 22,
      fontName: FONT_NAME_BOLD,
      fontColor: input._heroColor || GREEN
    }),
    textSchema("heroSub", {
      x: LEFT,
      y: 75,
      width: 70,
      height: 14,
      fontSize: 8.5,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    }),
    svgSchema("statusPieSvg", { x: 88, y: 58, width: 42, height: 42 }),
    textSchema("statusLegend", {
      x: 134,
      y: 58,
      width: 64,
      height: 42,
      fontSize: 8,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.35
    }),
    sectionBand("bandGrades", 104),
    textSchema("sectionGrades", {
      y: 105,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    svgSchema("gradeBarSvg", { y: 113, width: CONTENT_WIDTH, height: 8 }),
    textSchema("gradeLegend", {
      y: 123,
      height: 8,
      fontSize: 8,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    }),
    tableSchema("gradeTable", 133, ["等級", "件数", "割合"], [28, 28, 44], { bodySize: 8, headBg: NAVY }),
    sectionBand("bandMetrics", 168),
    textSchema("sectionMetrics", {
      y: 169,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    tableSchema("summaryTable", 177, ["指標", "値"], [38, 62], { bodySize: 8 }),
    sectionBand("bandIndex", 218),
    textSchema("sectionIndex", {
      y: 219,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    tableSchema("caseIndexTable", 227, ["結果", "ケース", "Sys", "Biz", "点", "時間"], [14, 40, 10, 12, 10, 14], {
      bodySize: 7.5,
      headSize: 7.5
    }),
    textSchema("footer", {
      y: 286,
      height: 5,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    })
  ];
}

function formatCheckListText(rows, { markWidth = 4 } = {}) {
  if (!Array.isArray(rows) || !rows.length) return "—";
  return rows
    .map((row) => {
      const mark = String(row[0] ?? "—").padEnd(markWidth, " ");
      const label = String(row[1] ?? "");
      return `${mark}  ${label}`;
    })
    .join("\n");
}

/** Case page 1: overview + system checks as text (avoids table page-split bugs). */
function suiteRunCaseOverviewSchemas(input = {}) {
  const statusTone = input._statusColor || NAVY;
  return [
    rectSchema("headerBar", { y: 0, height: 16, color: NAVY_DEEP }),
    textSchema("docType", {
      y: 4,
      height: 8,
      fontSize: 8.5,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("title", { y: 19, height: 9, fontSize: 13.5, fontName: FONT_NAME_BOLD }),
    rectSchema("statusBand", { x: LEFT, y: 29, width: CONTENT_WIDTH, height: 9, color: statusTone }),
    textSchema("resultBanner", {
      y: 30.5,
      height: 7,
      fontSize: 10,
      fontName: FONT_NAME_BOLD,
      fontColor: WHITE
    }),
    textSchema("caseMeta", { y: 40, height: 5, fontSize: 8, fontColor: MUTED, fontName: FONT_NAME_REGULAR }),
    textSchema("openLink", { y: 45, height: 5, fontSize: 8.5, fontColor: BLUE, fontName: FONT_NAME_BOLD }),
    sectionBand("bandResult", 52),
    textSchema("sectionResult", {
      y: 53,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    // Compact KPI block (text) — fixed height, no auto page-break.
    textSchema("resultBlock", {
      y: 60,
      height: 42,
      fontSize: 8.5,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.35
    }),
    sectionBand("bandSystem", 106),
    textSchema("sectionSystem", {
      y: 107,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    svgSchema("systemPieSvg", { x: LEFT, y: 115, width: 32, height: 32 }),
    textSchema("systemLegend", {
      x: 48,
      y: 117,
      width: 150,
      height: 28,
      fontSize: 8,
      fontName: FONT_NAME_REGULAR
    }),
    textSchema("systemBlock", {
      y: 152,
      height: 118,
      fontSize: 8,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.45
    }),
    textSchema("pageHint", {
      y: 278,
      height: 5,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    }),
    textSchema("footer", {
      y: 286,
      height: 5,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    })
  ];
}

/** Case page 2: business judgment + evidence (text blocks, fixed heights). */
function suiteRunCaseDetailSchemas(input = {}) {
  return [
    rectSchema("headerBar", { y: 0, height: 16, color: NAVY_DEEP }),
    textSchema("docType", {
      y: 4,
      height: 8,
      fontSize: 8.5,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("title", { y: 19, height: 8, fontSize: 12, fontName: FONT_NAME_BOLD }),
    textSchema("caseMeta", { y: 28, height: 5, fontSize: 8, fontColor: MUTED, fontName: FONT_NAME_REGULAR }),
    sectionBand("bandBusiness", 36),
    textSchema("sectionBusiness", {
      y: 37,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("businessHeadline", {
      y: 44,
      height: 6,
      fontSize: 11,
      fontName: FONT_NAME_BOLD,
      fontColor: input._gradeColor || NAVY
    }),
    textSchema("businessSummary", { y: 51, height: 14, fontSize: 8, fontName: FONT_NAME_REGULAR }),
    textSchema("businessBlock", {
      y: 67,
      height: 78,
      fontSize: 8,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.4
    }),
    textSchema("businessReasons", {
      y: 148,
      height: 34,
      fontSize: 7,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.28
    }),
    sectionBand("bandEvidence", 186),
    textSchema("sectionEvidence", {
      y: 187,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("evidenceBlock", {
      y: 194,
      height: 80,
      fontSize: 7.5,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.28
    }),
    textSchema("footer", {
      y: 286,
      height: 5,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    })
  ];
}

/** Case specification: TestRail case-print style. */
function caseSpecSchemas() {
  return [
    rectSchema("headerBar", { y: 0, height: 16, color: NAVY_DEEP }),
    textSchema("docType", {
      y: 4,
      height: 8,
      fontSize: 8.5,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("title", { y: 20, height: 10, fontSize: 15, fontName: FONT_NAME_BOLD }),
    textSchema("suiteLine", { y: 31, height: 5, fontSize: 8.5, fontColor: MUTED, fontName: FONT_NAME_REGULAR }),
    textSchema("openLink", { y: 37, height: 6, fontSize: 9, fontColor: BLUE, fontName: FONT_NAME_BOLD }),
    lineSchema("rule1", 44),
    sectionBand("bandMeta", 48),
    textSchema("sectionMeta", {
      y: 49,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    tableSchema("metaTable", 56, ["項目", "内容"], [28, 72], { bodySize: 8 }),
    sectionBand("bandPrompt", 100),
    textSchema("sectionPrompt", {
      y: 101,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("prompt", { y: 108, height: 28, fontSize: 9, fontName: FONT_NAME_REGULAR }),
    sectionBand("bandSystem", 140),
    textSchema("sectionSystem", {
      y: 141,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    tableSchema("systemTable", 148, ["項目", "設定"], [32, 68], { bodySize: 8 }),
    sectionBand("bandBusiness", 192),
    textSchema("sectionBusiness", {
      y: 193,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    tableSchema("businessTable", 200, ["#", "チェック項目"], [10, 90], { bodySize: 8 }),
    sectionBand("bandMemo", 244),
    textSchema("sectionMemo", {
      y: 245,
      height: 5,
      fontSize: 9,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("memo", { y: 252, height: 22, fontSize: 8.5, fontColor: MUTED, fontName: FONT_NAME_REGULAR }),
    textSchema("footer", {
      y: 286,
      height: 5,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    })
  ];
}

export function buildCaseSpecInputs({ suite, cases, agents = [] } = {}) {
  const generatedAt = stamp();
  return (cases || []).map((testCase, index) => {
    const url = caseEditorUrl(suite.id, testCase.id || `case_${index + 1}`);
    return {
      _pageKind: "spec",
      docType: "PrismTrail  /  Test Case Specification  /  テストケース仕様書",
      title: testCase.title || `ケース ${index + 1}`,
      suiteLine: `スイート: ${suite.name || suite.id}  ·  ${suite.id}`,
      openLink: "▶ PrismTrailでこのケースを開く",
      openLinkUrl: url,
      sectionMeta: "1. ケース情報",
      metaTable: JSON.stringify([
        ["ケースID", testCase.id || "—"],
        ["Data Agent", agentLabel(agents, testCase.agentId || suite.defaultAgentId)],
        ["思考モード", testCase.thinkingMode === "THINKING" ? "THINKING" : "FAST"],
        ["ステータス", testCase.status === "draft" ? "下書き" : "実行可"],
        ["合格ライン", testCase.expectations?.businessRequirements?.passingGrade || "B"],
        ["アプリURL", url]
      ]),
      sectionPrompt: "2. 検証プロンプト（Steps）",
      prompt: clipText(String(testCase.prompt || "（未設定）").trim() || "（未設定）", 520),
      sectionSystem: "3. システム要件",
      systemTable: JSON.stringify(systemRequirementRows(testCase)),
      sectionBusiness: "4. ビジネス要件チェック項目",
      businessTable: JSON.stringify(businessCriteriaRows(testCase)),
      sectionMemo: "5. 参照メモ",
      memo: clipText(String(testCase.memo || "（なし）").trim() || "（なし）", 280),
      footer: `PrismTrail Case Spec  ·  ${generatedAt}  ·  ${index + 1}/${cases.length}`
    };
  });
}

export function isPartialSuiteRun(report = {}, caseIds = null) {
  if (Array.isArray(caseIds) && caseIds.length === 1) return true;
  if (report.partialRun) return true;
  if (Array.isArray(report.selectedCaseIds) && report.selectedCaseIds.length === 1) return true;
  return false;
}

export function buildSuiteRunInputs({ report, caseIds = null, agents = [], runsById = {} } = {}) {
  const generatedAt = stamp();
  const grades = report.summary?.accuracyGrades || { A: 0, B: 0, C: 0, D: 0 };
  const reportUrl = suiteRunReportUrl(report.id);
  const partial = isPartialSuiteRun(report, caseIds);
  const completed = new Map((report.caseRuns || []).map((item) => [item.caseId, item]));
  const suiteCases = report.suiteSnapshot?.cases || report.caseRuns || [];
  const selected = caseIds?.length
    ? suiteCases.filter((item) => caseIds.includes(item.id || item.caseId))
    : suiteCases;

  const statusCounts = countByStatus(
    selected.map((testCase) => completed.get(testCase.id || testCase.caseId)).filter(Boolean)
  );
  const statusTotal =
    statusCounts.passed +
    statusCounts.failed +
    statusCounts.review_required +
    statusCounts.skipped +
    statusCounts.cancelled;
  const evaluated = statusCounts.passed + statusCounts.failed + statusCounts.review_required;
  const passRate = evaluated ? Math.round((statusCounts.passed / evaluated) * 100) : report.summary?.score || 0;
  const statusPie = statusSlices(statusCounts);
  const gradePie = gradeSlices(grades);
  const gradeTotal = (grades.A || 0) + (grades.B || 0) + (grades.C || 0) + (grades.D || 0);

  const cover = {
    _pageKind: "cover",
    docType: "PrismTrail  /  Runs Summary  /  評価実行レポート",
    title: report.suiteName || "評価レポート",
    subtitle: `Suite Run ${report.id}  ·  Suite ${report.suiteId || "—"}`,
    openLink: "▶ PrismTrailでこの評価レポートを開く",
    openLinkUrl: reportUrl,
    sectionStatus: "Status & Statistics（結果分布）",
    heroMetric: `${passRate}% passed`,
    heroSub: `${statusCounts.passed} / ${evaluated || statusTotal || 0} evaluated\n総合スコア ${report.summary?.score ?? "—"}  ·  ${statusLabel(report.status)}`,
    statusPieSvg: buildPieChartSvg(statusPie),
    statusLegend: legendLines(statusPie, statusTotal || 1),
    sectionGrades: "Accuracy Grades（A / B / C / D）",
    gradeBarSvg: buildStackedBarSvg(gradePie),
    gradeLegend: "A 優  ·  B 良  ·  C 可  ·  D 不可",
    gradeTable: JSON.stringify([
      ["A 優", String(grades.A || 0), pct(grades.A || 0, gradeTotal || 1)],
      ["B 良", String(grades.B || 0), pct(grades.B || 0, gradeTotal || 1)],
      ["C 可", String(grades.C || 0), pct(grades.C || 0, gradeTotal || 1)],
      ["D 不可", String(grades.D || 0), pct(grades.D || 0, gradeTotal || 1)]
    ]),
    sectionMetrics: "Run Metrics",
    summaryTable: JSON.stringify([
      ["総合結果", statusLabel(report.status)],
      ["総合スコア", report.summary?.score == null ? "—" : `${report.summary.score}%`],
      ["システム正解率", report.summary?.systemScore == null ? "—" : `${report.summary.systemScore}%`],
      ["ビジネス正解率", report.summary?.businessScore == null ? "未設定" : `${report.summary.businessScore}%`],
      ["合格ケース", `${report.summary?.passed || 0} / ${report.summary?.total || 0}`],
      ["所要時間", formatDuration(report.summary?.totalDurationMs)],
      ["課金対象", formatBytes(report.summary?.totalBytesBilled)],
      ["出力日時", generatedAt]
    ]),
    sectionIndex: "Tests & Results（ケース一覧）",
    caseIndexTable: JSON.stringify(caseIndexRows(selected, completed)),
    footer: `PrismTrail Suite Run Report  ·  ${generatedAt}${
      selected.length > 16 ? `  ·  一覧は先頭16件（全${selected.length}件）` : ""
    }`,
    _heroColor: passRate >= 80 ? GREEN : passRate >= 50 ? AMBER : RED
  };
  const casePages = selected.flatMap((testCase, index) => {
    const caseId = testCase.id || testCase.caseId;
    const item = completed.get(caseId) || testCase;
    const evaluation = item.evaluation || {};
    const system = evaluation.system || evaluation;
    const business = evaluation.business || {};
    const detailUrl = item.runId ? runDetailUrl(item.runId) : reportUrl;
    const run = item.runId ? runsById[item.runId] : null;
    const evidence = run ? buildRunEvidencePreview(run) : null;
    const gradeText = formatBusinessGrade(business);
    const sysSlices = checkSlices(evaluation);
    const sysTotal = sysSlices.reduce((sum, slice) => sum + slice.value, 0) || 1;
    const weather = weatherSlices(business);
    const docType = partial
      ? "PrismTrail  /  Single-case Result  /  個別実行レポート"
      : "PrismTrail  /  Case Result  /  ケース明細";
    const title = item.title || testCase.title || caseId || `ケース ${index + 1}`;
    const caseMeta = `${partial ? "個別実行  ·  " : ""}${caseId || "—"}  ·  Agent: ${agentLabel(agents, testCase.agentId)}`;
    const footerBase = `${partial ? "PrismTrail Single-case Report" : "PrismTrail Suite Run Report"}  ·  ${generatedAt}  ·  ケース ${index + 1}/${selected.length}`;
    const shared = {
      title,
      caseMeta,
      openLinkUrl: detailUrl,
      _statusColor: statusColor(item.status),
      _gradeColor: gradeColor(business.grade)
    };

    const systemRows = systemCheckRows(evaluation);
    const businessRows = businessResultRows(business);
    const resultRows = [
      ["結果", statusLabel(item.status)],
      ["総合スコア", evaluation.score == null ? "—" : `${evaluation.score}点`],
      ["システム", `${statusLabel(system.status)} / ${system.score ?? "—"}点`],
      ["ビジネス", gradeText],
      ["実行時間", formatDuration(item.runSummary?.durationMs)],
      ["課金対象", formatBytes(item.runSummary?.totalBytesBilled)],
      ["SQL / チャート", `${item.runSummary?.sqlCount ?? 0} SQL · ${item.runSummary?.chartCount ?? 0} chart`]
    ];

    const overview = {
      ...shared,
      _pageKind: "case-overview",
      docType,
      resultBanner: `${statusLabel(item.status)}  ·  Score ${evaluation.score ?? "—"}  ·  ${gradeText}`,
      openLink: item.runId ? "▶ PrismTrailでこのケースの実行詳細を開く" : "▶ PrismTrailで評価レポートを開く",
      sectionResult: "Result Summary",
      resultBlock: formatCheckListText(resultRows, { markWidth: 10 }),
      // Keep JSON for tests / debugging consumers.
      resultTable: JSON.stringify(resultRows),
      sectionSystem: "System Requirements",
      systemPieSvg: buildPieChartSvg(sysSlices),
      systemLegend: `${legendLines(sysSlices, sysTotal)}\n${
        weather.some((slice) => slice.value)
          ? `Biz items: ${weather
              .filter((slice) => slice.value)
              .map((slice) => `${slice.label} ${slice.value}`)
              .join(" / ")}`
          : ""
      }`.trim(),
      systemBlock: formatCheckListText(systemRows, { markWidth: 4 }),
      systemTable: JSON.stringify(systemRows),
      pageHint: "続き: Business Requirements / Evidence Preview →",
      footer: `${footerBase}  ·  1/2`
    };

    const detail = {
      ...shared,
      _pageKind: "case-detail",
      docType: `${docType}（続き）`,
      openLink: item.runId ? "▶ PrismTrailでこのケースの実行詳細を開く" : "▶ PrismTrailで評価レポートを開く",
      sectionBusiness: "Business Requirements",
      businessHeadline: gradeText,
      businessSummary: clipText(
        business.summary || (business.status === "not_configured" ? "精度条件は設定されていません。" : ""),
        220
      ),
      businessBlock: formatCheckListText(businessRows, { markWidth: 4 }),
      businessTable: JSON.stringify(businessRows),
      businessReasons: clipText(businessReasonLines(business), 520),
      sectionEvidence: "Evidence Preview（回答 / テーブル / チャート）",
      evidenceBlock: clipText(formatEvidenceBlock(evidence, item.runSummary), 780),
      footer: `${footerBase}  ·  2/2`
    };

    return [overview, detail];
  });

  if (partial || (Array.isArray(caseIds) && caseIds.length === 1)) return casePages;
  return [cover, ...casePages];
}

async function generateWithFont(template, inputs) {
  const font = await loadPdfFontOptions();
  return generate({
    template,
    inputs,
    plugins,
    options: { font }
  });
}

export async function addFirstPageLink(pdfBytes, url, box = OPEN_LINK_BOX) {
  if (!url) return pdfBytes;
  const doc = await PDFDocument.load(pdfBytes);
  const page = doc.getPages()[0];
  if (!page) return pdfBytes;
  const { height } = page.getSize();
  const x = box.xMm * MM_TO_PT;
  const w = box.wMm * MM_TO_PT;
  const h = box.hMm * MM_TO_PT;
  const y = height - box.yMm * MM_TO_PT - h;
  const context = doc.context;
  const actionDict = context.obj({
    Type: PDFName.of("Action"),
    S: PDFName.of("URI"),
    URI: PDFString.of(url)
  });
  const annotDict = context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Link"),
    Rect: [x, y, x + w, y + h],
    Border: [0, 0, 0],
    A: actionDict
  });
  page.node.addAnnot(context.register(annotDict));
  return doc.save({ useObjectStreams: false });
}

async function mergePdfParts(parts) {
  if (parts.length === 1) return parts[0];
  const merged = await PDFDocument.create();
  for (const bytes of parts) {
    const doc = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save({ useObjectStreams: false });
}

async function generateLinkedParts(items) {
  const parts = [];
  for (const item of items) {
    const pdf = await generateWithFont({ basePdf: PAGE, schemas: [item.schemas] }, [item.input]);
    parts.push(await addFirstPageLink(pdf, item.input.openLinkUrl, item.linkBox));
  }
  return mergePdfParts(parts);
}

function schemasForInput(input) {
  if (input._pageKind === "cover") return suiteRunCoverSchemas(input);
  if (input._pageKind === "spec") return caseSpecSchemas();
  if (input._pageKind === "case-detail") return suiteRunCaseDetailSchemas(input);
  if (input._pageKind === "case-overview") return suiteRunCaseOverviewSchemas(input);
  if (input.summaryTable) return suiteRunCoverSchemas(input);
  return suiteRunCaseOverviewSchemas(input);
}

export async function renderCaseSpecPdf({ suite, cases, agents = [] } = {}) {
  const selected = Array.isArray(cases) ? cases : [];
  if (!selected.length) {
    const error = new Error("出力対象のテストケースがありません。");
    error.status = 400;
    throw error;
  }
  const inputs = buildCaseSpecInputs({ suite, cases: selected, agents });
  return generateLinkedParts(
    inputs.map((input) => ({
      input,
      schemas: caseSpecSchemas(),
      linkBox: OPEN_LINK_BOX
    }))
  );
}

export async function renderSuiteRunPdf({ report, caseIds = null, agents = [], runsById = {} } = {}) {
  if (!report) {
    const error = new Error("評価レポートが見つかりません。");
    error.status = 404;
    throw error;
  }
  if (report.status === "running" || report.status === "cancelling") {
    const error = new Error("実行中のレポートはPDF出力できません。完了後に再実行してください。");
    error.status = 409;
    throw error;
  }
  const inputs = buildSuiteRunInputs({ report, caseIds, agents, runsById });
  if (!inputs.length) {
    const error = new Error("出力対象のケースがありません。");
    error.status = 400;
    throw error;
  }
  return generateLinkedParts(
    inputs.map((input) => ({
      input,
      schemas: schemasForInput(input),
      linkBox: input._pageKind === "cover" || input.summaryTable
        ? { xMm: LEFT, yMm: 39, wMm: 150, hMm: 7 }
        : OPEN_LINK_BOX
    }))
  );
}

export function pdfFilename(kind, id) {
  const safe = String(id || "export").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
  if (kind === "case") return `prismtrail-case-${safe}.pdf`;
  if (kind === "cases") return `prismtrail-suite-${safe}-cases.pdf`;
  if (kind === "run-case") return `prismtrail-run-case-${safe}.pdf`;
  return `prismtrail-run-${safe}.pdf`;
}
