export const ACCURACY_SOURCE_TYPES = ["text", "url", "bigquery_sql"];
export const MAX_ACCURACY_SOURCES = 20;

const LIMITS = {
  text: 20_000,
  url: 2_048,
  bigquery_sql: 20_000
};

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function sourceId(value, index) {
  const normalized = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,80}$/.test(normalized) ? normalized : `source_${index + 1}`;
}

export function normalizeAccuracySources(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_ACCURACY_SOURCES) {
    throw invalid(`精度検証ソースは最大${MAX_ACCURACY_SOURCES}件です。`);
  }
  const sources = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const type = String(raw.type || "").trim().toLowerCase();
    if (!ACCURACY_SOURCE_TYPES.includes(type)) {
      throw invalid(`精度検証ソースの種類が不正です: ${raw.type || "(empty)"}`);
    }
    const content = String(raw.content ?? raw.value ?? "").trim();
    if (!content) continue;
    if (content.length > LIMITS[type]) {
      throw invalid(`精度検証ソース (${type}) は${LIMITS[type].toLocaleString()}文字以内で指定してください。`);
    }
    if (type === "url") {
      let parsed;
      try {
        parsed = new URL(content);
      } catch {
        throw invalid("精度検証URLの形式が正しくありません。");
      }
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw invalid("精度検証URLは認証情報を含まないHTTP(S) URLで指定してください。");
      }
    }
    sources.push({
      id: sourceId(raw.id, index),
      type,
      description: String(raw.description || "").trim().slice(0, 500),
      content
    });
  }
  const ids = sources.map((source) => source.id);
  if (new Set(ids).size !== ids.length) throw invalid("精度検証ソースIDはケース内で重複できません。");
  return sources;
}

export function serializeAccuracySources(value) {
  const sources = normalizeAccuracySources(value);
  return sources.length ? JSON.stringify(sources) : "";
}

export function parseAccuracySourcesCell(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  if (text.length > 100_000) throw invalid("精度検証ソースJSONは100,000文字以内で指定してください。");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid("精度検証ソースはJSON配列で指定してください。");
  }
  if (!Array.isArray(parsed)) throw invalid("精度検証ソースはJSON配列で指定してください。");
  return normalizeAccuracySources(parsed);
}

function clip(value, limit) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit)}\n...[truncated]`;
}

export async function resolveAccuracySources(sources, { readUrl, executeBigQuery }) {
  const normalized = normalizeAccuracySources(sources);
  const resolved = [];
  for (const source of normalized) {
    try {
      if (source.type === "text") {
        resolved.push({ ...source, status: "resolved", evidence: source.content });
      } else if (source.type === "url") {
        const result = await readUrl(source.content);
        resolved.push({
          ...source,
          status: "resolved",
          evidence: clip(result.text, 50_000),
          metadata: {
            finalUrl: result.finalUrl,
            contentType: result.contentType,
            bytes: result.bytes
          }
        });
      } else {
        const result = await executeBigQuery(source.content);
        resolved.push({
          ...source,
          status: "resolved",
          evidence: clip(JSON.stringify(result.rows, null, 2), 50_000),
          metadata: {
            projectId: result.projectId,
            jobId: result.jobId,
            totalBytesProcessed: result.totalBytesProcessed,
            totalRows: result.totalRows,
            returnedRows: result.rows.length,
            cacheHit: result.cacheHit
          }
        });
      }
    } catch (error) {
      resolved.push({
        id: source.id,
        type: source.type,
        description: source.description,
        status: "error",
        error: String(error?.message || error).slice(0, 1_000)
      });
    }
  }
  return resolved;
}

export function accuracyEvidenceJson(resolvedSources) {
  return clip(JSON.stringify(resolvedSources, null, 2), 100_000);
}
