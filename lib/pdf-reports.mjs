import { generate } from "@pdfme/generator";
import { PDFDocument, PDFName, PDFString, rgb } from "@pdfme/pdf-lib";
import { line, rectangle, svg, text } from "@pdfme/schemas";
import { readFileSync } from "node:fs";
import * as fontkit from "fontkit";
import { buildPieChartSvg, buildStackedBarSvg, pct, withCountPct } from "./pdf-chart.mjs";
import { FONT_NAME, FONT_NAME_BOLD, FONT_NAME_REGULAR, loadPdfFontOptions } from "./pdf-font.mjs";
import {
  buildRunEvidencePreview,
  clipText,
  extractRunSqlText,
  renderChartPreviewSvg
} from "./run-preview.mjs";

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
const CONFIDENTIALITY_LABEL = "CONFIDENTIAL｜機密情報・外部共有禁止";
const BRAND_MARK_PNG = readFileSync(
  new URL("../public/assets/prismtrail-mark.png", import.meta.url)
);

const PAGE = { width: 210, height: 297, padding: [12, 12, 14, 12] };
const CONTENT_WIDTH = 186;
const LEFT = 12;
const MM_TO_PT = 72 / 25.4;
const OPEN_LINK_BOX = { xMm: LEFT, yMm: 44, wMm: 160, hMm: 7 };
const INTERNAL_NAV_TOP_BOX = { xMm: 130, yMm: 6.5, wMm: 68, hMm: 9 };
const REFERENCE_LINK_BOXES = [
  { xMm: 12, yMm: 43, wMm: 60, hMm: 10 },
  { xMm: 75, yMm: 43, wMm: 60, hMm: 10 },
  { xMm: 138, yMm: 43, wMm: 60, hMm: 10 }
];
const INDEX_HEAD_Y = 45;
const INDEX_HEAD_HEIGHT = 8;
const INDEX_ROW_START_Y = 53;
const INDEX_ROW_HEIGHT = 15;
const INDEX_ROWS_PER_PAGE = 14;
const PROMPT_BUBBLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 4.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7.2L7 20v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" fill="#EAF2FA" stroke="#2563A8" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="10.5" r="1" fill="#2563A8"/><circle cx="12" cy="10.5" r="1" fill="#2563A8"/><circle cx="16" cy="10.5" r="1" fill="#2563A8"/></svg>`;
const SQL_CODE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="#EAF2FA" stroke="#2563A8" stroke-width="1.8"/><path d="m10 8-4 4 4 4M14 8l4 4-4 4M13.2 6.8l-2.4 10.4" fill="none" stroke="#2563A8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const DATA_TABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" fill="#EAF2FA" stroke="#2563A8" stroke-width="1.8"/><path d="M3 9h18M9 9v11M15 9v11" fill="none" stroke="#2563A8" stroke-width="1.6"/></svg>`;
const CHART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="#EAF2FA" stroke="#2563A8" stroke-width="1.8"/><path d="M7 16v-4M12 16V8M17 16v-6" stroke="#2563A8" stroke-width="2" stroke-linecap="round"/></svg>`;
const CHECKLIST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="#EAF2FA" stroke="#2563A8" stroke-width="1.8"/><path d="m7 9 1.5 1.5L11 8M13 9h4M7 15l1.5 1.5L11 14M13 15h4" fill="none" stroke="#2563A8" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const INSIGHT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M8.5 16.5h7M9.5 20h5" stroke="#2563A8" stroke-width="1.8" stroke-linecap="round"/><path d="M12 3a6 6 0 0 0-3.7 10.7c.8.6 1.2 1.2 1.2 2.1h5c0-.9.4-1.5 1.2-2.1A6 6 0 0 0 12 3Z" fill="#EAF2FA" stroke="#2563A8" stroke-width="1.8"/></svg>`;
const SECTION_ICON_INPUTS = {
  sectionBusinessIcon: CHECKLIST_SVG,
  sectionChecksIcon: CHECKLIST_SVG,
  sectionDistributionIcon: CHART_SVG,
  sectionEvidenceIcon: DATA_TABLE_SVG,
  sectionFindingsIcon: INSIGHT_SVG,
  sectionNextActionIcon: INSIGHT_SVG,
  sectionNotEvaluatedIcon: CHECKLIST_SVG,
  sectionPromptIcon: PROMPT_BUBBLE_SVG,
  sectionResponseAnswerIcon: PROMPT_BUBBLE_SVG,
  sectionResponseChartIcon: CHART_SVG,
  sectionResponseDataIcon: DATA_TABLE_SVG,
  sectionSystemIcon: CHECKLIST_SVG
};

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

export function suiteEditorUrl(suiteId) {
  return `${APP_BASE_URL}/#/suites/${encodeURIComponent(suiteId)}/edit`;
}

export function dataAgentResourceUrl(resourceName) {
  const value = String(resourceName || "").trim();
  if (!/^projects\/[^/]+\/locations\/[^/]+\/dataAgents\/[^/]+$/.test(value)) return "";
  return `https://geminidataanalytics.googleapis.com/v1/${value}`;
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
  const lower = String(name).toLowerCase();
  const icon = lower.includes("responseanswer")
    ? PROMPT_BUBBLE_SVG
    : lower.includes("prompt")
      ? PROMPT_BUBBLE_SVG
    : lower.includes("data")
      ? DATA_TABLE_SVG
      : lower.includes("chart") || lower.includes("distribution")
        ? CHART_SVG
        : lower.includes("finding") || lower.includes("nextaction")
          ? INSIGHT_SVG
          : CHECKLIST_SVG;
  return [
    svgSchema(`${name}Icon`, { x: LEFT, y: y + 1, width: 8, height: 8 }),
    textSchema(titleName, {
      x: LEFT + 11,
      y: y + 1.8,
      width: width - 11,
      height: 6,
      fontSize: 9,
      fontName: FONT_NAME_BOLD,
      fontColor: NAVY
    })
  ];
}

function referenceLinkSchemas() {
  return REFERENCE_LINK_BOXES.flatMap((box, index) => [
    rectSchema(`referenceCell${index}`, {
      x: box.xMm,
      y: box.yMm,
      width: box.wMm,
      height: box.hMm,
      color: SURFACE,
      borderColor: LINE,
      borderWidth: 0.22,
      radius: 1.1
    }),
    textSchema(`referenceLabel${index}`, {
      x: box.xMm + 3,
      y: box.yMm + 1.4,
      width: box.wMm - 6,
      height: 3,
      fontSize: 4.8,
      fontColor: MUTED,
      fontName: FONT_NAME_BOLD
    }),
    textSchema(`referenceValue${index}`, {
      x: box.xMm + 3,
      y: box.yMm + 5,
      width: box.wMm - 6,
      height: 3.5,
      fontSize: 6.2,
      fontColor: BLUE,
      fontName: FONT_NAME_BOLD
    })
  ]);
}

function pageHeaderSchemas({
  compact = false,
  sectionAware = false,
  references = false,
  showOpenLink = true
} = {}) {
  const schemas = [
    rectSchema("topRule", { y: 0, height: 3, color: BLUE }),
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
    ...(sectionAware
      ? [
          rectSchema("sectionChip", { x: LEFT, y: 17, width: 30, height: 5.5, color: BLUE, radius: 1 }),
          textSchema("sectionStep", {
            x: LEFT + 1,
            y: 18.1,
            width: 28,
            height: 3.2,
            fontSize: 5.2,
            fontColor: WHITE,
            fontName: FONT_NAME_BOLD,
            align: "center"
          }),
          textSchema("sectionName", {
            x: 45,
            y: 17.7,
            width: 80,
            height: 4,
            fontSize: 6.4,
            fontColor: BLUE,
            fontName: FONT_NAME_BOLD
          })
        ]
      : []),
    textSchema("title", {
      y: sectionAware ? 21.5 : compact ? 18 : 19.5,
      height: sectionAware ? 10 : compact ? 11 : 12,
      fontSize: compact ? 15 : 16,
      fontName: FONT_NAME_BOLD,
      fontColor: NAVY_DEEP
    }),
    textSchema("subtitle", {
      y: sectionAware ? 31.8 : compact ? 29.8 : 31,
      height: 5,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    }),
    ...(!references && showOpenLink
      ? [
          textSchema("openLink", {
            y: sectionAware ? 39.8 : compact ? 38.5 : 40,
            width: 134,
            height: 6,
            fontSize: 8,
            fontColor: BLUE,
            fontName: FONT_NAME_BOLD
          })
        ]
      : []),
    textSchema("internalNavLabel", {
      x: 130,
      y: 8,
      width: 68,
      height: 6,
      fontSize: 7.5,
      fontColor: BLUE,
      fontName: FONT_NAME_BOLD,
      align: "right"
    }),
    lineSchema("headerDivider", references ? 55 : 39.5)
  ];
  if (references) schemas.push(...referenceLinkSchemas());
  return schemas;
}

function pageFooterSchemas() {
  return [
    lineSchema("footerDivider", 282),
    textSchema("footer", {
      y: 285,
      width: 150,
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

function footerText(generatedAt) {
  return `出力日時 ${generatedAt}  ｜  ${CONFIDENTIALITY_LABEL}`;
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

function formatJst(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
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
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} JST`;
}

function stamp() {
  return formatJst(new Date());
}

function textWidth(value) {
  return [...String(value || "")].reduce(
    (sum, character) => sum + (/^[\u0000-\u00ff]$/.test(character) ? 1 : 2),
    0
  );
}

/** Paginate while retaining SQL indentation and prompt line breaks. */
function paginateTraceText(value, { columns, lines }) {
  const source = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!source) return [];
  const visualLines = [];
  for (const logicalLine of source.split("\n")) {
    if (!logicalLine) {
      visualLines.push("");
      continue;
    }
    let segment = "";
    for (const character of logicalLine) {
      if (segment && textWidth(segment + character) > columns) {
        visualLines.push(segment);
        segment = character;
      } else {
        segment += character;
      }
    }
    visualLines.push(segment);
  }
  return chunks(visualLines, lines).map((pageLines) => pageLines.join("\n"));
}

function agentLabel(agents, agentId) {
  const match = (agents || []).find((agent) => agent.id === agentId);
  return match?.displayName || agentId || "—";
}

function agentRecord(agents, agentId) {
  return (agents || []).find((agent) => agent.id === agentId) || null;
}

function referenceLinkInputs({ agent, suiteId, reportId } = {}) {
  const agentUrl = dataAgentResourceUrl(agent?.resourceName);
  return {
    referenceLabel0: "データエージェント",
    referenceValue0: agentUrl ? "GCPでData Agentを開く  ↗" : "Data Agentリンク未設定",
    referenceLabel1: "テストスイート",
    referenceValue1: "PrismTrailでスイートを開く  ↗",
    referenceLabel2: "テスト実行",
    referenceValue2: "PrismTrailで実行結果を開く  ↗",
    _referenceLinks: [
      agentUrl,
      suiteId ? suiteEditorUrl(suiteId) : "",
      reportId ? suiteRunReportUrl(reportId) : ""
    ]
  };
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

function statusDescriptor(status) {
  return (
    {
      passed: "設定した基準を満たす",
      failed: "是正して再実行が必要",
      review_required: "人による確認が必要",
      skipped: "評価対象外",
      cancelled: "実行を中止"
    }[status] || "判定結果を確認"
  );
}

function gradeSymbol(grade) {
  return { A: "A*", B: "B", C: "C", D: "D" }[grade] || "";
}

function formatGradeCode(grade) {
  const label = { A: "優", B: "良", C: "可", D: "不可" }[grade];
  return grade && label ? `${grade}（${label}）` : "—";
}

function scoreGrade(score) {
  if (score == null || score === "") return null;
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  if (value >= 100) return "A";
  if (value >= 90) return "B";
  if (value >= 50) return "C";
  return "D";
}

function scoreNote(score, empty = "未評価") {
  return score == null || score === "" ? empty : `${score}点`;
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
  if (business.enabled === false) return [["—", "ビジネス要件: 未設定"]];
  const items = Array.isArray(business.criteriaItems) && business.criteriaItems.length
    ? business.criteriaItems
    : String(business.accuracyCriteria || "")
        .split(/;+/)
        .map((item) => item.trim())
        .filter(Boolean);
  const rows = items.map((item, index) => [String(index + 1), clipText(item, 72)]);
  if (!rows.length) return [["—", "ビジネス要件: 未設定"]];
  return rows;
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
  const reasons = items
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
  return reasons || "—";
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
    const prompt = clipText(item.prompt || testCase.prompt || "—", 64);
    return [
      statusShort(item.status || "—"),
      `${title}\n${prompt}`,
      scoreGrade(system.score) || "—",
      business.grade ? String(business.grade) : "—",
      scoreGrade(evaluation.score) || "—",
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
  const heroTone = input._heroColor || BLUE;
  return [
    ...pageHeaderSchemas({ references: true }),
    rectSchema("aiSummaryCard", {
      x: LEFT,
      y: 59,
      width: CONTENT_WIDTH,
      height: 29,
      color: WHITE,
      borderColor: "#BCCBDA",
      borderWidth: 0.35,
      radius: 2.4
    }),
    rectSchema("aiSummaryLabelPanel", { x: LEFT, y: 59, width: 34, height: 29, color: NAVY_DEEP }),
    rectSchema("aiSummaryAccent", { x: 46, y: 59, width: 1.2, height: 29, color: BLUE }),
    textSchema("aiSummaryEyebrow", {
      x: 17,
      y: 67.5,
      width: 24,
      height: 8,
      fontSize: 8.5,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD,
      align: "center"
    }),
    textSchema("aiSummaryHeadline", {
      x: 53,
      y: 63.5,
      width: 137,
      height: 7,
      fontSize: 10.5,
      fontColor: NAVY_DEEP,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("aiSummaryComment", {
      x: 53,
      y: 72.5,
      width: 137,
      height: 12,
      fontSize: 7,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.4
    }),
    ...metricTableSchemas(
      [
        { name: "passRate", tone: heroTone },
        { name: "overallScore", tone: NAVY },
        { name: "systemScore", tone: BLUE },
        { name: "businessScore", tone: AMBER }
      ],
      { y: 94 }
    ),
    ...sectionHeadingSchemas("sectionDistribution", 130, { titleName: "sectionDistribution" }),
    rectSchema("statusCard", {
      x: 12,
      y: 141,
      width: 90,
      height: 57,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("statusCardTitle", {
      x: 18,
      y: 147,
      width: 40,
      height: 5,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_BOLD
    }),
    svgSchema("statusPieSvg", { x: 18, y: 155, width: 34, height: 34 }),
    textSchema("statusLegend", {
      x: 57,
      y: 155,
      width: 40,
      height: 35,
      fontSize: 7.2,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.4
    }),
    rectSchema("gradeCard", {
      x: 108,
      y: 141,
      width: 90,
      height: 57,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("gradeCardTitle", {
      x: 114,
      y: 147,
      width: 78,
      height: 5,
      fontSize: 7.5,
      fontColor: MUTED,
      fontName: FONT_NAME_BOLD
    }),
    svgSchema("gradeBarSvg", { x: 114, y: 158, width: 78, height: 6 }),
    textSchema("gradeLegend", {
      x: 114,
      y: 169,
      width: 78,
      height: 7,
      fontSize: 7,
      fontColor: MUTED,
      fontName: FONT_NAME_REGULAR
    }),
    textSchema("gradeCounts", {
      x: 114,
      y: 180,
      width: 78,
      height: 8,
      fontSize: 8,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD
    }),
    ...sectionHeadingSchemas("sectionFindings", 203, { titleName: "sectionFindings" }),
    rectSchema("findingsCard", {
      x: LEFT,
      y: 214,
      width: CONTENT_WIDTH,
      height: 48,
      color: SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("executiveSummary", {
      x: 18,
      y: 220,
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
    ...pageHeaderSchemas({ showOpenLink: false }),
    rectSchema("indexHead", { x: LEFT, y: INDEX_HEAD_Y, width: CONTENT_WIDTH, height: INDEX_HEAD_HEIGHT, color: NAVY }),
    textSchema("indexHeadResult", {
      x: 17,
      y: 46.8,
      width: 14,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("indexHeadCaseId", {
      x: 34,
      y: 46.8,
      width: 22,
      height: 5,
      fontSize: 6.2,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("indexHeadCase", {
      x: 60,
      y: 46.8,
      width: 54,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("indexHeadSystem", {
      x: 117,
      y: 46.8,
      width: 18,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD,
      align: "right"
    }),
    textSchema("indexHeadBusiness", {
      x: 138,
      y: 46.8,
      width: 23,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD,
      align: "right"
    }),
    textSchema("indexHeadScore", {
      x: 164,
      y: 46.8,
      width: 14,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD,
      align: "right"
    }),
    textSchema("indexHeadDuration", {
      x: 181,
      y: 46.8,
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
    const y = INDEX_ROW_START_Y + index * INDEX_ROW_HEIGHT;
    const tone = row.color || GRAY;
    schemas.push(
      rectSchema(`indexRowBg${index}`, {
        x: LEFT,
        y,
        width: CONTENT_WIDTH,
        height: INDEX_ROW_HEIGHT - 0.5,
        color: index % 2 ? WHITE : SURFACE,
        borderColor: LINE,
        borderWidth: 0.2
      }),
      rectSchema(`indexRowAccent${index}`, { x: LEFT, y, width: 1.5, height: INDEX_ROW_HEIGHT - 0.5, color: tone }),
      textSchema(`indexRowStatus${index}`, {
        x: 17,
        y: y + 4.7,
        width: 14,
        height: 5,
        fontSize: 7,
        fontColor: tone,
        fontName: FONT_NAME_BOLD
      }),
      rectSchema(`indexRowIdDivider${index}`, {
        x: 57.5,
        y: y + 1.5,
        width: 0.25,
        height: INDEX_ROW_HEIGHT - 3.5,
        color: LINE
      }),
      textSchema(`indexRowTitle${index}`, {
        x: 60,
        y: y + 1,
        width: 54,
        height: 5,
        fontSize: 7,
        fontColor: NAVY_DEEP,
        fontName: FONT_NAME_BOLD
      }),
      textSchema(`indexRowId${index}`, {
        x: 34,
        y: y + 5,
        width: 22,
        height: 4,
        fontSize: 5.2,
        fontColor: MUTED,
        fontName: FONT_NAME_REGULAR,
        align: "left"
      }),
      textSchema(`indexRowPrompt${index}`, {
        x: 60,
        y: y + 6.5,
        width: 54,
        height: 6.5,
        fontSize: 5.2,
        fontColor: NAVY,
        fontName: FONT_NAME_REGULAR,
        lineHeight: 1.2
      }),
      textSchema(`indexRowSystem${index}`, {
        x: 117,
        y: y + 4.3,
        width: 18,
        height: 5,
        fontSize: 7,
        fontColor: NAVY,
        fontName: FONT_NAME_BOLD,
        align: "right"
      }),
      textSchema(`indexRowBusiness${index}`, {
        x: 138,
        y: y + 4.3,
        width: 23,
        height: 5,
        fontSize: 7,
        fontColor: NAVY,
        fontName: FONT_NAME_BOLD,
        align: "right"
      }),
      textSchema(`indexRowScore${index}`, {
        x: 164,
        y: y + 4.3,
        width: 14,
        height: 5,
        fontSize: 7,
        fontColor: tone,
        fontName: FONT_NAME_BOLD,
        align: "right"
      }),
      textSchema(`indexRowDuration${index}`, {
        x: 181,
        y: y + 4.3,
        width: 13,
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

function caseResultHeroSchemas(input = {}) {
  const statusTone = input._statusColor || NAVY;
  const panels = input._hasBusiness
    ? [
        { key: "System", x: 116 },
        { key: "Business", x: 142.5 },
        { key: "Evidence", x: 169 }
      ]
    : [
        { key: "System", x: 116 },
        { key: "Duration", x: 142.5 },
        { key: "Evidence", x: 169 }
      ];
  const schemas = [
    rectSchema("statusCard", {
      x: LEFT,
      y: 57,
      width: CONTENT_WIDTH,
      height: 26,
      color: input._statusSurface || SURFACE,
      borderColor: LINE,
      borderWidth: 0.3,
      radius: 2.5
    }),
    rectSchema("statusAccent", { x: LEFT, y: 57, width: 2.5, height: 26, color: statusTone }),
    textSchema("resultBanner", {
      x: 20,
      y: 62,
      width: 48,
      height: 9,
      fontSize: 14,
      fontName: FONT_NAME_BOLD,
      fontColor: statusTone
    }),
    textSchema("resultDescriptor", {
      x: 20,
      y: 73,
      width: 48,
      height: 4,
      fontSize: 6.2,
      fontName: FONT_NAME_REGULAR,
      fontColor: MUTED
    }),
    rectSchema("resultDivider", { x: 73, y: 60, width: 0.25, height: 19, color: LINE }),
    textSchema("resultGradeLabel", {
      x: 79,
      y: 60,
      width: 30,
      height: 4,
      fontSize: 5.8,
      fontName: FONT_NAME_BOLD,
      fontColor: MUTED
    }),
    textSchema("resultGrade", {
      x: 79,
      y: 65,
      width: 15,
      height: 13,
      fontSize: 18,
      fontName: FONT_NAME_BOLD,
      fontColor: statusTone
    }),
    textSchema("resultGradeNote", {
      x: 96,
      y: 69,
      width: 16,
      height: 6,
      fontSize: 6.4,
      fontName: FONT_NAME_REGULAR,
      fontColor: MUTED
    })
  ];
  for (const panel of panels) {
    schemas.push(
      rectSchema(`result${panel.key}Panel`, {
        x: panel.x,
        y: 60,
        width: 24,
        height: 19,
        color: WHITE,
        borderColor: LINE,
        borderWidth: 0.22,
        radius: 1.4
      }),
      textSchema(`result${panel.key}Label`, {
        x: panel.x + 2,
        y: 62,
        width: 20,
        height: 3.5,
        fontSize: 5.2,
        fontName: FONT_NAME_BOLD,
        fontColor: MUTED,
        align: "center"
      }),
      textSchema(`result${panel.key}Value`, {
        x: panel.x + 2,
        y: 66,
        width: 20,
        height: 7,
        fontSize: panel.key === "Evidence" ? 8.5 : 11,
        fontName: FONT_NAME_BOLD,
        fontColor:
          panel.key === "System"
            ? BLUE
            : panel.key === "Business"
              ? input._gradeColor || MUTED
              : NAVY,
        align: "center"
      }),
      textSchema(`result${panel.key}Note`, {
        x: panel.x + 2,
        y: 73.5,
        width: 20,
        height: 3.5,
        fontSize: 4.9,
        fontName: FONT_NAME_REGULAR,
        fontColor: MUTED,
        align: "center"
      })
    );
  }
  return schemas;
}

/** Case result overview. Stable card grid; no renderer-driven page break. */
function suiteRunCaseOverviewSchemas(input = {}) {
  if (input._notEvaluated) return suiteRunCaseNotEvaluatedSchemas(input);
  const statusTone = input._statusColor || NAVY;
  const systemRows = input._systemRows || [];
  const systemRowHeight = Math.min(9.4, 56 / Math.max(1, systemRows.length));
  return [
    ...pageHeaderSchemas({ compact: true, sectionAware: true, references: true }),
    ...caseResultHeroSchemas(input),
    ...sectionHeadingSchemas("sectionSystem", 90, { titleName: "sectionSystem" }),
    rectSchema("systemChartCard", {
      x: LEFT,
      y: 101,
      width: CONTENT_WIDTH,
      height: 50,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    svgSchema("systemPieSvg", { x: 18, y: 109, width: 34, height: 34 }),
    ...gridTableSchemas("checkSummary", {
      x: 59,
      y: 108,
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
    ...sectionHeadingSchemas("sectionChecks", 160, { titleName: "sectionChecks" }),
    ...gridTableSchemas("systemChecks", {
      y: 171,
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
  const rows = input._notEvaluatedRows || [];
  return [
    ...pageHeaderSchemas({ compact: true, sectionAware: true, references: true }),
    ...caseResultHeroSchemas(input),
    ...sectionHeadingSchemas("sectionNotEvaluated", 90, { titleName: "sectionNotEvaluated" }),
    ...gridTableSchemas("notEvaluated", {
      y: 101,
      columns: [
        { width: 44, bold: true },
        { width: 142 }
      ],
      rowCount: rows.length,
      rowHeight: 12,
      headerHeight: 8,
      fontSize: 7.4
    }),
    ...sectionHeadingSchemas("sectionNextAction", 176, { titleName: "sectionNextAction" }),
    rectSchema("nextActionCard", {
      x: LEFT,
      y: 187,
      width: CONTENT_WIDTH,
      height: 66,
      color: SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("nextActionBlock", {
      x: 18,
      y: 195,
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

/** Exact run input and SQL body. Long traces are split before rendering. */
function suiteRunCaseTraceSchemas() {
  return [
    ...pageHeaderSchemas({ compact: true, sectionAware: true, showOpenLink: false }),
    svgSchema("userPromptIconSvg", { x: LEFT, y: 46, width: 8, height: 8 }),
    textSchema("sectionUserPrompt", {
      x: 23,
      y: 47.3,
      width: 169,
      height: 6,
      fontSize: 9,
      fontName: FONT_NAME_BOLD,
      fontColor: NAVY
    }),
    rectSchema("userPromptCard", {
      x: LEFT,
      y: 56,
      width: CONTENT_WIDTH,
      height: 44,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("userPromptBody", {
      x: 18,
      y: 62,
      width: 174,
      height: 32,
      fontSize: 8,
      fontColor: NAVY_DEEP,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.42
    }),
    svgSchema("executedSqlIconSvg", { x: LEFT, y: 110, width: 8, height: 8 }),
    textSchema("sectionExecutedSql", {
      x: 23,
      y: 111.3,
      width: 169,
      height: 6,
      fontSize: 9,
      fontName: FONT_NAME_BOLD,
      fontColor: NAVY
    }),
    rectSchema("executedSqlCard", {
      x: LEFT,
      y: 120,
      width: CONTENT_WIDTH,
      height: 135,
      color: NAVY_DEEP,
      borderColor: NAVY_DEEP,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("executedSqlBody", {
      x: 18,
      y: 127,
      width: 174,
      height: 121,
      fontSize: 6.7,
      fontColor: WHITE,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.3
    }),
    ...pageFooterSchemas()
  ];
}

/** Agent response evidence, separated from evaluation criteria. */
function suiteRunCaseEvidenceSchemas(input = {}) {
  const headers = input._evidenceTableHeaders || [];
  const rows = input._evidenceTableRows || [];
  const columns = headers.length
    ? headers.map((_, index) => ({
        width:
          index === headers.length - 1
            ? CONTENT_WIDTH - (CONTENT_WIDTH / headers.length) * index
            : CONTENT_WIDTH / headers.length,
        fontSize: 6.4
      }))
    : [];
  return [
    ...pageHeaderSchemas({ compact: true, sectionAware: true, showOpenLink: false }),
    ...sectionHeadingSchemas("sectionResponseAnswer", 44, { titleName: "sectionResponseAnswer" }),
    rectSchema("responseAnswerCard", {
      x: LEFT,
      y: 54,
      width: CONTENT_WIDTH,
      height: 45,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("responseAnswer", {
      x: 18,
      y: 60,
      width: 174,
      height: 34,
      fontSize: 7.8,
      fontColor: NAVY_DEEP,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.4
    }),
    ...sectionHeadingSchemas("sectionResponseData", 108, { titleName: "sectionResponseData" }),
    ...(columns.length
      ? gridTableSchemas("responseData", {
          y: 118,
          columns,
          rowCount: rows.length,
          rowHeight: 7,
          headerHeight: 7,
          headerFontSize: 6.4,
          fontSize: 6.4,
          lineHeight: 1.15
        })
      : [
          rectSchema("responseDataCard", {
            x: LEFT,
            y: 118,
            width: CONTENT_WIDTH,
            height: 22,
            color: SURFACE,
            borderColor: LINE,
            borderWidth: 0.25,
            radius: 2
          }),
          textSchema("responseDataEmpty", {
            x: 18,
            y: 125,
            width: 174,
            height: 7,
            fontSize: 7,
            fontColor: MUTED,
            fontName: FONT_NAME_REGULAR
          })
        ]),
    ...sectionHeadingSchemas("sectionResponseChart", 161, { titleName: "sectionResponseChart" }),
    rectSchema("responseChartCard", {
      x: LEFT,
      y: 171,
      width: CONTENT_WIDTH,
      height: 81,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    textSchema("responseChartTitle", {
      x: 18,
      y: 182,
      width: 174,
      height: 6,
      fontSize: 7,
      fontColor: NAVY,
      fontName: FONT_NAME_BOLD,
      align: "center"
    }),
    ...(input._hasChartSvg
      ? [svgSchema("responseChartSvg", { x: 18, y: 189, width: 174, height: 66 })]
      : [
          textSchema("responseChartFallback", {
            x: 18,
            y: 214,
            width: 174,
            height: 12,
            fontSize: 7.4,
            fontColor: MUTED,
            fontName: FONT_NAME_REGULAR,
            align: "center"
          })
        ]),
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
  const schemas = [
    ...pageHeaderSchemas({ compact: true, sectionAware: true, showOpenLink: false }),
    rectSchema("businessVerdictCard", {
      x: LEFT,
      y: 44,
      width: CONTENT_WIDTH,
      height: 31,
      color: input._gradeSurface || SURFACE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    rectSchema("businessVerdictAccent", {
      x: LEFT,
      y: 44,
      width: 3,
      height: 31,
      color: input._gradeColor || GRAY
    }),
    textSchema("businessHeadline", {
      x: 20,
      y: 50,
      width: 65,
      height: 7,
      fontSize: 12,
      fontName: FONT_NAME_BOLD,
      fontColor: input._gradeColor || NAVY
    }),
    textSchema("businessSummary", {
      x: 88,
      y: 49,
      width: 102,
      height: 16,
      fontSize: 7.8,
      fontColor: NAVY,
      fontName: FONT_NAME_REGULAR,
      lineHeight: 1.4
    }),
    ...sectionHeadingSchemas("sectionBusiness", 84, { titleName: "sectionBusiness" }),
    rectSchema("businessItemsCard", {
      x: LEFT,
      y: 95,
      width: CONTENT_WIDTH,
      height: businessCardHeight,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 0.25,
      radius: 2
    }),
    rectSchema("businessItemsHead", { x: LEFT, y: 95, width: CONTENT_WIDTH, height: 8, color: NAVY }),
    textSchema("businessHeadStatus", {
      x: 14,
      y: 96.5,
      width: 26,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD,
      align: "center"
    }),
    textSchema("businessHeadCriterion", {
      x: 45,
      y: 96.5,
      width: 68,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    textSchema("businessHeadReason", {
      x: 119,
      y: 96.5,
      width: 76,
      height: 5,
      fontSize: 7,
      fontColor: WHITE,
      fontName: FONT_NAME_BOLD
    }),
    ...pageFooterSchemas()
  ];
  for (let index = 0; index < (input._businessItems || []).length; index += 1) {
    const item = input._businessItems[index];
    const y = 103 + index * businessRowHeight;
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
      y: 95,
      width: 0.25,
      height: businessCardHeight,
      color: LINE
    }),
    rectSchema("businessDividerCriterion", {
      x: 116,
      y: 95,
      width: 0.25,
      height: businessCardHeight,
      color: LINE
    })
  );
  if (!(input._businessItems || []).length) {
    schemas.push(
      textSchema("businessEmpty", {
        x: 18,
        y: 112,
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
    ...pageHeaderSchemas({ compact: true, references: true }),
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
    rectSchema("metaAccent", { x: LEFT, y: 56, width: 1.2, height: 29, color: BLUE }),
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
    textSchema("relatedUrls", {
      x: 12,
      y: 257,
      width: 186,
      height: 8,
      fontSize: 6.5,
      fontColor: BLUE,
      fontName: FONT_NAME_REGULAR
    }),
    textSchema("memo", {
      x: 12,
      y: 267,
      width: 186,
      height: 8,
      fontSize: 6.5,
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
    const agentId = testCase.agentId || suite.defaultAgentId;
    const agent = agentLabel(agents, agentId);
    const references = referenceLinkInputs({
      agent: agentRecord(agents, agentId),
      suiteId: suite.id
    });
    references.referenceLabel2 = "テストケース";
    references.referenceValue2 = "PrismTrailでケースを開く  ↗";
    references._referenceLinks[2] = url;
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
        ...SECTION_ICON_INPUTS,
        ...references,
        _pageKind: "spec",
        _systemRows: systemRows,
        _criteriaRows: criteriaRows,
        brand: "PrismTrail  |  テストケース仕様書",
        docType: "テスト設計 / ケース定義",
        title: clipText(`${testCase.id || `case_${index + 1}`}  |  ${testCase.title || `ケース ${index + 1}`}`, 62),
        subtitle: `${suite.name || suite.id}  /  データエージェント ${agent}`,
        openLink: "",
        openLinkUrl: "",
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
        sectionBusiness: `ビジネス要件${
          criteriaPages.length > 1 ? `  ${criteriaPageIndex + 1} / ${criteriaPages.length}` : ""
        }${criteriaTruncated ? "（一部省略・全文はリンク先）" : ""}`,
        businessBlock: criteriaRows
          .map((row) => `${String(row[0]).padStart(2, "0")}  ${row[1]}`)
          .join("\n"),
        businessTable: JSON.stringify(businessRows),
        relatedUrls: `関連URL  ${clipText((testCase.relatedUrls || []).join("  ·  ") || "なし", 220)}`,
        memo: `メモ  ${clipText(String(testCase.memo || "なし").trim() || "なし", 180)}`,
        footer: footerText(generatedAt),
        pageLabel: ""
      };
      populateGridFields(input, "specSystem", ["項目", "設定値"], systemRows);
      populateGridFields(input, "specCriteria", ["番号", "ビジネス要件"], criteriaRows);
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

function executiveFindings({ counts, passRate, report }) {
  const evaluated = counts.passed + counts.failed + counts.review_required;
  const passRateText = passRate == null ? "—（評価対象なし）" : `${passRate}%`;
  const overallGrade = scoreGrade(report.summary?.score);
  const systemGrade = scoreGrade(report.summary?.systemScore);
  const businessGrade = scoreGrade(report.summary?.businessScore);
  const scoreText = evaluated
    ? `${overallGrade || "—"}（${scoreNote(report.summary?.score)}、システム ${systemGrade || "—"} / 業務 ${businessGrade || "—"}）`
    : "—（評価対象なし）";
  const findings = [
    `・評価対象 ${evaluated}件のうち、合格 ${counts.passed}件、不合格 ${counts.failed}件、要確認 ${counts.review_required}件です。`,
    `・合格率は ${passRateText}、総合等級は ${scoreText}です。`
  ];
  if (!evaluated) findings.push("・評価対象を確定し、ケースを実行してから結果を確認してください。");
  else if (counts.failed) findings.push("・不合格ケースをケース明細で確認し、期待値・SQL・回答根拠を是正してから再実行してください。");
  else if (counts.review_required) findings.push("・要確認ケースの業務判定と根拠を人がレビューしてからリリース判断を確定してください。");
  else findings.push("・重大な阻害要因は検出されていません。継続的な評価に活用できます。");
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
      title: clipText(item.title || testCase.title || `ケース ${index + 1}`, 28),
      caseId: clipText(caseId || "—", 22),
      targetCaseId: caseId || null,
      prompt: clipText(item.prompt || testCase.prompt || "—", 55),
      system: scoreGrade(system.score) || "—",
      business: formatGradeCode(business.grade),
      score: scoreGrade(evaluation.score) || "—",
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
    input[`indexRowTitle${index}`] = `${row.title}  ›`;
    input[`indexRowId${index}`] = row.caseId;
    input[`indexRowPrompt${index}`] = `質問: ${row.prompt}`;
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
  const grades = report.summary?.businessGrades || report.summary?.accuracyGrades || { A: 0, B: 0, C: 0, D: 0 };
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
    ...SECTION_ICON_INPUTS,
    ...referenceLinkInputs({
      agent: agentRecord(agents, selected[0]?.agentId || report.suiteSnapshot?.defaultAgentId),
      suiteId: report.suiteId,
      reportId: report.id
    }),
    _pageKind: "cover",
    brand: "PrismTrail  |  品質レポート",
    docType: "評価実行サマリー",
    title: clipText(report.suiteName || "評価実行レポート", 52),
    subtitle: `実行 ${report.id}  /  スイート ${report.suiteId || "—"}  /  ${generatedAt}`,
    openLink: "▶ PrismTrailでこの評価レポートを開く",
    openLinkUrl: "",
    aiSummaryEyebrow: "サマリー",
    aiSummaryHeadline: clipText(
      report.aiSummary?.status === "succeeded"
        ? report.aiSummary.headline
        : "AIコメントはまだ生成されていません",
      58
    ),
    aiSummaryComment: clipText(
      report.aiSummary?.status === "succeeded"
        ? report.aiSummary.comment
        : report.aiSummary?.message || "PrismTrailの画面からAIコメントを生成すると、ここに全ケースの総括が表示されます。",
      260
    ),
    passRateLabel: "合格率",
    passRateValue: passRate == null ? "—" : `${passRate}%`,
    passRateNote: evaluated
      ? `評価済み ${evaluated}件中 ${statusCounts.passed}件`
      : "評価対象なし",
    overallScoreLabel: "総合等級",
    overallScoreValue:
      !evaluated ? "—" : scoreGrade(report.summary?.score) || "—",
    overallScoreNote: !evaluated ? "評価対象なし" : scoreNote(report.summary?.score),
    systemScoreLabel: "システム等級",
    systemScoreValue:
      !evaluated ? "—" : scoreGrade(report.summary?.systemScore) || "—",
    systemScoreNote: !evaluated ? "評価対象なし" : `${scoreNote(report.summary?.systemScore)} · 機械判定`,
    businessScoreLabel: "業務等級",
    businessScoreValue:
      !evaluated ? "—" : scoreGrade(report.summary?.businessScore) || "—",
    businessScoreNote: !evaluated
      ? "評価対象なし"
      : report.summary?.businessScore == null
        ? "未設定"
        : `${scoreNote(report.summary.businessScore)} · ビジネス要件`,
    sectionDistribution: "結果分布",
    statusCardTitle: "実行結果",
    heroMetric: passRate == null ? "合格率 —" : `合格率 ${passRate}%`,
    heroSub: evaluated
      ? `評価済み ${evaluated}件中 ${statusCounts.passed}件合格\n総合等級 ${scoreGrade(report.summary?.score) || "—"}（${scoreNote(report.summary?.score)}） · ${statusLabel(report.status)}`
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
      ["総合等級", scoreGrade(report.summary?.score) || "—"],
      ["システム等級", scoreGrade(report.summary?.systemScore) || "—"],
      ["業務等級", scoreGrade(report.summary?.businessScore) || "未設定"],
      ["合格ケース", `${report.summary?.passed || 0} / ${report.summary?.total || 0}`],
      ["所要時間", formatDuration(report.summary?.totalDurationMs)],
      ["課金対象", formatBytes(report.summary?.totalBytesBilled)],
      ["出力日時", generatedAt]
    ]),
    caseIndexTable: JSON.stringify(caseIndexRows(selected, completed)),
    footer: footerText(generatedAt),
    pageLabel: "1",
    _heroColor: heroColor,
    _gateSurface: BLUE_SOFT
  };
  const indexItems = buildCaseIndexItems(selected, completed);
  const indexChunks = chunks(indexItems, INDEX_ROWS_PER_PAGE);
  const indexPages = indexChunks.map((rows, pageIndex) =>
    populateIndexRowFields({
      _pageKind: "index",
      _caseRows: rows,
      brand: "PrismTrail  |  品質レポート",
      docType: "",
      title: "テスト結果一覧",
      subtitle: `${report.suiteName || report.suiteId || "—"}  /  ${pageIndex + 1} / ${indexChunks.length} ページ`,
      openLink: "",
      openLinkUrl: "",
      internalNavLabel: "← サマリーへ戻る",
      indexHeadResult: "結果",
      indexHeadCaseId: "ケースID",
      indexHeadCase: "テストケース",
      indexHeadSystem: "システム等級",
      indexHeadBusiness: "業務等級",
      indexHeadScore: "総合等級",
      indexHeadDuration: "時間",
      caseIndexTable: JSON.stringify(
        caseIndexRows(
          selected.slice(
            pageIndex * INDEX_ROWS_PER_PAGE,
            pageIndex * INDEX_ROWS_PER_PAGE + rows.length
          ),
          completed,
          { limit: INDEX_ROWS_PER_PAGE }
        )
      ),
      footer: footerText(generatedAt),
      pageLabel: ""
    })
  );
  const casePages = selected.flatMap((testCase, index) => {
    const caseId = testCase.id || testCase.caseId;
    const item = completed.get(caseId) || testCase;
    const evaluation = item.evaluation || {};
    const system = evaluation.system || evaluation;
    const business = evaluation.business || {};
    const run = item.runId ? runsById[item.runId] : null;
    const evidence = run ? buildRunEvidencePreview(run) : null;
    const gradeText = formatBusinessGrade(business);
    const overallGrade = scoreGrade(evaluation.score);
    const systemGrade = scoreGrade(system.score);
    const sysSlices = checkSlices(evaluation);
    const sysTotal = sysSlices.reduce((sum, slice) => sum + slice.value, 0) || 1;
    const weather = weatherSlices(business);
    const caseTitle = item.title || testCase.title || caseId || `ケース ${index + 1}`;
    const title = clipText(`${caseId || "—"}｜${caseTitle}`, 46);
    const executedAt = formatJst(run?.createdAt || item.startedAt || report.createdAt);
    const durationText = formatDuration(item.runSummary?.durationMs);
    const caseMeta = `実行日時 ${executedAt}  /  実行時間 ${durationText}  /  データエージェント ${agentLabel(agents, testCase.agentId)}`;
    const footerBase = footerText(generatedAt);
    const shared = {
      ...SECTION_ICON_INPUTS,
      brand: "PrismTrail  |  品質レポート",
      docType: "",
      title,
      subtitle: caseMeta,
      openLinkUrl: "",
      internalNavLabel: partial ? "← ケース概要へ戻る" : "← サマリーへ戻る",
      caseId: caseId || "—",
      caseTitle,
      executedAt,
      sectionStep: "",
      sectionName: "",
      _hasBusiness: business.status !== "not_configured",
      _statusColor: statusColor(item.status),
      _statusSurface: statusSurface(item.status),
      _gradeColor: gradeColor(business.grade),
      _gradeSurface: gradeSurface(business.grade)
    };

    const systemRows = systemCheckRows(evaluation);
    const businessRows = businessResultRows(business);
    const resultRows = [
      ["結果", statusLabel(item.status)],
      ["総合等級", `${overallGrade || "—"} / ${scoreNote(evaluation.score)}`],
      ["システム等級", `${systemGrade || "—"} / ${scoreNote(system.score)}`],
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
    const criteriaSummaryRows = [["システム要件", systemPassed, "—", systemFailed]];
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
      ...referenceLinkInputs({
        agent: agentRecord(agents, testCase.agentId || report.suiteSnapshot?.defaultAgentId),
        suiteId: report.suiteId,
        reportId: report.id
      }),
      _pageKind: "case-overview",
      openLinkUrl: "",
      openLink: "",
      sectionStep: "セクション 1 / 3",
      sectionName: "判定・評価",
      _notEvaluated: notEvaluated,
      _notEvaluatedRows: notEvaluatedRows,
      _criteriaSummaryRows: criteriaSummaryRows,
      _systemRows: systemRows,
      _systemCellTones: systemRows.map((row) => [
        row[0] === "適合" ? GREEN : row[0] === "不適合" ? RED : GRAY,
        NAVY_DEEP
      ]),
      resultBanner: statusLabel(item.status),
      resultSummary: `総合 ${overallGrade || "—"}（${scoreNote(evaluation.score)}） · システム ${systemGrade || "—"} · 業務 ${business.grade || "—"} · SQL ${item.runSummary?.sqlCount ?? 0}件 / 図表 ${item.runSummary?.chartCount ?? 0}件`,
      resultEyebrow: "",
      resultDescriptor: statusDescriptor(item.status),
      resultGradeLabel: "総合等級",
      resultGrade: overallGrade || "—",
      resultGradeNote: scoreNote(evaluation.score),
      resultSystemLabel: "システム",
      resultSystemValue: systemGrade || "—",
      resultSystemNote: scoreNote(system.score),
      resultBusinessLabel: "業務",
      resultBusinessValue: business.grade || "—",
      resultBusinessNote: business.score == null ? "未設定" : `${business.score}点`,
      resultDurationLabel: "実行時間",
      resultDurationValue: durationText,
      resultDurationNote: formatBytes(item.runSummary?.totalBytesBilled),
      resultEvidenceLabel: "実行証跡",
      resultEvidenceValue: `${item.runSummary?.sqlCount ?? 0} / ${item.runSummary?.chartCount ?? 0}`,
      resultEvidenceNote: "SQL / 図表",
      openLink: item.runId ? "▶ PrismTrailでこのケースの実行詳細を開く" : "▶ PrismTrailで評価レポートを開く",
      caseOverallLabel: "総合等級",
      caseOverallValue: overallGrade || "—",
      caseOverallNote: evaluation.score == null ? statusShort(item.status) : `${evaluation.score}点 · ${statusShort(item.status)}`,
      caseSystemLabel: "システム等級",
      caseSystemValue: systemGrade || "—",
      caseSystemNote: system.score == null ? statusShort(system.status) : `${system.score}点 · ${statusShort(system.status)}`,
      caseBusinessLabel: "業務等級",
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
          ? `ビジネス要件: ${weather
              .filter((slice) => slice.value)
              .map((slice) => `${slice.label} ${slice.value}`)
              .join(" / ")}`
          : ""
      }`.trim(),
      sectionChecks: "システム要件の評価項目別結果",
      systemBlock: formatCheckListText(systemRows, { markWidth: 4 }),
      systemTable: JSON.stringify(systemRows),
      sectionNotEvaluated: "未評価情報",
      sectionNextAction: "次の対応",
      nextActionBlock: [
        `1. ${rerunCondition}。`,
        "2. 実行後、システム要件とビジネス要件の判定結果を確認する。",
        "3. 全体評価レポートを再出力し、最新の評価結果を確認する。",
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

    const promptText = String(run?.question || testCase.prompt || "").trim();
    const sqlText = extractRunSqlText(run || {});
    const promptPages = paginateTraceText(promptText || "ユーザープロンプトは記録されていません。", {
      columns: 58,
      lines: 8
    });
    const sqlPages = paginateTraceText(sqlText || "実行SQLは記録されていません。", {
      columns: 92,
      lines: 23
    });
    const tracePageCount = Math.max(promptPages.length, sqlPages.length, 1);
    const tracePages = Array.from({ length: tracePageCount }, (_, tracePageIndex) => ({
      ...shared,
      _pageKind: "case-trace",
      sectionStep: "セクション 2 / 3",
      sectionName: "入力・SQL",
      docType: "",
      openLink: item.runId
        ? "▶ PrismTrailでこのケースの実行詳細を開く"
        : "▶ PrismTrailで評価レポートを開く",
      sectionUserPrompt: `ユーザープロンプト${promptPages.length > 1 ? `  ${Math.min(tracePageIndex + 1, promptPages.length)} / ${promptPages.length}` : ""}`,
      userPromptIconSvg: PROMPT_BUBBLE_SVG,
      userPromptBody:
        promptPages[tracePageIndex] || "（ユーザープロンプトは前ページに掲載）",
      sectionExecutedSql: `実行SQL本文${sqlPages.length > 1 ? `  ${Math.min(tracePageIndex + 1, sqlPages.length)} / ${sqlPages.length}` : ""}`,
      executedSqlIconSvg: SQL_CODE_SVG,
      executedSqlBody: sqlPages[tracePageIndex] || "（実行SQL本文は前ページに掲載）",
      footer: footerBase,
      pageLabel: ""
    }));

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
    const businessPages = business.status === "not_configured" ? [] : chunks(businessItems, 3);
    if (business.status !== "not_configured" && !businessPages.length) businessPages.push([]);
    const detailPages = businessPages.map((pageItems, businessPageIndex) => {
      const input = populateBusinessItemFields({
        ...shared,
        _pageKind: "case-detail",
        _businessItems: pageItems,
        sectionStep: "セクション 1 / 3",
        sectionName: "判定・評価",
        docType: "",
        openLink: item.runId
          ? "▶ PrismTrailでこのケースの実行詳細を開く"
          : "▶ PrismTrailで評価レポートを開く",
        sectionBusiness: `ビジネス要件の評価項目別結果${
          businessPages.length > 1 ? `  ${businessPageIndex + 1} / ${businessPages.length}` : ""
        }${pageItems.some((entry) => entry.truncated) ? "（一部省略・全文はリンク先）" : ""}`,
        businessHeadline: gradeText,
        businessSummary: clipText(
          business.summary ||
            (business.status === "not_configured" ? "受入条件は設定されていません。" : ""),
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
        businessHeadStatus: "判定",
        businessHeadCriterion: "ビジネス要件",
        businessHeadReason: "判定根拠",
        footer: footerBase,
        pageLabel: ""
      });
      return input;
    });
    const evidenceHeaders = (evidence?.table?.headers || []).slice(0, 4);
    const evidenceRows = (evidence?.table?.rows || [])
      .slice(0, 3)
      .map((row) => row.slice(0, evidenceHeaders.length));
    const evidencePages = evidence
      ? [
          populateGridFields(
            {
              ...shared,
              _pageKind: "case-evidence",
              sectionStep: "セクション 3 / 3",
              sectionName: "回答・データ・チャート",
              _chartPreview: evidence.chart,
              _evidenceTableHeaders: evidenceHeaders,
              _evidenceTableRows: evidenceRows,
              _hasChartSvg: false,
              docType: "",
              openLink: item.runId
                ? "▶ PrismTrailでこのケースの実行詳細を開く"
                : "▶ PrismTrailで評価レポートを開く",
              sectionResponseAnswer: "回答",
              responseAnswer: clipText(evidence.answer || "最終回答テキストはありません。", 320),
              sectionResponseData: "結果データ",
              responseDataEmpty: evidence.table
                ? `結果データは0行です（${evidence.table.name || "名称なし"}）。`
                : "取得データはありません。",
              sectionResponseChart: "チャート",
              responseChartTitle:
                evidence.chart?.titles?.join(" / ") ||
                (evidence.chart ? "Agentレスポンスで生成されたチャート" : ""),
              responseChartFallback: evidence.chart
                ? "チャート仕様を描画できませんでした。上部リンクから実行詳細を確認してください。"
                : "Agentレスポンスにチャートはありません。",
              footer: footerBase,
              pageLabel: ""
            },
            "responseData",
            evidenceHeaders,
            evidenceRows
          )
        ]
      : [];

    return [overview, ...tracePages, ...detailPages, ...evidencePages];
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

function addGoToAnnotation(doc, page, targetPage, box) {
  if (!page || !targetPage || !box) return;
  const { height } = page.getSize();
  const x = box.xMm * MM_TO_PT;
  const w = box.wMm * MM_TO_PT;
  const h = box.hMm * MM_TO_PT;
  const y = height - box.yMm * MM_TO_PT - h;
  const actionDict = doc.context.obj({
    Type: PDFName.of("Action"),
    S: PDFName.of("GoTo"),
    D: [targetPage.ref, PDFName.of("Fit")]
  });
  const annotDict = doc.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Link"),
    Rect: [x, y, x + w, y + h],
    Border: [0, 0, 0],
    H: PDFName.of("I"),
    A: actionDict
  });
  page.node.addAnnot(doc.context.register(annotDict));
}

function addUriAnnotation(doc, page, url, box) {
  if (!page || !url || !box) return;
  const { height } = page.getSize();
  const x = box.xMm * MM_TO_PT;
  const w = box.wMm * MM_TO_PT;
  const h = box.hMm * MM_TO_PT;
  const y = height - box.yMm * MM_TO_PT - h;
  const actionDict = doc.context.obj({
    Type: PDFName.of("Action"),
    S: PDFName.of("URI"),
    URI: PDFString.of(url)
  });
  const annotDict = doc.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Link"),
    Rect: [x, y, x + w, y + h],
    Border: [0, 0, 0],
    H: PDFName.of("I"),
    A: actionDict
  });
  page.node.addAnnot(doc.context.register(annotDict));
}

export async function addInternalNavigation(pdfBytes, inputs = []) {
  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();
  if (!pages.length || pages.length !== inputs.length) return pdfBytes;
  const firstCover = inputs.findIndex((input) => input._pageKind === "cover");
  const firstOverview = inputs.findIndex((input) => input._pageKind === "case-overview");
  const homePageIndex = firstCover >= 0 ? firstCover : Math.max(0, firstOverview);
  const overviewByCaseId = new Map();
  inputs.forEach((input, pageIndex) => {
    if (input._pageKind === "case-overview" && input.caseId) {
      overviewByCaseId.set(input.caseId, pageIndex);
    }
  });

  inputs.forEach((input, pageIndex) => {
    (input._referenceLinks || []).forEach((url, linkIndex) => {
      addUriAnnotation(doc, pages[pageIndex], url, REFERENCE_LINK_BOXES[linkIndex]);
    });
    if (pageIndex !== homePageIndex && input.internalNavLabel) {
      addGoToAnnotation(doc, pages[pageIndex], pages[homePageIndex], INTERNAL_NAV_TOP_BOX);
    }
    if (input._pageKind !== "index") return;
    (input._caseRows || []).forEach((row, rowIndex) => {
      const targetIndex = overviewByCaseId.get(row.targetCaseId || row.caseId);
      if (targetIndex == null) return;
      addGoToAnnotation(doc, pages[pageIndex], pages[targetIndex], {
        xMm: LEFT,
        yMm: INDEX_ROW_START_Y + rowIndex * INDEX_ROW_HEIGHT,
        wMm: CONTENT_WIDTH,
        hMm: INDEX_ROW_HEIGHT - 0.5
      });
    });
  });
  return doc.save({ useObjectStreams: false });
}

function reportHeaderBrand(input = {}) {
  if (input._pageKind === "cover" || input._pageKind === "index") {
    return "PrismTrail  |  全体レポート";
  }
  if (["case-overview", "case-trace", "case-detail", "case-evidence"].includes(input._pageKind)) {
    return "PrismTrail  |  個別テストケースレポート";
  }
  if (input._pageKind === "spec") return "PrismTrail  |  テストケース仕様書";
  return "PrismTrail  |  品質レポート";
}

export async function addBrandLogo(pdfBytes, inputs = []) {
  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();
  if (!pages.length) return pdfBytes;
  doc.registerFontkit(fontkit);
  const fonts = await loadPdfFontOptions();
  const brandFont = await doc.embedFont(fonts[FONT_NAME_BOLD].data, { subset: true });
  const size = 9 * MM_TO_PT;
  for (const [pageIndex, page] of pages.entries()) {
    // Keep each page's image resource independent. Merged PDFme pages can reuse
    // XObject names, which otherwise hides the mark on the first copied page.
    const mark = await doc.embedPng(BRAND_MARK_PNG);
    const { height } = page.getSize();
    page.drawImage(mark, {
      x: LEFT * MM_TO_PT,
      y: height - 6.5 * MM_TO_PT - size,
      width: size,
      height: size
    });
    page.drawText(reportHeaderBrand(inputs[pageIndex]), {
      x: 23 * MM_TO_PT,
      y: height - 12.3 * MM_TO_PT,
      size: 9,
      font: brandFont,
      color: rgb(23 / 255, 59 / 255, 94 / 255)
    });
  }
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
    const linked = await addFirstPageLink(pdf, item.input.openLinkUrl, item.linkBox);
    parts.push(linked);
  }
  const merged = await mergePdfParts(parts);
  const branded = await addBrandLogo(merged, items.map((item) => item.input));
  const metadata = await applyDocumentMetadata(branded, items[0]?.input);
  return addInternalNavigation(metadata, items.map((item) => item.input));
}

function schemasForInput(input) {
  if (input._pageKind === "cover") return suiteRunCoverSchemas(input);
  if (input._pageKind === "index") return suiteRunIndexSchemas(input);
  if (input._pageKind === "spec") return caseSpecSchemas(input);
  if (input._pageKind === "case-detail") return suiteRunCaseDetailSchemas(input);
  if (input._pageKind === "case-evidence") return suiteRunCaseEvidenceSchemas(input);
  if (input._pageKind === "case-trace") return suiteRunCaseTraceSchemas(input);
  if (input._pageKind === "case-overview") return suiteRunCaseOverviewSchemas(input);
  return suiteRunCaseOverviewSchemas(input);
}

async function hydrateEvidenceCharts(inputs) {
  for (const input of inputs) {
    if (input._pageKind !== "case-evidence" || !input._chartPreview) continue;
    const svg = await renderChartPreviewSvg(input._chartPreview);
    input.responseChartSvg = svg;
    input._hasChartSvg = Boolean(svg);
  }
  return inputs;
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
  const inputs = await hydrateEvidenceCharts(
    buildSuiteRunInputs({ report, caseIds, agents, runsById })
  );
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
