import { generate } from "@pdfme/generator";
import { PDFDocument, PDFName, PDFString } from "@pdfme/pdf-lib";
import { line, rectangle, svg, text } from "@pdfme/schemas";
import { buildPieChartSvg, buildStackedBarSvg, pct, withCountPct } from "./pdf-chart.mjs";
import { FONT_NAME, FONT_NAME_BOLD, FONT_NAME_REGULAR, loadPdfFontOptions } from "./pdf-font.mjs";
import { buildRunEvidencePreview, clipText } from "./run-preview.mjs";

export const APP_BASE_URL = process.env.PRISMTRAIL_APP_BASE_URL || "http://127.0.0.1:4318";

/** Print-safe report palette. Color is reserved for hierarchy and result state. */
const NAVY = "#173B5E";
const NAVY_DEEP = "#102A43";
const BLUE = "#2563A8";
const BLUE_SOFT = "#EAF2FA";
const MUTED = "#5E7184";
const LINE = "#D8E1EA";
const BAND = "#EDF3F8";
const SURFACE = "#F7F9FC";
const GREEN = "#18864B";
const GREEN_SOFT = "#E8F5ED";
const RED = "#C83C35";
const RED_SOFT = "#FCECEA";
const AMBER = "#C77700";
const AMBER_SOFT = "#FFF4DB";
const GRAY = "#7B8794";
const WHITE = "#ffffff";

const PAGE = { width: 210, height: 297, padding: [12, 12, 14, 12] };
const CONTENT_WIDTH = 186;
const LEFT = 12;
const MM_TO_PT = 72 / 25.4;
const OPEN_LINK_BOX = { xMm: LEFT, yMm: 44, wMm: 160, hMm: 7 };

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

function rectSchema(
  name,
  { x = 0, y, width = 210, height, color, borderColor = color, borderWidth = 0, radius = 0 }
) {
  return {
    name,
    type: "rectangle",
    position: { x, y },
    width,
    height,
    rotate: 0,
    opacity: 1,
    borderWidth,
    borderColor,
    color,
    readOnly: true,
    radius
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

function sectionHeadingSchemas(name, y, { titleName = name, width = CONTENT_WIDTH } = {}) {
  return [
    rectSchema(`${name}Rule`, { x: LEFT, y, width: 2, height: 7, color: BLUE }),
    textSchema(titleName, {
      x: LEFT + 5,
      y: y + 0.2,
      width: width - 5,
      height: 6,
      fontSize: 9,
      fontName: FONT_NAME_BOLD,
      fontColor: NAVY
    })
  ];
}

function pageHeaderSchemas({ compact = false } = {}) {
  return [
    rectSchema("topRule", { y: 0, height: 3, color: BLUE }),
    textSchema("brand", {
      y: 8,
      width: 90,
      height: 6,
      fontSize: 9,
      fontName: FONT_NAME_BOLD,
      fontColor: NAVY
    }),
    textSchema("docType", {
      x: 102,
      y: 8,
      width: 96,
      height: 6,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR,
      align: "right"
    }),
    textSchema("title", {
      y: compact ? 20 : 21,
      height: compact ? 12 : 13,
      fontSize: compact ? 11.5 : 16,
      fontName: FONT_NAME_BOLD,
      fontColor: NAVY_DEEP
    }),
    textSchema("subtitle", {
      y: compact ? 32 : 37,
      height: 5,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    }),
    textSchema("openLink", {
      y: compact ? 39 : 44,
      height: 6,
      fontSize: 8,
      fontColor: BLUE,
      fontName: FONT_NAME_BOLD
    }),
    lineSchema("headerDivider", compact ? 48 : 53)
  ];
}

function pageFooterSchemas() {
  return [
    lineSchema("footerDivider", 282),
    textSchema("footer", {
      y: 285,
      width: 142,
      height: 5,
      fontSize: 7,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    }),
    textSchema("pageLabel", {
      x: 145,
      y: 285,
      width: 53,
      height: 5,
      fontSize: 7,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR,
      align: "right"
    })
  ];
}

function metricCardSchemas(name, { x, y, width, tone = NAVY }) {
  return [
    rectSchema(`${name}Card`, {
      x,
      y,
      width,
      height: 27,
      color: SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    rectSchema(`${name}Accent`, { x, y, width: 2, height: 27, color: tone }),
    textSchema(`${name}Label`, {
      x: x + 6,
      y: y + 4,
      width: width - 10,
      height: 5,
      fontSize: 7,
      fontColor: MUTED,
      fontName: FONT_NAME_BOLD
    }),
    textSchema(`${name}Value`, {
      x: x + 6,
      y: y + 10,
      width: width - 10,
      height: 9,
      fontSize: 15,
      fontColor: tone,
      fontName: FONT_NAME_BOLD
    }),
    textSchema(`${name}Note`, {
      x: x + 6,
      y: y + 20,
      width: width - 10,
      height: 4,
      fontSize: 6.5,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    })
  ];
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

/** Executive cover: one stable A4 page, independent of case count. */
function suiteRunCoverSchemas(input = {}) {
  const heroTone = input._heroColor || GREEN;
  return [
    ...pageHeaderSchemas(),
    rectSchema("gateCard", {
      x: LEFT,
      y: 59,
      width: CONTENT_WIDTH,
      height: 30,
      color: input._gateSurface || SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    rectSchema("gateAccent", { x: LEFT, y: 59, width: 3, height: 30, color: heroTone }),
    textSchema("gateEyebrow", {
      x: 20,
      y: 64,
      width: 70,
      height: 5,
      fontSize: 7,
      fontColor: MUTED,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("gateDecision", {
      x: 20,
      y: 70,
      width: 170,
      height: 8,
      fontSize: 13,
      fontColor: heroTone,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("gateSummary", {
      x: 20,
      y: 80,
      width: 170,
      height: 5,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    }),
    ...metricCardSchemas("passRate", { x: 12, y: 96, width: 43.5, tone: heroTone }),
    ...metricCardSchemas("overallScore", { x: 59.5, y: 96, width: 43.5, tone: NAVY }),
    ...metricCardSchemas("systemScore", { x: 107, y: 96, width: 43.5, tone: BLUE }),
    ...metricCardSchemas("businessScore", { x: 154.5, y: 96, width: 43.5, tone: AMBER }),
    ...sectionHeadingSchemas("sectionDistribution", 132, { titleName: "sectionDistribution" }),
    rectSchema("statusCard", {
      x: 12,
      y: 143,
      width: 90,
      height: 57,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("statusCardTitle", {
      x: 18,
      y: 149,
      width: 40,
      height: 5,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_BOLD
    }),
    svgSchema("statusPieSvg", { x: 18, y: 157, width: 34, height: 34 }),
    textSchema("statusLegend", {
      x: 57,
      y: 157,
      width: 40,
      height: 35,
      fontSize: 7.2,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.4
    }),
    rectSchema("gradeCard", {
      x: 108,
      y: 143,
      width: 90,
      height: 57,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("gradeCardTitle", {
      x: 114,
      y: 149,
      width: 78,
      height: 5,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_BOLD
    }),
    svgSchema("gradeBarSvg", { x: 114, y: 160, width: 78, height: 6 }),
    textSchema("gradeLegend", {
      x: 114,
      y: 171,
      width: 78,
      height: 7,
      fontSize: 7,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    }),
    textSchema("gradeCounts", {
      x: 114,
      y: 182,
      width: 78,
      height: 8,
      fontSize: 8,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    ...sectionHeadingSchemas("sectionFindings", 210, { titleName: "sectionFindings" }),
    rectSchema("findingsCard", {
      x: LEFT,
      y: 221,
      width: CONTENT_WIDTH,
      height: 48,
      color: SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("executiveSummary", {
      x: 18,
      y: 227,
      width: 174,
      height: 35,
      fontSize: 8.2,
      fontColor: NAVY_DEEP,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.5
    }),
    ...pageFooterSchemas()
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

function suiteRunIndexSchemas(input = {}) {
  const schemas = [
    ...pageHeaderSchemas(),
    rectSchema("indexSummaryCard", {
      x: LEFT,
      y: 58,
      width: CONTENT_WIDTH,
      height: 20,
      color: SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("indexSummary", {
      x: 18,
      y: 64,
      width: 174,
      height: 7,
      fontSize: 8,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    rectSchema("indexHead", { x: LEFT, y: 84, width: CONTENT_WIDTH, height: 9, color: NAVY }),
    textSchema("indexHeadResult", {
      x: 17,
      y: 86.2,
      width: 20,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("indexHeadCase", {
      x: 40,
      y: 86.2,
      width: 86,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("indexHeadMetrics", {
      x: 129,
      y: 86.2,
      width: 64,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD,
      align: "right"
    })
  ];

  for (let index = 0; index < (input._caseRows || []).length; index += 1) {
    const row = input._caseRows[index];
    const y = 93 + index * 20;
    const tone = row.color || GRAY;
    schemas.push(
      rectSchema(`indexRowBg${index}`, {
        x: LEFT,
        y,
        width: CONTENT_WIDTH,
        height: 19,
        color: index % 2 ? WHITE : SURFACE,
        borderColor: LINE,
        borderWidth: 0.2
      }),
      rectSchema(`indexRowAccent${index}`, { x: LEFT, y, width: 2, height: 19, color: tone }),
      textSchema(`indexRowStatus${index}`, {
        x: 17,
        y: y + 5,
        width: 20,
        height: 5,
        fontSize: 7.5,
        fontColor: tone,
        fontName: FONT_NAME_BOLD
      }),
      textSchema(`indexRowTitle${index}`, {
        x: 40,
        y: y + 3,
        width: 83,
        height: 6,
        fontSize: 8,
        fontColor: NAVY_DEEP,
        fontName: FONT_NAME_BOLD
      }),
      textSchema(`indexRowId${index}`, {
        x: 40,
        y: y + 11,
        width: 83,
        height: 4,
        fontSize: 6.5,
        fontColor: MUTED,
        fontName: FONT_NAME_REGULAR
      }),
      textSchema(`indexRowSystem${index}`, {
        x: 127,
        y: y + 4,
        width: 16,
        height: 5,
        fontSize: 7.5,
        fontColor: NAVY,
        fontName: FONT_NAME_BOLD,
        align: "right"
      }),
      textSchema(`indexRowBusiness${index}`, {
        x: 146,
        y: y + 4,
        width: 14,
        height: 5,
        fontSize: 7.5,
        fontColor: NAVY,
        fontName: FONT_NAME_BOLD,
        align: "right"
      }),
      textSchema(`indexRowScore${index}`, {
        x: 163,
        y: y + 4,
        width: 13,
        height: 5,
        fontSize: 7.5,
        fontColor: tone,
        fontName: FONT_NAME_BOLD,
        align: "right"
      }),
      textSchema(`indexRowDuration${index}`, {
        x: 178,
        y: y + 4,
        width: 15,
        height: 5,
        fontSize: 6.5,
        fontColor: MUTED,
        fontName: FONT_NAME_REGULAR,
        align: "right"
      })
    );
  }
  schemas.push(...pageFooterSchemas());
  return schemas;
}

/** Case result overview. Stable card grid; no renderer-driven page break. */
function suiteRunCaseOverviewSchemas(input = {}) {
  const statusTone = input._statusColor || NAVY;
  return [
    ...pageHeaderSchemas({ compact: true }),
    rectSchema("statusCard", {
      x: LEFT,
      y: 56,
      width: CONTENT_WIDTH,
      height: 24,
      color: input._statusSurface || SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    rectSchema("statusAccent", { x: LEFT, y: 56, width: 3, height: 24, color: statusTone }),
    textSchema("resultBanner", {
      x: 20,
      y: 62,
      width: 68,
      height: 7,
      fontSize: 11,
      fontName: FONT_NAME_BOLD,
      fontColor: statusTone
    }),
    textSchema("resultSummary", {
      x: 91,
      y: 62,
      width: 99,
      height: 9,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR,
      align: "right"
    }),
    ...metricCardSchemas("caseOverall", { x: 12, y: 87, width: 43.5, tone: statusTone }),
    ...metricCardSchemas("caseSystem", { x: 59.5, y: 87, width: 43.5, tone: BLUE }),
    ...metricCardSchemas("caseBusiness", {
      x: 107,
      y: 87,
      width: 43.5,
      tone: input._gradeColor || AMBER
    }),
    ...metricCardSchemas("caseDuration", { x: 154.5, y: 87, width: 43.5, tone: NAVY }),
    ...sectionHeadingSchemas("sectionSystem", 123, { titleName: "sectionSystem" }),
    rectSchema("systemChartCard", {
      x: LEFT,
      y: 134,
      width: CONTENT_WIDTH,
      height: 50,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    svgSchema("systemPieSvg", { x: 18, y: 142, width: 34, height: 34 }),
    textSchema("systemLegend", {
      x: 59,
      y: 144,
      width: 132,
      height: 28,
      fontSize: 8,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.45
    }),
    ...sectionHeadingSchemas("sectionChecks", 193, { titleName: "sectionChecks" }),
    rectSchema("systemChecksCard", {
      x: LEFT,
      y: 204,
      width: CONTENT_WIDTH,
      height: 64,
      color: SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("systemBlock", {
      x: 18,
      y: 211,
      width: 174,
      height: 49,
      fontSize: 8.2,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.5
    }),
    ...pageFooterSchemas()
  ];
}

/** Case result detail: business decision plus compact evidence. */
function suiteRunCaseDetailSchemas(input = {}) {
  const schemas = [
    ...pageHeaderSchemas({ compact: true }),
    rectSchema("businessVerdictCard", {
      x: LEFT,
      y: 56,
      width: CONTENT_WIDTH,
      height: 31,
      color: input._gradeSurface || SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    rectSchema("businessVerdictAccent", {
      x: LEFT,
      y: 56,
      width: 3,
      height: 31,
      color: input._gradeColor || GRAY
    }),
    textSchema("businessHeadline", {
      x: 20,
      y: 62,
      width: 65,
      height: 7,
      fontSize: 12,
      fontName: FONT_NAME_BOLD,
      fontColor: input._gradeColor || NAVY
    }),
    textSchema("businessSummary", {
      x: 88,
      y: 61,
      width: 102,
      height: 16,
      fontSize: 7.8,
      fontColor: NAVY,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.4
    }),
    ...sectionHeadingSchemas("sectionBusiness", 96, { titleName: "sectionBusiness" }),
    rectSchema("businessItemsCard", {
      x: LEFT,
      y: 107,
      width: CONTENT_WIDTH,
      height: 86,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    ...sectionHeadingSchemas("sectionEvidence", 202, { titleName: "sectionEvidence" }),
    rectSchema("evidenceCard", {
      x: LEFT,
      y: 213,
      width: CONTENT_WIDTH,
      height: 55,
      color: SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("evidenceBlock", {
      x: 18,
      y: 220,
      width: 174,
      height: 42,
      fontSize: 7.5,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.4
    }),
    ...pageFooterSchemas()
  ];
  for (let index = 0; index < (input._businessItems || []).length; index += 1) {
    const item = input._businessItems[index];
    const y = 111 + index * 20;
    schemas.push(
      rectSchema(`businessItemAccent${index}`, {
        x: 18,
        y,
        width: 2,
        height: 16,
        color: item.color || GRAY
      }),
      textSchema(`businessItemMark${index}`, {
        x: 23,
        y: y + 1,
        width: 20,
        height: 5,
        fontSize: 7,
        fontColor: item.color || GRAY,
        fontName: FONT_NAME_BOLD
      }),
      textSchema(`businessItemCriterion${index}`, {
        x: 44,
        y: y + 1,
        width: 145,
        height: 5,
        fontSize: 7.5,
        fontColor: NAVY_DEEP,
        fontName: FONT_NAME_BOLD
      }),
      textSchema(`businessItemReason${index}`, {
        x: 23,
        y: y + 8,
        width: 166,
        height: 6,
        fontSize: 6.8,
        fontColor: MUTED,
        fontName: FONT_NAME_REGULAR
      })
    );
  }
  if (!(input._businessItems || []).length) {
    schemas.push(
      textSchema("businessEmpty", {
        x: 18,
        y: 118,
        width: 174,
        height: 14,
        fontSize: 8,
        fontColor: MUTED,
        fontName: FONT_NAME_REGULAR
      })
    );
  }
  return schemas;
}

/** Case specification: one deliberately composed page per case. */
function caseSpecSchemas() {
  return [
    ...pageHeaderSchemas({ compact: true }),
    rectSchema("metaCard", {
      x: LEFT,
      y: 56,
      width: CONTENT_WIDTH,
      height: 29,
      color: SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("metaPrimary", {
      x: 18,
      y: 62,
      width: 82,
      height: 14,
      fontSize: 8,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD,
      lineHeight: 1.5
    }),
    textSchema("metaSecondary", {
      x: 105,
      y: 62,
      width: 87,
      height: 14,
      fontSize: 8,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD,
      lineHeight: 1.5
    }),
    ...sectionHeadingSchemas("sectionPrompt", 94, { titleName: "sectionPrompt" }),
    rectSchema("promptCard", {
      x: LEFT,
      y: 105,
      width: CONTENT_WIDTH,
      height: 37,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("prompt", {
      x: 18,
      y: 112,
      width: 174,
      height: 24,
      fontSize: 8.5,
      fontColor: NAVY_DEEP,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.45
    }),
    ...sectionHeadingSchemas("sectionSystem", 151, { titleName: "sectionSystem" }),
    rectSchema("systemCard", {
      x: LEFT,
      y: 162,
      width: CONTENT_WIDTH,
      height: 39,
      color: SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("systemBlock", {
      x: 18,
      y: 169,
      width: 174,
      height: 26,
      fontSize: 7.8,
      fontColor: NAVY,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.45
    }),
    ...sectionHeadingSchemas("sectionBusiness", 210, { titleName: "sectionBusiness" }),
    rectSchema("businessCard", {
      x: LEFT,
      y: 221,
      width: CONTENT_WIDTH,
      height: 39,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("businessBlock", {
      x: 18,
      y: 228,
      width: 174,
      height: 26,
      fontSize: 7.8,
      fontColor: NAVY_DEEP,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.45
    }),
    textSchema("memo", {
      x: 12,
      y: 266,
      width: 186,
      height: 10,
      fontSize: 7,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    }),
    ...pageFooterSchemas()
  ];
}

export function buildCaseSpecInputs({ suite, cases, agents = [] } = {}) {
  const generatedAt = stamp();
  const inputs = (cases || []).flatMap((testCase, index) => {
    const url = caseEditorUrl(suite.id, testCase.id || `case_${index + 1}`);
    const agent = agentLabel(agents, testCase.agentId || suite.defaultAgentId);
    const status = testCase.status === "draft" ? "下書き" : "実行可";
    const passingGrade = testCase.expectations?.businessRequirements?.passingGrade || "B";
    const systemRows = systemRequirementRows(testCase);
    const businessRows = businessCriteriaRows(testCase);
    const criteriaPages = chunks(businessRows, 5);
    if (!criteriaPages.length) criteriaPages.push([]);
    return criteriaPages.map((criteriaRows, criteriaPageIndex) => ({
        _pageKind: "spec",
        brand: "PrismTrail  |  QUALITY REPORT",
        docType: "TEST CASE SPECIFICATION",
        title: clipText(testCase.title || `ケース ${index + 1}`, 54),
        subtitle: `${suite.name || suite.id}  /  ${testCase.id || "—"}`,
        openLink: "▶ PrismTrailでこのケースを開く",
        openLinkUrl: url,
        metaPrimary: `CASE ID\n${testCase.id || "—"}\n\nDATA AGENT\n${agent}`,
        metaSecondary: `EXECUTION\n${testCase.thinkingMode === "THINKING" ? "THINKING" : "FAST"}  ·  ${status}\n\nACCEPTANCE\nBusiness Grade ${passingGrade} 以上`,
        sectionMeta: "Case information",
        metaTable: JSON.stringify([
          ["ケースID", testCase.id || "—"],
          ["Data Agent", agent],
          ["思考モード", testCase.thinkingMode === "THINKING" ? "THINKING" : "FAST"],
          ["ステータス", status],
          ["合格ライン", passingGrade],
          ["アプリURL", url]
        ]),
        sectionPrompt: "TEST OBJECTIVE / PROMPT",
        prompt: clipText(String(testCase.prompt || "（未設定）").trim() || "（未設定）", 360),
        sectionSystem: "SYSTEM REQUIREMENTS",
        systemBlock: formatCheckListText(systemRows, { markWidth: 12 }),
        systemTable: JSON.stringify(systemRows),
        sectionBusiness: `BUSINESS ACCEPTANCE CRITERIA${
          criteriaPages.length > 1 ? `  ${criteriaPageIndex + 1} / ${criteriaPages.length}` : ""
        }`,
        businessBlock: criteriaRows
          .map((row) => `${String(row[0]).padStart(2, "0")}  ${row[1]}`)
          .join("\n"),
        businessTable: JSON.stringify(businessRows),
        memo: `NOTE  ${clipText(String(testCase.memo || "なし").trim() || "なし", 180)}`,
        footer: `Generated ${generatedAt}  ·  ${suite.id || "—"}`,
        pageLabel: ""
      }));
  });
  inputs.forEach((input, pageIndex) => {
    input.pageLabel = `${pageIndex + 1} / ${inputs.length}`;
  });
  return inputs;
}

export function isPartialSuiteRun(report = {}, caseIds = null) {
  if (Array.isArray(caseIds) && caseIds.length === 1) return true;
  if (report.partialRun) return true;
  if (Array.isArray(report.selectedCaseIds) && report.selectedCaseIds.length === 1) return true;
  return false;
}

function statusSurface(status) {
  if (status === "passed") return GREEN_SOFT;
  if (status === "failed") return RED_SOFT;
  if (status === "review_required") return AMBER_SOFT;
  return SURFACE;
}

function gradeSurface(grade) {
  if (grade === "A") return GREEN_SOFT;
  if (grade === "C" || grade === "D") return AMBER_SOFT;
  return BLUE_SOFT;
}

function reportDecision(status, passRate, counts) {
  if (status === "passed" && passRate >= 80 && !counts.review_required) {
    return "GO - 品質ゲートを通過";
  }
  if (counts.failed > 0) return "NO-GO - 不合格ケースの是正が必要";
  if (counts.review_required > 0) return "HOLD - 人によるレビューが必要";
  if (passRate < 80) return "HOLD - 合格率が基準未達";
  return "REVIEW - 判定内容を確認";
}

function executiveFindings({ counts, passRate, report }) {
  const findings = [
    `・評価対象 ${counts.passed + counts.failed + counts.review_required}件のうち、合格 ${counts.passed}件、不合格 ${counts.failed}件、要確認 ${counts.review_required}件です。`,
    `・合格率は ${passRate}%、総合スコアは ${report.summary?.score ?? "—"}点（System ${report.summary?.systemScore ?? "—"} / Business ${report.summary?.businessScore ?? "—"}）です。`
  ];
  if (counts.failed) findings.push("・不合格ケースをケース明細で確認し、期待値・SQL・回答根拠を是正してから再実行してください。");
  else if (counts.review_required) findings.push("・要確認ケースのビジネス判定と根拠を人がレビューしてからリリース判断を確定してください。");
  else findings.push("・重大な阻害要因は検出されていません。次の品質ゲートへ進めます。");
  if (counts.skipped || counts.cancelled) {
    findings.push(`・未評価 ${counts.skipped + counts.cancelled}件（スキップ／中止）は合格率の分母に含まれていません。`);
  }
  return findings.join("\n");
}

function buildCaseIndexItems(selected, completed) {
  return selected.map((testCase, index) => {
    const caseId = testCase.id || testCase.caseId;
    const item = completed.get(caseId) || {};
    const evaluation = item.evaluation || {};
    const system = evaluation.system || evaluation;
    const business = evaluation.business || {};
    return {
      status: item.status || "skipped",
      color: statusColor(item.status),
      title: clipText(item.title || testCase.title || `ケース ${index + 1}`, 38),
      caseId: clipText(caseId || "—", 44),
      system: system.score == null ? "—" : `${system.score}`,
      business: business.grade || "—",
      score: evaluation.score == null ? "—" : `${evaluation.score}`,
      duration: formatDuration(item.runSummary?.durationMs)
    };
  });
}

function chunks(items, size) {
  const pages = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

function populateIndexRowFields(input) {
  for (let index = 0; index < input._caseRows.length; index += 1) {
    const row = input._caseRows[index];
    input[`indexRowStatus${index}`] = statusShort(row.status);
    input[`indexRowTitle${index}`] = row.title;
    input[`indexRowId${index}`] = row.caseId;
    input[`indexRowSystem${index}`] = `Sys ${row.system}`;
    input[`indexRowBusiness${index}`] = `Biz ${row.business}`;
    input[`indexRowScore${index}`] = row.score;
    input[`indexRowDuration${index}`] = row.duration;
  }
  return input;
}

function businessItemDisplay(item = {}) {
  const mark = item.mark || item.symbol;
  if (mark === "sun" || mark === "☀️") return { label: "PASS", color: GREEN };
  if (mark === "cloud" || mark === "☁️") return { label: "PARTIAL", color: AMBER };
  if (mark === "rain" || mark === "☔️") return { label: "FAIL", color: RED };
  return { label: "REVIEW", color: GRAY };
}

function populateBusinessItemFields(input) {
  for (let index = 0; index < input._businessItems.length; index += 1) {
    const item = input._businessItems[index];
    input[`businessItemMark${index}`] = item.label;
    input[`businessItemCriterion${index}`] = item.criterion;
    input[`businessItemReason${index}`] = item.reason;
  }
  if (!input._businessItems.length) {
    input.businessEmpty = input.businessEmpty || "評価基準または判定結果はありません。";
  }
  return input;
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
  const heroColor = passRate >= 80 && !statusCounts.failed
    ? GREEN
    : statusCounts.failed
      ? RED
      : AMBER;

  const cover = {
    _pageKind: "cover",
    brand: "PrismTrail  |  QUALITY REPORT",
    docType: "EXECUTIVE TEST SUMMARY",
    title: clipText(report.suiteName || "評価実行レポート", 52),
    subtitle: `RUN ${report.id}  /  SUITE ${report.suiteId || "—"}  /  ${generatedAt}`,
    openLink: "▶ PrismTrailでこの評価レポートを開く",
    openLinkUrl: reportUrl,
    gateEyebrow: "QUALITY GATE DECISION",
    gateDecision: reportDecision(report.status, passRate, statusCounts),
    gateSummary: `${statusLabel(report.status)}  ·  ${formatDuration(report.summary?.totalDurationMs)}  ·  ${formatBytes(report.summary?.totalBytesBilled)}`,
    passRateLabel: "PASS RATE",
    passRateValue: `${passRate}%`,
    passRateNote: `${statusCounts.passed} of ${evaluated || statusTotal || 0} evaluated`,
    overallScoreLabel: "OVERALL SCORE",
    overallScoreValue: report.summary?.score == null ? "—" : `${report.summary.score}`,
    overallScoreNote: "weighted quality score",
    systemScoreLabel: "SYSTEM",
    systemScoreValue: report.summary?.systemScore == null ? "—" : `${report.summary.systemScore}`,
    systemScoreNote: "deterministic checks",
    businessScoreLabel: "BUSINESS",
    businessScoreValue: report.summary?.businessScore == null ? "—" : `${report.summary.businessScore}`,
    businessScoreNote: "acceptance criteria",
    sectionDistribution: "RESULT DISTRIBUTION",
    statusCardTitle: "EXECUTION STATUS",
    heroMetric: `${passRate}% passed`,
    heroSub: `${statusCounts.passed} / ${evaluated || statusTotal || 0} evaluated\n総合スコア ${report.summary?.score ?? "—"}  ·  ${statusLabel(report.status)}`,
    statusPieSvg: buildPieChartSvg(statusPie),
    statusLegend: [
      `PASS     ${withCountPct(statusCounts.passed, statusTotal || 1)}`,
      `FAIL     ${withCountPct(statusCounts.failed, statusTotal || 1)}`,
      `REVIEW   ${withCountPct(statusCounts.review_required, statusTotal || 1)}`,
      `OTHER    ${withCountPct(statusCounts.skipped + statusCounts.cancelled, statusTotal || 1)}`
    ].join("\n"),
    gradeCardTitle: "BUSINESS ACCURACY GRADES",
    gradeBarSvg: buildStackedBarSvg(gradePie),
    gradeLegend: "A 優  ·  B 良  ·  C 可  ·  D 不可",
    gradeCounts: `A ${grades.A || 0}   B ${grades.B || 0}   C ${grades.C || 0}   D ${grades.D || 0}`,
    gradeTable: JSON.stringify([
      ["A 優", String(grades.A || 0), pct(grades.A || 0, gradeTotal || 1)],
      ["B 良", String(grades.B || 0), pct(grades.B || 0, gradeTotal || 1)],
      ["C 可", String(grades.C || 0), pct(grades.C || 0, gradeTotal || 1)],
      ["D 不可", String(grades.D || 0), pct(grades.D || 0, gradeTotal || 1)]
    ]),
    sectionFindings: "EXECUTIVE FINDINGS / NEXT ACTION",
    executiveSummary: executiveFindings({ counts: statusCounts, passRate, report }),
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
    caseIndexTable: JSON.stringify(caseIndexRows(selected, completed)),
    footer: `Generated ${generatedAt}  ·  ${report.id}`,
    pageLabel: "1",
    _heroColor: heroColor,
    _gateSurface: statusCounts.failed ? RED_SOFT : statusCounts.review_required ? AMBER_SOFT : GREEN_SOFT
  };
  const indexItems = buildCaseIndexItems(selected, completed);
  const indexChunks = chunks(indexItems, 9);
  const indexPages = indexChunks.map((rows, pageIndex) =>
    populateIndexRowFields({
      _pageKind: "index",
      _caseRows: rows,
      brand: "PrismTrail  |  QUALITY REPORT",
      docType: "TESTS & RESULTS",
      title: "Tests & Results",
      subtitle: `${report.suiteName || report.suiteId || "—"}  /  ${pageIndex + 1} of ${indexChunks.length}`,
      openLink: "▶ PrismTrailで評価レポートを開く",
      openLinkUrl: reportUrl,
      indexSummary: `ALL ${statusTotal}  ·  PASS ${statusCounts.passed}  ·  FAIL ${statusCounts.failed}  ·  REVIEW ${statusCounts.review_required}  ·  SKIP/CANCEL ${statusCounts.skipped + statusCounts.cancelled}`,
      indexHeadResult: "RESULT",
      indexHeadCase: "TEST CASE",
      indexHeadMetrics: "SYSTEM   BUSINESS   SCORE   TIME",
      caseIndexTable: JSON.stringify(
        caseIndexRows(
          selected.slice(pageIndex * 9, pageIndex * 9 + rows.length),
          completed,
          { limit: 9 }
        )
      ),
      footer: `Generated ${generatedAt}  ·  ${report.id}`,
      pageLabel: ""
    })
  );
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
    const docType = partial ? "SINGLE-CASE TEST RESULT" : "TEST CASE RESULT";
    const title = clipText(item.title || testCase.title || caseId || `ケース ${index + 1}`, 54);
    const caseMeta = `${caseId || "—"}  /  AGENT ${agentLabel(agents, testCase.agentId)}`;
    const footerBase = `Generated ${generatedAt}  ·  ${report.id}`;
    const shared = {
      brand: "PrismTrail  |  QUALITY REPORT",
      docType,
      title,
      subtitle: caseMeta,
      openLinkUrl: detailUrl,
      _statusColor: statusColor(item.status),
      _statusSurface: statusSurface(item.status),
      _gradeColor: gradeColor(business.grade),
      _gradeSurface: gradeSurface(business.grade)
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
      resultBanner: statusLabel(item.status),
      resultSummary: `Score ${evaluation.score ?? "—"}  ·  ${gradeText}  ·  ${item.runSummary?.sqlCount ?? 0} SQL / ${item.runSummary?.chartCount ?? 0} chart`,
      openLink: item.runId ? "▶ PrismTrailでこのケースの実行詳細を開く" : "▶ PrismTrailで評価レポートを開く",
      caseOverallLabel: "OVERALL",
      caseOverallValue: evaluation.score == null ? "—" : `${evaluation.score}`,
      caseOverallNote: statusShort(item.status),
      caseSystemLabel: "SYSTEM",
      caseSystemValue: system.score == null ? "—" : `${system.score}`,
      caseSystemNote: statusShort(system.status),
      caseBusinessLabel: "BUSINESS",
      caseBusinessValue: business.grade || "—",
      caseBusinessNote: business.score == null ? "not scored" : `${business.score} points`,
      caseDurationLabel: "DURATION",
      caseDurationValue: formatDuration(item.runSummary?.durationMs),
      caseDurationNote: formatBytes(item.runSummary?.totalBytesBilled),
      resultBlock: formatCheckListText(resultRows, { markWidth: 10 }),
      // Keep JSON for tests / debugging consumers.
      resultTable: JSON.stringify(resultRows),
      sectionSystem: "SYSTEM REQUIREMENT OUTCOME",
      systemPieSvg: buildPieChartSvg(sysSlices),
      systemLegend: `${legendLines(sysSlices, sysTotal)}\n\n${
        weather.some((slice) => slice.value)
          ? `Business criteria: ${weather
              .filter((slice) => slice.value)
              .map((slice) => `${slice.label} ${slice.value}`)
              .join(" / ")}`
          : ""
      }`.trim(),
      sectionChecks: "DETERMINISTIC CHECKS",
      systemBlock: formatCheckListText(systemRows, { markWidth: 4 }),
      systemTable: JSON.stringify(systemRows),
      footer: footerBase,
      pageLabel: ""
    };

    const businessItems = (Array.isArray(business.itemResults) ? business.itemResults : []).map(
      (entry) => {
        const display = businessItemDisplay(entry);
        return {
          ...display,
          criterion: clipText(entry.criterion || "評価基準", 72),
          reason: clipText(entry.reason || "根拠は記録されていません。", 120)
        };
      }
    );
    const businessPages = chunks(businessItems, 4);
    if (!businessPages.length) businessPages.push([]);
    const detailPages = businessPages.map((pageItems, businessPageIndex) => {
      const lastBusinessPage = businessPageIndex === businessPages.length - 1;
      return populateBusinessItemFields({
        ...shared,
        _pageKind: "case-detail",
        _businessItems: pageItems,
        docType: `${docType} / BUSINESS & EVIDENCE`,
        openLink: item.runId
          ? "▶ PrismTrailでこのケースの実行詳細を開く"
          : "▶ PrismTrailで評価レポートを開く",
        sectionBusiness: `BUSINESS ACCEPTANCE CRITERIA${
          businessPages.length > 1 ? `  ${businessPageIndex + 1} / ${businessPages.length}` : ""
        }`,
        businessHeadline: gradeText,
        businessSummary: clipText(
          business.summary ||
            (business.status === "not_configured" ? "精度条件は設定されていません。" : ""),
          180
        ),
        businessBlock: formatCheckListText(businessRows, { markWidth: 4 }),
        businessTable: JSON.stringify(businessRows),
        businessReasons: clipText(
          businessReasonLines(business) === "—"
            ? business.summary || "判定項目または判定結果はありません。"
            : businessReasonLines(business),
          700
        ),
        businessEmpty:
          business.status === "not_configured"
            ? "ビジネス要件は設定されていません。"
            : "判定項目または判定結果はありません。",
        sectionEvidence: lastBusinessPage ? "EVIDENCE PREVIEW" : "CONTINUED",
        evidenceBlock: lastBusinessPage
          ? clipText(formatEvidenceBlock(evidence, item.runSummary), 620)
          : `ビジネス受入基準は次ページに続きます（全${businessItems.length}項目）。`,
        footer: footerBase,
        pageLabel: ""
      });
    });

    const hasDetail =
      item.status !== "skipped" &&
      item.status !== "cancelled" &&
      (business.status !== "not_configured" || evidence);
    return hasDetail ? [overview, ...detailPages] : [overview];
  });

  const pages = partial || (Array.isArray(caseIds) && caseIds.length === 1)
    ? casePages
    : [cover, ...indexPages, ...casePages];
  pages.forEach((page, pageIndex) => {
    page.pageLabel = `${pageIndex + 1} / ${pages.length}`;
  });
  return pages;
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
  if (input._pageKind === "index") return suiteRunIndexSchemas(input);
  if (input._pageKind === "spec") return caseSpecSchemas();
  if (input._pageKind === "case-detail") return suiteRunCaseDetailSchemas(input);
  if (input._pageKind === "case-overview") return suiteRunCaseOverviewSchemas(input);
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
      linkBox: OPEN_LINK_BOX
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
