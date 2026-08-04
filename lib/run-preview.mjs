/** Shared extractors for run answer / table / chart previews (PDF + UI). */

import { parse, View } from "vega";
import { compile } from "vega-lite";

export function clipText(value, max = 420) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function extractFinalResponseText(run = {}) {
  return (run.events || [])
    .filter((event) => event.kind === "text.final_response")
    .flatMap((event) => event.payload?.parts || [])
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Collect the exact SQL bodies used by the run, without repeating the same query. */
export function extractRunSqlText(run = {}) {
  const candidates = [];
  for (const event of run.events || []) {
    if (event.kind === "data.generated_sql") {
      const payload = event.payload;
      candidates.push(
        typeof payload === "string"
          ? payload
          : payload?.query || payload?.sql || payload?.sqlQuery || ""
      );
    }
    if (event.kind === "data.matched_query") {
      const payload = event.payload || {};
      candidates.push(
        payload.sqlQuery ||
          payload.exampleQuery?.sqlQuery ||
          payload.matchedQuery?.exampleQuery?.sqlQuery ||
          ""
      );
    }
  }
  for (const job of run.jobs || []) {
    candidates.push(job?.configuration?.query?.query || "");
  }
  return [...new Set(candidates.map((item) => String(item || "").trim()).filter(Boolean))]
    .join("\n\n-- 次の実行SQL --\n\n");
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

export function extractDataResultPreview(run = {}, { maxRows = 5, maxCols = 5 } = {}) {
  const events = (run.events || []).filter((event) => event.kind === "data.result");
  if (!events.length) return null;
  const payload = events[0]?.payload || {};
  const rowsSource = Array.isArray(payload.formattedData)
    ? payload.formattedData
    : Array.isArray(payload.data)
      ? payload.data
      : [];
  if (!rowsSource.length) {
    return {
      name: payload.name || "result",
      headers: [],
      rows: [],
      totalRows: 0,
      truncated: false
    };
  }
  const first = rowsSource[0];
  let headers = [];
  let normalized = [];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    headers = Object.keys(first).slice(0, maxCols);
    normalized = rowsSource.slice(0, maxRows).map((row) => headers.map((key) => clipText(cellValue(row?.[key]), 36)));
  } else if (Array.isArray(first)) {
    const width = Math.min(maxCols, first.length || maxCols);
    headers = Array.from({ length: width }, (_, index) => `c${index + 1}`);
    normalized = rowsSource.slice(0, maxRows).map((row) =>
      Array.from({ length: width }, (_, index) => clipText(cellValue(row?.[index]), 36))
    );
  } else {
    headers = ["value"];
    normalized = rowsSource.slice(0, maxRows).map((row) => [clipText(cellValue(row), 36)]);
  }
  return {
    name: payload.name || "result",
    headers,
    rows: normalized,
    totalRows: rowsSource.length,
    truncated: rowsSource.length > maxRows || (first && typeof first === "object" && Object.keys(first).length > maxCols)
  };
}

function vegaMark(spec) {
  if (!spec || typeof spec !== "object") return "";
  if (typeof spec.mark === "string") return spec.mark;
  if (spec.mark && typeof spec.mark === "object") return String(spec.mark.type || "");
  if (Array.isArray(spec.layer)) {
    for (const layer of spec.layer) {
      const mark = vegaMark(layer);
      if (mark) return mark;
    }
  }
  return "";
}

function parseChartSpec(payload) {
  let value = payload;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (!value || typeof value !== "object") return null;
    const nested =
      value.vegaConfig ||
      value.spec ||
      value.vegaChartJson ||
      value.resultVegaChartJson;
    if (!nested || nested === value) return value;
    value = nested;
  }
  return value && typeof value === "object" ? value : null;
}

function hasExternalData(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasExternalData);
  if (typeof value.url === "string" && value.url.trim()) return true;
  return Object.values(value).some(hasExternalData);
}

export function extractChartPreview(run = {}) {
  const events = (run.events || []).filter(
    (event) => event.kind === "chart.result" || event.kind === "analysis.result_vega_chart_json"
  );
  const summaryCount = Number(run.summary?.chartCount || 0);
  const count = Math.max(events.length, summaryCount);
  if (!count) return null;
  const marks = [];
  const titles = [];
  const specs = [];
  for (const event of events) {
    const spec = parseChartSpec(event.payload);
    if (spec) specs.push(spec);
    const mark = vegaMark(spec);
    if (mark) marks.push(mark);
    const title = spec?.title?.text || spec?.title || spec?.description;
    if (title) titles.push(String(title));
  }
  return {
    count,
    marks: [...new Set(marks.filter(Boolean))],
    titles: [...new Set(titles.filter(Boolean))].slice(0, 2),
    specs
  };
}

export async function renderChartPreviewSvg(chart, { width = 760, height = 330 } = {}) {
  const source = chart?.specs?.find((spec) => spec && !hasExternalData(spec));
  if (!source) return "";
  try {
    const spec = structuredClone(source);
    const schema = String(spec.$schema || "").toLowerCase();
    let runtimeSpec;
    if (schema.includes("vega/") && !schema.includes("vega-lite")) {
      runtimeSpec = { ...spec, width, height, background: "white" };
    } else {
      runtimeSpec = compile({
        ...spec,
        width,
        height,
        background: "white",
        autosize: { type: "fit", contains: "padding" },
        config: {
          ...spec.config,
          axis: {
            labelFont: "sans-serif",
            titleFont: "sans-serif",
            labelColor: "#334E68",
            titleColor: "#173B5E",
            gridColor: "#E6ECF2",
            ...spec.config?.axis
          },
          legend: {
            labelFont: "sans-serif",
            titleFont: "sans-serif",
            labelColor: "#334E68",
            titleColor: "#173B5E",
            ...spec.config?.legend
          },
          view: { stroke: "transparent", ...spec.config?.view }
        }
      }).spec;
    }
    const view = new View(parse(runtimeSpec), { renderer: "none" }).initialize();
    await view.runAsync();
    const svg = await view.toSVG();
    // pdfme's SVG renderer uses WinAnsi for SVG text. Keep the actual chart
    // geometry and render its human-readable title separately with Noto Sans JP.
    return svg.replace(/<text\b[\s\S]*?<\/text>/g, "");
  } catch {
    return "";
  }
}

export function buildRunEvidencePreview(run = {}) {
  if (!run) return null;
  const answer = clipText(extractFinalResponseText(run), 480);
  const table = extractDataResultPreview(run);
  const chart = extractChartPreview(run);
  if (!answer && !table && !chart) return null;
  return { answer, table, chart };
}
