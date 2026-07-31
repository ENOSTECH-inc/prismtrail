/** Shared extractors for run answer / table / chart previews (PDF + UI). */

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

function parseChartSpec(value) {
  let spec = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof spec === "string") {
      try {
        spec = JSON.parse(spec);
      } catch {
        return null;
      }
      continue;
    }
    if (!spec || typeof spec !== "object") return null;
    if (spec.vegaConfig) {
      spec = spec.vegaConfig;
      continue;
    }
    if (spec.spec) {
      spec = spec.spec;
      continue;
    }
    if (spec.result && typeof spec.result === "object") {
      spec = spec.result;
      continue;
    }
    return spec;
  }
  return spec && typeof spec === "object" ? spec : null;
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
    titles: [...new Set(titles.filter(Boolean))],
    specs
  };
}

export function buildRunEvidencePreview(run = {}) {
  if (!run) return null;
  const answerFull = extractFinalResponseText(run);
  const answer = clipText(answerFull, 480);
  const table = extractDataResultPreview(run);
  const chart = extractChartPreview(run);
  if (!answer && !table && !chart) return null;
  return { answer, answerFull, table, chart };
}
