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
const GREEN = "#0F6B3D";
const GREEN_SOFT = "#E8F5ED";
const RED = "#A72C27";
const RED_SOFT = "#FCECEA";
const AMBER = "#8A5200";
const AMBER_SOFT = "#FFF4DB";
const GRAY = "#526273";
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
  cancelled: NAVY_DEEP
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

function metricTableSchemas(items, { y }) {
  const columnWidth = CONTENT_WIDTH / items.length;
  const schemas = [
    rectSchema("metricTableBody", {
      x: LEFT,
      y,
      width: CONTENT_WIDTH,
      height: 29,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.3
    }),
    rectSchema("metricTableHead", { x: LEFT, y, width: CONTENT_WIDTH, height: 8, color: NAVY })
  ];
  items.forEach((item, index) => {
    const x = LEFT + columnWidth * index;
    if (index) {
      schemas.push(
        rectSchema(`metricDivider${index}`, {
          x,
          y,
          width: 0.3,
          height: 29,
          color: LINE
        })
      );
    }
    schemas.push(
      textSchema(`${item.name}Label`, {
        x: x + 4,
        y: y + 1.5,
        width: columnWidth - 8,
        height: 5,
        fontSize: 7,
        fontColor: WHITE,
        fontName: FONT_NAME_BOLD,
        align: "center"
      }),
      textSchema(`${item.name}Value`, {
        x: x + 4,
        y: y + 11,
        width: columnWidth - 8,
        height: 8,
        fontSize: 14,
        fontColor: item.tone || NAVY,
        fontName: FONT_NAME_BOLD,
        align: "center"
      }),
      textSchema(`${item.name}Note`, {
        x: x + 4,
        y: y + 21,
        width: columnWidth - 8,
        height: 4,
        fontSize: 6.8,
        fontColor: MUTED,
        fontName: FONT_NAME_REGULAR,
        align: "center"
      })
    );
  });
  return schemas;
}

function gridTableSchemas(
  prefix,
  {
    x = LEFT,
    y,
    width = CONTENT_WIDTH,
    columns,
    rowCount,
    rowHeight,
    headerHeight = 8,
    headerFontSize = 7,
    cellTones = [],
    fontSize = 7,
    lineHeight = 1.3
  }
) {
  const height = headerHeight + rowCount * rowHeight;
  const schemas = [
    rectSchema(`${prefix}Body`, {
      x,
      y,
      width,
      height,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.3
    }),
    rectSchema(`${prefix}Head`, { x, y, width, height: headerHeight, color: NAVY })
  ];
  let columnX = x;
  columns.forEach((column, columnIndex) => {
    schemas.push(
      textSchema(`${prefix}Head${columnIndex}`, {
        x: columnX + 2,
        y: y + 1.5,
        width: column.width - 4,
        height: headerHeight - 2,
        fontSize: headerFontSize,
        fontColor: WHITE,
        fontName: FONT_NAME_BOLD,
        align: column.align || "left"
      })
    );
    columnX += column.width;
  });
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowY = y + headerHeight + rowIndex * rowHeight;
    if (rowIndex % 2) {
      schemas.push(
        rectSchema(`${prefix}RowBg${rowIndex}`, {
          x,
          y: rowY,
          width,
          height: rowHeight,
          color: SURFACE
        })
      );
    }
    if (rowIndex) {
      schemas.push(
        rectSchema(`${prefix}RowLine${rowIndex}`, {
          x,
          y: rowY,
          width,
          height: 0.25,
          color: LINE
        })
      );
    }
    let cellX = x;
    columns.forEach((column, columnIndex) => {
      schemas.push(
        textSchema(`${prefix}Row${rowIndex}Col${columnIndex}`, {
          x: cellX + 2.5,
          y: rowY + 1.5,
          width: column.width - 5,
          height: rowHeight - 2.5,
          fontSize: column.fontSize || fontSize,
          fontColor: cellTones[rowIndex]?.[columnIndex] || column.fontColor || NAVY_DEEP,
          fontName: column.bold ? FONT_NAME_BOLD : FONT_NAME_REGULAR,
          align: column.align || "left",
          lineHeight: column.lineHeight || lineHeight
        })
      );
      cellX += column.width;
    });
  }
  columnX = x;
  columns.forEach((column, columnIndex) => {
    if (columnIndex) {
      schemas.push(
        rectSchema(`${prefix}Divider${columnIndex}`, {
          x: columnX,
          y,
          width: 0.25,
          height,
          color: LINE
        })
      );
    }
    columnX += column.width;
  });
  return schemas;
}

function populateGridFields(input, prefix, headers, rows) {
  headers.forEach((header, columnIndex) => {
    input[`${prefix}Head${columnIndex}`] = header;
  });
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      input[`${prefix}Row${rowIndex}Col${columnIndex}`] = String(cell ?? "—");
    });
  });
  return input;
}

function stamp() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} JST`;
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
      passed: "合格",
      failed: "不合格",
      review_required: "要確認",
      skipped: "スキップ",
      cancelled: "中止"
    }[status] || status || "—"
  );
}

function statusShort(status) {
  return (
    {
      passed: "合格",
      failed: "不合格",
      review_required: "要確認",
      skipped: "スキップ",
      cancelled: "中止"
    }[status] || status || "—"
  );
}

function gradeSymbol(grade) {
  return { A: "A*", B: "B", C: "C", D: "D" }[grade] || "";
}

function formatGradeCode(grade) {
  const label = { A: "優", B: "良", C: "可", D: "不可" }[grade];
  return grade && label ? `${grade}（${label}）` : "—";
}

function formatBusinessGrade(business = {}) {
  if (!business || business.status === "not_configured") return "業務評価 未設定";
  if (!business.grade) return "業務評価 —";
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
    ["図表必須", boolJa(Boolean(system.requireChart))],
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
  if (business.enabled === false) return [["—", "業務要件: 未設定"]];
  const items = Array.isArray(business.criteriaItems) && business.criteriaItems.length
    ? business.criteriaItems
    : String(business.accuracyCriteria || "")
        .split(/;+/)
        .map((item) => item.trim())
        .filter(Boolean);
  if (!items.length) return [["—", "業務要件: 未設定"]];
  return items.map((item, index) => [String(index + 1), clipText(item, 72)]);
}

function systemCheckRows(evaluation = {}) {
  const checks = evaluation.system?.checks || evaluation.checks || [];
  if (!checks.length) return [["—", "システム要件の判定結果はありません"]];
  const max = 5;
  const rows = checks.slice(0, max).map((check) => [
    check.passed ? "適合" : "不適合",
    clipText(check.label || check.id || "check", 58)
  ]);
  if (checks.length > max) {
    rows.push(["…", `他 ${checks.length - max} 件（アプリの実行詳細を参照）`]);
  }
  return rows;
}

function businessResultRows(business = {}) {
  if (!business || business.status === "not_configured") {
    return [["—", "業務要件は未設定です"]];
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
        ? "適合"
        : item.mark === "cloud" || item.symbol === "☁️"
          ? "一部適合"
          : item.mark === "rain" || item.symbol === "☔️"
            ? "不適合"
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
          ? "適合"
          : item.mark === "cloud" || item.symbol === "☁️"
            ? "一部適合"
            : item.mark === "rain" || item.symbol === "☔️"
              ? "不適合"
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
  if (!count) return "図表: なし";
  const chartTypeLabels = {
    arc: "円",
    area: "面",
    bar: "棒",
    circle: "円点",
    line: "折れ線",
    point: "点",
    rect: "矩形",
    rule: "基準線",
    square: "四角",
    text: "文字",
    tick: "目盛",
    trail: "軌跡",
    vega: "可視化"
  };
  const marks = chart?.marks?.length
    ? chart.marks.map((mark) => chartTypeLabels[mark] || mark).join(", ")
    : "可視化";
  const titles = chart?.titles?.length ? ` · ${chart.titles.join(" / ")}` : "";
  return `図表: あり（${count}件 · 形式: ${marks}${titles}）`;
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
    { label: "合格", value: counts.passed, color: GREEN },
    { label: "不合格", value: counts.failed, color: RED },
    { label: "要確認", value: counts.review_required, color: AMBER },
    { label: "スキップ", value: counts.skipped, color: GRAY },
    { label: "中止", value: counts.cancelled, color: NAVY_DEEP }
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
    { label: "合格", value: ok, color: GREEN },
    { label: "不合格", value: ng, color: RED }
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
    { label: "適合", value: sun, color: GREEN },
    { label: "一部適合", value: cloud, color: AMBER },
    { label: "不適合", value: rain, color: RED }
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
    ...metricTableSchemas(
      [
        { name: "passRate", tone: heroTone },
        { name: "overallScore", tone: NAVY },
        { name: "systemScore", tone: BLUE },
        { name: "businessScore", tone: AMBER }
      ],
      { y: 96 }
    ),
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
      width: 18,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("indexHeadCase", {
      x: 38,
      y: 86.2,
      width: 76,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("indexHeadSystem", {
      x: 117,
      y: 86.2,
      width: 18,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD,
      align: "right"
    }),
    textSchema("indexHeadBusiness", {
      x: 138,
      y: 86.2,
      width: 23,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD,
      align: "right"
    }),
    textSchema("indexHeadScore", {
      x: 164,
      y: 86.2,
      width: 14,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD,
      align: "right"
    }),
    textSchema("indexHeadDuration", {
      x: 181,
      y: 86.2,
      width: 13,
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
        width: 18,
        height: 5,
        fontSize: 7.5,
        fontColor: tone,
        fontName: FONT_NAME_BOLD
      }),
      textSchema(`indexRowTitle${index}`, {
        x: 38,
        y: y + 3,
        width: 76,
        height: 6,
        fontSize: 8,
        fontColor: NAVY_DEEP,
        fontName: FONT_NAME_BOLD
      }),
      textSchema(`indexRowId${index}`, {
        x: 38,
        y: y + 11,
        width: 76,
        height: 4,
        fontSize: 6.8,
        fontColor: MUTED,
        fontName: FONT_NAME_REGULAR
      }),
      textSchema(`indexRowSystem${index}`, {
        x: 117,
        y: y + 4,
        width: 18,
        height: 5,
        fontSize: 7.5,
        fontColor: NAVY,
        fontName: FONT_NAME_BOLD,
        align: "right"
      }),
      textSchema(`indexRowBusiness${index}`, {
        x: 138,
        y: y + 4,
        width: 23,
        height: 5,
        fontSize: 7.5,
        fontColor: NAVY,
        fontName: FONT_NAME_BOLD,
        align: "right"
      }),
      textSchema(`indexRowScore${index}`, {
        x: 164,
        y: y + 4,
        width: 14,
        height: 5,
        fontSize: 7.5,
        fontColor: tone,
        fontName: FONT_NAME_BOLD,
        align: "right"
      }),
      textSchema(`indexRowDuration${index}`, {
        x: 181,
        y: y + 4,
        width: 13,
        height: 5,
        fontSize: 7,
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
  if (input._notEvaluated) return suiteRunCaseNotEvaluatedSchemas(input);
  const statusTone = input._statusColor || NAVY;
  const systemRows = input._systemRows || [];
  const systemRowHeight = Math.min(9.4, 56 / Math.max(1, systemRows.length));
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
    ...metricTableSchemas(
      [
        { name: "caseOverall", tone: statusTone },
        { name: "caseSystem", tone: BLUE },
        { name: "caseBusiness", tone: input._gradeColor || AMBER },
        { name: "caseDuration", tone: NAVY }
      ],
      { y: 87 }
    ),
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
    ...gridTableSchemas("checkSummary", {
      x: 59,
      y: 141,
      width: 132,
      columns: [
        { width: 50, bold: true },
        { width: 27, align: "center", bold: true },
        { width: 28, align: "center", bold: true },
        { width: 27, align: "center", bold: true }
      ],
      rowCount: (input._criteriaSummaryRows || []).length,
      rowHeight: 14,
      headerHeight: 8,
      fontSize: 7
    }),
    ...sectionHeadingSchemas("sectionChecks", 193, { titleName: "sectionChecks" }),
    ...gridTableSchemas("systemChecks", {
      y: 204,
      columns: [
        { width: 30, align: "center", bold: true },
        { width: 156 }
      ],
      rowCount: systemRows.length,
      rowHeight: systemRowHeight,
      headerHeight: 8,
      cellTones: input._systemCellTones || [],
      fontSize: 7
    }),
    ...pageFooterSchemas()
  ];
}

function suiteRunCaseNotEvaluatedSchemas(input = {}) {
  const statusTone = input._statusColor || GRAY;
  const rows = input._notEvaluatedRows || [];
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
    ...sectionHeadingSchemas("sectionNotEvaluated", 91, { titleName: "sectionNotEvaluated" }),
    ...gridTableSchemas("notEvaluated", {
      y: 102,
      columns: [
        { width: 44, bold: true },
        { width: 142 }
      ],
      rowCount: rows.length,
      rowHeight: 12,
      headerHeight: 8,
      fontSize: 7.4
    }),
    ...sectionHeadingSchemas("sectionNextAction", 177, { titleName: "sectionNextAction" }),
    rectSchema("nextActionCard", {
      x: LEFT,
      y: 188,
      width: CONTENT_WIDTH,
      height: 66,
      color: SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("nextActionBlock", {
      x: 18,
      y: 196,
      width: 174,
      height: 50,
      fontSize: 8.2,
      fontColor: NAVY_DEEP,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.55
    }),
    ...pageFooterSchemas()
  ];
}

function evidencePreviewSchemas(input = {}) {
  const sectionY = input._evidenceSectionY || 202;
  const cardY = sectionY + 11;
  if (!input._hasEvidencePreview) {
    return [
      ...sectionHeadingSchemas("sectionEvidence", sectionY, { titleName: "sectionEvidence" }),
      rectSchema("evidenceCard", {
        x: LEFT,
        y: cardY,
        width: CONTENT_WIDTH,
        height: 55,
        color: SURFACE,
        borderColor: LINE,
        borderWidth: 0.25,
        radius: 2
      }),
      textSchema("evidenceBlock", {
        x: 18,
        y: cardY + 7,
        width: 174,
        height: 42,
        fontSize: 7.5,
        fontName: FONT_NAME_REGULAR,
        lineHeight: 1.4
      })
    ];
  }
  const headers = input._evidenceTableHeaders || [];
  const rows = input._evidenceTableRows || [];
  const dataColumns = headers.length
    ? headers.map((_, index) => ({
        width: index === headers.length - 1
          ? 151 - (151 / headers.length) * index
          : 151 / headers.length,
        fontSize: 6.2
      }))
    : [];
  return [
    ...sectionHeadingSchemas("sectionEvidence", sectionY, { titleName: "sectionEvidence" }),
    rectSchema("evidenceCard", {
      x: LEFT,
      y: cardY,
      width: CONTENT_WIDTH,
      height: 55,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    rectSchema("evidenceLabelBand", {
      x: LEFT,
      y: cardY,
      width: 28,
      height: 55,
      color: SURFACE
    }),
    rectSchema("evidenceColumnDivider", {
      x: 40,
      y: cardY,
      width: 0.25,
      height: 55,
      color: LINE
    }),
    rectSchema("evidenceRowDivider1", {
      x: LEFT,
      y: cardY + 24,
      width: CONTENT_WIDTH,
      height: 0.25,
      color: LINE
    }),
    rectSchema("evidenceRowDivider2", {
      x: LEFT,
      y: cardY + 46,
      width: CONTENT_WIDTH,
      height: 0.25,
      color: LINE
    }),
    textSchema("evidenceAnswerLabel", {
      x: 15,
      y: cardY + 8,
      width: 22,
      height: 6,
      fontSize: 6.8,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD,
      align: "center"
    }),
    textSchema("evidenceAnswer", {
      x: 44,
      y: cardY + 4,
      width: 151,
      height: 17,
      fontSize: 7.2,
      fontColor: NAVY_DEEP,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.35
    }),
    textSchema("evidenceDataLabel", {
      x: 15,
      y: cardY + 31,
      width: 22,
      height: 7,
      fontSize: 6.8,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD,
      align: "center"
    }),
    ...(dataColumns.length
      ? gridTableSchemas("evidenceData", {
          x: 44,
          y: cardY + 27,
          width: 151,
          columns: dataColumns,
          rowCount: rows.length,
          rowHeight: 5.2,
          headerHeight: 5.5,
          headerFontSize: 6.2,
          fontSize: 6.2,
          lineHeight: 1.15
        })
      : [
          textSchema("evidenceDataEmpty", {
            x: 44,
            y: cardY + 31,
            width: 151,
            height: 7,
            fontSize: 7,
            fontColor: MUTED,
            fontName: FONT_NAME_REGULAR
          })
        ]),
    textSchema("evidenceChartLabel", {
      x: 15,
      y: cardY + 49,
      width: 22,
      height: 5,
      fontSize: 6.8,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD,
      align: "center"
    }),
    textSchema("evidenceChart", {
      x: 44,
      y: cardY + 48.5,
      width: 151,
      height: 5,
      fontSize: 7,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    })
  ];
}

/** Case result detail: business decision plus compact evidence. */
function suiteRunCaseDetailSchemas(input = {}) {
  const businessRowHeight = 26;
  const businessItemCount = (input._businessItems || []).length;
  const businessDisplayRows = Math.max(1, businessItemCount);
  const businessCardHeight = 8 + businessDisplayRows * businessRowHeight;
  const evidenceSectionY = 202 - (3 - businessDisplayRows) * businessRowHeight;
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
      height: businessCardHeight,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    rectSchema("businessItemsHead", { x: LEFT, y: 107, width: CONTENT_WIDTH, height: 8, color: NAVY }),
    textSchema("businessHeadStatus", {
      x: 14,
      y: 108.5,
      width: 26,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD,
      align: "center"
    }),
    textSchema("businessHeadCriterion", {
      x: 45,
      y: 108.5,
      width: 68,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("businessHeadReason", {
      x: 119,
      y: 108.5,
      width: 76,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    ...evidencePreviewSchemas({ ...input, _evidenceSectionY: evidenceSectionY }),
    ...(businessItemCount
      ? []
      : [
          ...sectionHeadingSchemas("sectionReviewAction", evidenceSectionY + 75, {
            titleName: "sectionReviewAction"
          }),
          rectSchema("reviewActionCard", {
            x: LEFT,
            y: evidenceSectionY + 86,
            width: CONTENT_WIDTH,
            height: 32,
            color: SURFACE,
            borderColor: LINE,
            borderWidth: 0.25,
            radius: 2
          }),
          textSchema("reviewActionBlock", {
            x: 18,
            y: evidenceSectionY + 93,
            width: 174,
            height: 18,
            fontSize: 7.8,
            fontColor: NAVY_DEEP,
            fontName: FONT_NAME_REGULAR,
            lineHeight: 1.4
          })
        ]),
    ...pageFooterSchemas()
  ];
  for (let index = 0; index < (input._businessItems || []).length; index += 1) {
    const item = input._businessItems[index];
    const y = 115 + index * businessRowHeight;
    schemas.push(
      ...(index % 2
        ? [
            rectSchema(`businessItemBg${index}`, {
              x: LEFT,
              y,
              width: CONTENT_WIDTH,
              height: businessRowHeight,
              color: SURFACE
            })
          ]
        : []),
      ...(index
        ? [
            rectSchema(`businessItemLine${index}`, {
              x: LEFT,
              y,
              width: CONTENT_WIDTH,
              height: 0.25,
              color: LINE
            })
          ]
        : []),
      rectSchema(`businessItemAccent${index}`, {
        x: LEFT,
        y,
        width: 2,
        height: businessRowHeight,
        color: item.color || GRAY
      }),
      textSchema(`businessItemMark${index}`, {
        x: 15,
        y: y + 9,
        width: 24,
        height: 6,
        fontSize: 7.2,
        fontColor: item.color || GRAY,
        fontName: FONT_NAME_BOLD,
        align: "center"
      }),
      textSchema(`businessItemCriterion${index}`, {
        x: 45,
        y: y + 3,
        width: 68,
        height: 20,
        fontSize: 7.2,
        fontColor: NAVY_DEEP,
        fontName: FONT_NAME_BOLD,
        lineHeight: 1.35
      }),
      textSchema(`businessItemReason${index}`, {
        x: 119,
        y: y + 3,
        width: 76,
        height: 20,
        fontSize: 7,
        fontColor: MUTED,
        fontName: FONT_NAME_REGULAR
      })
    );
  }
  schemas.push(
    rectSchema("businessDividerStatus", {
      x: 42,
      y: 107,
      width: 0.25,
      height: businessCardHeight,
      color: LINE
    }),
    rectSchema("businessDividerCriterion", {
      x: 116,
      y: 107,
      width: 0.25,
      height: businessCardHeight,
      color: LINE
    })
  );
  if (!(input._businessItems || []).length) {
    schemas.push(
      textSchema("businessEmpty", {
        x: 18,
        y: 124,
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
function caseSpecSchemas(input = {}) {
  const systemRows = input._systemRows || [];
  const criteriaRows = input._criteriaRows || [];
  const systemRowHeight = Math.min(6.4, 32 / Math.max(1, systemRows.length));
  const criteriaRowHeight = Math.min(6.4, 32 / Math.max(1, criteriaRows.length));
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
    rectSchema("metaColumnDivider", { x: 105, y: 56, width: 0.25, height: 29, color: LINE }),
    rectSchema("metaRowDivider", { x: LEFT, y: 70.5, width: CONTENT_WIDTH, height: 0.25, color: LINE }),
    textSchema("metaCaseLabel", {
      x: 18,
      y: 59,
      width: 80,
      height: 4,
      fontSize: 6.8,
      fontColor: MUTED,
      fontName: FONT_NAME_BOLD,
      lineHeight: 1.2
    }),
    textSchema("metaCaseValue", {
      x: 18,
      y: 64,
      width: 80,
      height: 5,
      fontSize: 7.6,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD,
      lineHeight: 1.2
    }),
    textSchema("metaAgentLabel", {
      x: 111,
      y: 59,
      width: 80,
      height: 4,
      fontSize: 6.8,
      fontColor: MUTED,
      fontName: FONT_NAME_BOLD,
      lineHeight: 1.2
    }),
    textSchema("metaAgentValue", {
      x: 111,
      y: 64,
      width: 80,
      height: 5,
      fontSize: 7.6,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD,
      lineHeight: 1.2
    }),
    textSchema("metaExecutionLabel", {
      x: 18,
      y: 73,
      width: 80,
      height: 4,
      fontSize: 6.8,
      fontColor: MUTED,
      fontName: FONT_NAME_BOLD,
      lineHeight: 1.2
    }),
    textSchema("metaExecutionValue", {
      x: 18,
      y: 78,
      width: 80,
      height: 5,
      fontSize: 7.6,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD,
      lineHeight: 1.2
    }),
    textSchema("metaAcceptanceLabel", {
      x: 111,
      y: 73,
      width: 80,
      height: 4,
      fontSize: 6.8,
      fontColor: MUTED,
      fontName: FONT_NAME_BOLD,
      lineHeight: 1.2
    }),
    textSchema("metaAcceptanceValue", {
      x: 111,
      y: 78,
      width: 80,
      height: 5,
      fontSize: 7.6,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD,
      lineHeight: 1.2
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
    ...gridTableSchemas("specSystem", {
      y: 162,
      columns: [
        { width: 48, bold: true },
        { width: 138 }
      ],
      rowCount: systemRows.length,
      rowHeight: systemRowHeight,
      headerHeight: 7,
      fontSize: 6.8
    }),
    ...sectionHeadingSchemas("sectionBusiness", 210, { titleName: "sectionBusiness" }),
    ...gridTableSchemas("specCriteria", {
      y: 221,
      columns: [
        { width: 20, align: "center", bold: true },
        { width: 166 }
      ],
      rowCount: criteriaRows.length,
      rowHeight: criteriaRowHeight,
      headerHeight: 7,
      fontSize: 6.8
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
    const businessConfig = testCase.expectations?.businessRequirements || {};
    const rawCriteria =
      Array.isArray(businessConfig.criteriaItems) && businessConfig.criteriaItems.length
        ? businessConfig.criteriaItems
        : String(businessConfig.accuracyCriteria || "")
            .split(/;+/)
            .map((item) => item.trim())
            .filter(Boolean);
    const criteriaTruncated = rawCriteria.some(
      (criterion) => clipText(criterion, 72) !== String(criterion)
    );
    const systemTruncated = systemRows.some((row) => String(row[1] || "").endsWith("…"));
    const criteriaPages = chunks(businessRows, 5);
    if (!criteriaPages.length) criteriaPages.push([]);
    const rawPrompt = String(testCase.prompt || "（未設定）").trim() || "（未設定）";
    const prompt = clipText(rawPrompt, 360);
    return criteriaPages.map((criteriaRows, criteriaPageIndex) => {
      const input = {
        _pageKind: "spec",
        _systemRows: systemRows,
        _criteriaRows: criteriaRows,
        brand: "PrismTrail  |  品質レポート",
        docType: "テストケース仕様書",
        title: clipText(testCase.title || `ケース ${index + 1}`, 54),
        subtitle: `${suite.name || suite.id}  /  ${testCase.id || "—"}`,
        openLink: "▶ PrismTrailでこのケースを開く",
        openLinkUrl: url,
        metaCaseLabel: "ケースID",
        metaCaseValue: testCase.id || "—",
        metaAgentLabel: "データエージェント",
        metaAgentValue: agent,
        metaExecutionLabel: "実行条件",
        metaExecutionValue: `${testCase.thinkingMode === "THINKING" ? "熟考" : "高速"}  ·  ${status}`,
        metaAcceptanceLabel: "合格基準",
        metaAcceptanceValue: `業務評価 ${passingGrade} 以上`,
        sectionMeta: "ケース情報",
        metaTable: JSON.stringify([
          ["ケースID", testCase.id || "—"],
          ["データエージェント", agent],
          ["思考モード", testCase.thinkingMode === "THINKING" ? "熟考" : "高速"],
          ["ステータス", status],
          ["合格ライン", passingGrade],
          ["アプリURL", url]
        ]),
        sectionPrompt:
          prompt === rawPrompt
            ? "テストの目的・プロンプト"
            : "テストの目的・プロンプト（抜粋・全文はリンク先）",
        prompt,
        sectionSystem: systemTruncated
          ? "システム要件（一部省略・全文はリンク先）"
          : "システム要件",
        systemBlock: formatCheckListText(systemRows, { markWidth: 12 }),
        systemTable: JSON.stringify(systemRows),
        sectionBusiness: `業務受入基準${
          criteriaPages.length > 1 ? `  ${criteriaPageIndex + 1} / ${criteriaPages.length}` : ""
        }${criteriaTruncated ? "（一部省略・全文はリンク先）" : ""}`,
        businessBlock: criteriaRows
          .map((row) => `${String(row[0]).padStart(2, "0")}  ${row[1]}`)
          .join("\n"),
        businessTable: JSON.stringify(businessRows),
        memo: `メモ  ${clipText(String(testCase.memo || "なし").trim() || "なし", 180)}`,
        footer: `出力日時 ${generatedAt}  ·  ${suite.id || "—"}`,
        pageLabel: ""
      };
      populateGridFields(input, "specSystem", ["項目", "設定値"], systemRows);
      populateGridFields(input, "specCriteria", ["番号", "受入基準"], criteriaRows);
      return input;
    });
  });
  inputs.forEach((input, pageIndex) => {
    input.pageLabel = `${pageIndex + 1} / ${inputs.length} ページ`;
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
  const evaluated = counts.passed + counts.failed + counts.review_required;
  if (!evaluated) return "判定不能 - 評価対象なし";
  if (status === "passed" && passRate >= 80 && !counts.review_required) {
    return "リリース可 - 品質ゲートを通過";
  }
  if (counts.failed > 0) return "リリース不可 - 不合格ケースの是正が必要";
  if (counts.review_required > 0) return "保留 - 人によるレビューが必要";
  if (passRate < 80) return "保留 - 合格率が基準未達";
  return "要確認 - 判定内容を確認";
}

function executiveFindings({ counts, passRate, report }) {
  const evaluated = counts.passed + counts.failed + counts.review_required;
  const passRateText = passRate == null ? "—（評価対象なし）" : `${passRate}%`;
  const scoreText = evaluated
    ? `${report.summary?.score ?? "—"}点（システム ${report.summary?.systemScore ?? "—"} / 業務 ${report.summary?.businessScore ?? "—"}）`
    : "—（評価対象なし）";
  const findings = [
    `・評価対象 ${evaluated}件のうち、合格 ${counts.passed}件、不合格 ${counts.failed}件、要確認 ${counts.review_required}件です。`,
    `・合格率は ${passRateText}、総合スコアは ${scoreText}です。`
  ];
  if (!evaluated) findings.push("・評価対象を確定し、ケースを実行してから品質ゲートを再判定してください。");
  else if (counts.failed) findings.push("・不合格ケースをケース明細で確認し、期待値・SQL・回答根拠を是正してから再実行してください。");
  else if (counts.review_required) findings.push("・要確認ケースの業務判定と根拠を人がレビューしてからリリース判断を確定してください。");
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
      business: formatGradeCode(business.grade),
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
    input[`indexRowSystem${index}`] = row.system;
    input[`indexRowBusiness${index}`] = row.business;
    input[`indexRowScore${index}`] = row.score;
    input[`indexRowDuration${index}`] = row.duration;
  }
  return input;
}

function businessItemDisplay(item = {}) {
  const mark = item.mark || item.symbol;
  if (mark === "sun" || mark === "☀️") return { label: "合格", color: GREEN };
  if (mark === "cloud" || mark === "☁️") return { label: "一部一致", color: AMBER };
  if (mark === "rain" || mark === "☔️") return { label: "不合格", color: RED };
  return { label: "要確認", color: GRAY };
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
    selected.map(
      (testCase) => completed.get(testCase.id || testCase.caseId) || { status: "skipped" }
    )
  );
  const statusTotal =
    statusCounts.passed +
    statusCounts.failed +
    statusCounts.review_required +
    statusCounts.skipped +
    statusCounts.cancelled;
  const evaluated = statusCounts.passed + statusCounts.failed + statusCounts.review_required;
  const passRate = evaluated ? Math.round((statusCounts.passed / evaluated) * 100) : null;
  const statusPie = statusSlices(statusCounts);
  const gradePie = gradeSlices(grades);
  const gradeTotal = (grades.A || 0) + (grades.B || 0) + (grades.C || 0) + (grades.D || 0);
  const heroColor = passRate != null && passRate >= 80 && !statusCounts.failed
    ? GREEN
    : statusCounts.failed
      ? RED
      : AMBER;

  const cover = {
    _pageKind: "cover",
    brand: "PrismTrail  |  品質レポート",
    docType: "評価実行サマリー",
    title: clipText(report.suiteName || "評価実行レポート", 52),
    subtitle: `実行 ${report.id}  /  スイート ${report.suiteId || "—"}  /  ${generatedAt}`,
    openLink: "▶ PrismTrailでこの評価レポートを開く",
    openLinkUrl: reportUrl,
    gateEyebrow: "品質ゲート判定",
    gateDecision: reportDecision(report.status, passRate, statusCounts),
    gateSummary: `総合結果 ${statusLabel(report.status)}  ·  実行時間 ${formatDuration(report.summary?.totalDurationMs)}  ·  課金対象 ${formatBytes(report.summary?.totalBytesBilled)}`,
    passRateLabel: "合格率",
    passRateValue: passRate == null ? "—" : `${passRate}%`,
    passRateNote: evaluated
      ? `評価済み ${evaluated}件中 ${statusCounts.passed}件`
      : "評価対象なし",
    overallScoreLabel: "総合スコア",
    overallScoreValue:
      !evaluated || report.summary?.score == null ? "—" : `${report.summary.score}点`,
    overallScoreNote: "100点満点",
    systemScoreLabel: "システム評価",
    systemScoreValue:
      !evaluated || report.summary?.systemScore == null ? "—" : `${report.summary.systemScore}点`,
    systemScoreNote: "機械的な判定項目",
    businessScoreLabel: "業務評価",
    businessScoreValue:
      !evaluated || report.summary?.businessScore == null ? "—" : `${report.summary.businessScore}点`,
    businessScoreNote: "業務受入基準",
    sectionDistribution: "結果分布",
    statusCardTitle: "実行結果",
    heroMetric: passRate == null ? "合格率 —" : `合格率 ${passRate}%`,
    heroSub: evaluated
      ? `評価済み ${evaluated}件中 ${statusCounts.passed}件合格\n総合スコア ${report.summary?.score ?? "—"}点  ·  ${statusLabel(report.status)}`
      : "評価対象はありません。",
    statusPieSvg: buildPieChartSvg(statusPie),
    statusLegend: [
      `● 合格      ${withCountPct(statusCounts.passed, statusTotal || 1)}`,
      `× 不合格    ${withCountPct(statusCounts.failed, statusTotal || 1)}`,
      `▲ 要確認    ${withCountPct(statusCounts.review_required, statusTotal || 1)}`,
      `— スキップ  ${withCountPct(statusCounts.skipped, statusTotal || 1)}`,
      `■ 中止      ${withCountPct(statusCounts.cancelled, statusTotal || 1)}`
    ].join("\n"),
    gradeCardTitle: "業務評価等級",
    gradeBarSvg: buildStackedBarSvg(gradePie),
    gradeLegend: "A 優  ·  B 良  ·  C 可  ·  D 不可",
    gradeCounts: `A ${grades.A || 0}   B ${grades.B || 0}   C ${grades.C || 0}   D ${grades.D || 0}`,
    gradeTable: JSON.stringify([
      ["A 優", String(grades.A || 0), pct(grades.A || 0, gradeTotal || 1)],
      ["B 良", String(grades.B || 0), pct(grades.B || 0, gradeTotal || 1)],
      ["C 可", String(grades.C || 0), pct(grades.C || 0, gradeTotal || 1)],
      ["D 不可", String(grades.D || 0), pct(grades.D || 0, gradeTotal || 1)]
    ]),
    sectionFindings: "重要所見と次の対応",
    executiveSummary: executiveFindings({ counts: statusCounts, passRate, report }),
    summaryTable: JSON.stringify([
      ["総合結果", statusLabel(report.status)],
      ["総合スコア", report.summary?.score == null ? "—" : `${report.summary.score}点`],
      ["システム評価", report.summary?.systemScore == null ? "—" : `${report.summary.systemScore}点`],
      ["業務評価", report.summary?.businessScore == null ? "未設定" : `${report.summary.businessScore}点`],
      ["合格ケース", `${report.summary?.passed || 0} / ${report.summary?.total || 0}`],
      ["所要時間", formatDuration(report.summary?.totalDurationMs)],
      ["課金対象", formatBytes(report.summary?.totalBytesBilled)],
      ["出力日時", generatedAt]
    ]),
    caseIndexTable: JSON.stringify(caseIndexRows(selected, completed)),
    footer: `出力日時 ${generatedAt}  ·  ${report.id}`,
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
      brand: "PrismTrail  |  品質レポート",
      docType: "テスト結果一覧",
      title: "テスト結果一覧",
      subtitle: `${report.suiteName || report.suiteId || "—"}  /  ${pageIndex + 1} / ${indexChunks.length} ページ`,
      openLink: "▶ PrismTrailで評価レポートを開く",
      openLinkUrl: reportUrl,
      indexSummary: `全${statusTotal}件  ·  合格 ${statusCounts.passed}  ·  不合格 ${statusCounts.failed}  ·  要確認 ${statusCounts.review_required}  ·  スキップ／中止 ${statusCounts.skipped + statusCounts.cancelled}`,
      indexHeadResult: "結果",
      indexHeadCase: "テストケース",
      indexHeadSystem: "システム点",
      indexHeadBusiness: "業務等級",
      indexHeadScore: "総合点",
      indexHeadDuration: "時間",
      caseIndexTable: JSON.stringify(
        caseIndexRows(
          selected.slice(pageIndex * 9, pageIndex * 9 + rows.length),
          completed,
          { limit: 9 }
        )
      ),
      footer: `出力日時 ${generatedAt}  ·  ${report.id}`,
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
    const docType = partial ? "個別テスト結果" : "テストケース結果";
    const title = clipText(item.title || testCase.title || caseId || `ケース ${index + 1}`, 54);
    const caseMeta = `${caseId || "—"}  /  データエージェント ${agentLabel(agents, testCase.agentId)}`;
    const footerBase = `出力日時 ${generatedAt}  ·  ${report.id}`;
    const shared = {
      brand: "PrismTrail  |  品質レポート",
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
      ["業務評価", gradeText],
      ["実行時間", formatDuration(item.runSummary?.durationMs)],
      ["課金対象", formatBytes(item.runSummary?.totalBytesBilled)],
      ["SQL / 図表", `SQL ${item.runSummary?.sqlCount ?? 0}件 · 図表 ${item.runSummary?.chartCount ?? 0}件`]
    ];
    const systemPassed = sysSlices.find((slice) => slice.label === "合格")?.value || 0;
    const systemFailed = sysSlices.find((slice) => slice.label === "不合格")?.value || 0;
    const businessPassed = weather.find((slice) => slice.label === "適合")?.value || 0;
    const businessPartial = weather.find((slice) => slice.label === "一部適合")?.value || 0;
    const businessFailed = weather.find((slice) => slice.label === "不適合")?.value || 0;
    const criteriaSummaryRows = [
      ["システム要件", systemPassed, "—", systemFailed],
      ["業務受入基準", businessPassed, businessPartial, businessFailed]
    ];
    const notEvaluated = item.status === "skipped" || item.status === "cancelled";
    const notEvaluatedReason =
      item.reason ||
      item.error?.message ||
      (item.status === "cancelled"
        ? "実行が中止されたため評価されていません。"
        : testCase.status === "draft"
          ? "テストケースが下書きのため実行対象外です。"
          : "実行対象から除外されたため評価されていません。");
    const rerunCondition =
      item.status === "cancelled"
        ? "中止要因を確認し、実行可能な状態で再実行する"
        : testCase.status === "draft"
          ? "設定内容を確認して「実行可」に変更する"
          : "対象条件と依存データを確認して再実行する";
    const notEvaluatedRows = [
      ["現在の状態", statusLabel(item.status)],
      ["未評価の理由", notEvaluatedReason],
      ["集計上の扱い", "合格率の分母から除外"],
      ["再実行条件", rerunCondition]
    ];

    const overview = {
      ...shared,
      _pageKind: "case-overview",
      _notEvaluated: notEvaluated,
      _notEvaluatedRows: notEvaluatedRows,
      _criteriaSummaryRows: criteriaSummaryRows,
      _systemRows: systemRows,
      _systemCellTones: systemRows.map((row) => [
        row[0] === "適合" ? GREEN : row[0] === "不適合" ? RED : GRAY,
        NAVY_DEEP
      ]),
      resultBanner: statusLabel(item.status),
      resultSummary: `総合 ${evaluation.score ?? "—"}点  ·  ${gradeText}  ·  SQL ${item.runSummary?.sqlCount ?? 0}件 / 図表 ${item.runSummary?.chartCount ?? 0}件`,
      openLink: item.runId ? "▶ PrismTrailでこのケースの実行詳細を開く" : "▶ PrismTrailで評価レポートを開く",
      caseOverallLabel: "総合評価",
      caseOverallValue: evaluation.score == null ? "—" : `${evaluation.score}点`,
      caseOverallNote: statusShort(item.status),
      caseSystemLabel: "システム評価",
      caseSystemValue: system.score == null ? "—" : `${system.score}点`,
      caseSystemNote: statusShort(system.status),
      caseBusinessLabel: "業務評価",
      caseBusinessValue: business.grade || "—",
      caseBusinessNote: business.score == null ? "未評価" : `${business.score}点`,
      caseDurationLabel: "実行時間",
      caseDurationValue: formatDuration(item.runSummary?.durationMs),
      caseDurationNote: formatBytes(item.runSummary?.totalBytesBilled),
      resultBlock: formatCheckListText(resultRows, { markWidth: 10 }),
      // Keep JSON for tests / debugging consumers.
      resultTable: JSON.stringify(resultRows),
      sectionSystem: "システム要件の評価",
      systemPieSvg: buildPieChartSvg(sysSlices),
      systemLegend: `${legendLines(sysSlices, sysTotal)}\n\n${
        weather.some((slice) => slice.value)
          ? `業務受入基準: ${weather
              .filter((slice) => slice.value)
              .map((slice) => `${slice.label} ${slice.value}`)
              .join(" / ")}`
          : ""
      }`.trim(),
      sectionChecks: "機械的な判定項目",
      systemBlock: formatCheckListText(systemRows, { markWidth: 4 }),
      systemTable: JSON.stringify(systemRows),
      sectionNotEvaluated: "未評価情報",
      sectionNextAction: "次の対応",
      nextActionBlock: [
        `1. ${rerunCondition}。`,
        "2. 実行後、システム要件と業務受入基準の判定結果を確認する。",
        "3. 全体評価レポートを再出力し、品質ゲート判定を更新する。",
        "",
        "※このケースは未評価のため、現在の合格率計算には含まれていません。"
      ].join("\n"),
      footer: footerBase,
      pageLabel: ""
    };
    populateGridFields(
      overview,
      "checkSummary",
      ["評価区分", "適合", "一部適合", "不適合"],
      criteriaSummaryRows
    );
    populateGridFields(overview, "systemChecks", ["判定", "判定項目"], systemRows);
    populateGridFields(overview, "notEvaluated", ["項目", "内容"], notEvaluatedRows);

    const businessItems = (Array.isArray(business.itemResults) ? business.itemResults : []).map(
      (entry) => {
        const display = businessItemDisplay(entry);
        const rawCriterion = entry.criterion || "評価基準";
        const rawReason = entry.reason || "根拠は記録されていません。";
        const criterion = clipText(rawCriterion, 72);
        const reason = clipText(rawReason, 120);
        return {
          ...display,
          criterion,
          reason,
          truncated: criterion !== rawCriterion || reason !== rawReason
        };
      }
    );
    const businessPages = chunks(businessItems, 3);
    if (!businessPages.length) businessPages.push([]);
    const detailPages = businessPages.map((pageItems, businessPageIndex) => {
      const lastBusinessPage = businessPageIndex === businessPages.length - 1;
      const evidenceHeaders = lastBusinessPage ? (evidence?.table?.headers || []).slice(0, 3) : [];
      const evidenceRows = lastBusinessPage
        ? (evidence?.table?.rows || []).slice(0, 2).map((row) => row.slice(0, evidenceHeaders.length))
        : [];
      const input = populateBusinessItemFields({
        ...shared,
        _pageKind: "case-detail",
        _businessItems: pageItems,
        _hasEvidencePreview: Boolean(lastBusinessPage && evidence),
        _evidenceTableHeaders: evidenceHeaders,
        _evidenceTableRows: evidenceRows,
        docType: `${docType} / 業務評価・根拠`,
        openLink: item.runId
          ? "▶ PrismTrailでこのケースの実行詳細を開く"
          : "▶ PrismTrailで評価レポートを開く",
        sectionBusiness: `業務受入基準${
          businessPages.length > 1 ? `  ${businessPageIndex + 1} / ${businessPages.length}` : ""
        }${pageItems.some((entry) => entry.truncated) ? "（一部省略・全文はリンク先）" : ""}`,
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
            ? "業務要件は設定されていません。"
            : "判定項目または判定結果はありません。",
        businessHeadStatus: "判定",
        businessHeadCriterion: "受入基準",
        businessHeadReason: "判定根拠",
        sectionEvidence: lastBusinessPage ? "根拠プレビュー（全文は上部リンク）" : "続き",
        evidenceAnswerLabel: "回答要約",
        evidenceAnswer: clipText(evidence?.answer || "最終回答テキストはありません。", 180),
        evidenceDataLabel: "結果データ",
        evidenceDataEmpty: evidence?.table
          ? `結果データは0行です（${evidence.table.name || "名称なし"}）。`
          : "取得データはありません。",
        evidenceChartLabel: "図表",
        evidenceChart: formatChartNote(evidence?.chart, item.runSummary),
        sectionReviewAction: "レビュー対応",
        reviewActionBlock:
          business.status === "review_required"
            ? "業務評価が未完了です。担当者が回答・結果データ・図表を確認し、受入基準ごとの判定を確定してから全体評価を再出力してください。"
            : "受入基準または判定結果がありません。ケース設定を確認し、必要な受入基準を登録して再実行してください。",
        evidenceBlock: lastBusinessPage
          ? clipText(formatEvidenceBlock(evidence, item.runSummary), 620)
          : `業務受入基準は次ページに続きます（全${businessItems.length}項目）。`,
        footer: footerBase,
        pageLabel: ""
      });
      if (evidenceHeaders.length) {
        populateGridFields(input, "evidenceData", evidenceHeaders, evidenceRows);
      }
      return input;
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
    page.pageLabel = `${pageIndex + 1} / ${pages.length} ページ`;
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

async function applyDocumentMetadata(pdfBytes, input = {}) {
  const doc = await PDFDocument.load(pdfBytes);
  const title = [input.title, input.docType].filter(Boolean).join(" - ") || "PrismTrail 品質レポート";
  doc.setTitle(title, { showInWindowTitleBar: true });
  doc.setAuthor("PrismTrail");
  doc.setSubject(input.docType || "品質レポート");
  doc.setKeywords(["PrismTrail", "品質レポート", "テスト評価"]);
  doc.setCreator("PrismTrail");
  doc.setProducer("PrismTrail PDF Report Generator");
  doc.setLanguage("ja-JP");
  return doc.save({ useObjectStreams: false });
}

async function generateLinkedParts(items) {
  const parts = [];
  for (const item of items) {
    const pdf = await generateWithFont({ basePdf: PAGE, schemas: [item.schemas] }, [item.input]);
    parts.push(await addFirstPageLink(pdf, item.input.openLinkUrl, item.linkBox));
  }
  const merged = await mergePdfParts(parts);
  return applyDocumentMetadata(merged, items[0]?.input);
}

function schemasForInput(input) {
  if (input._pageKind === "cover") return suiteRunCoverSchemas(input);
  if (input._pageKind === "index") return suiteRunIndexSchemas(input);
  if (input._pageKind === "spec") return caseSpecSchemas(input);
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
      schemas: caseSpecSchemas(input),
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
