export const MAX_RELATED_URLS = 20;
export const MAX_RELATED_URL_LENGTH = 2048;

function invalidRelatedUrl(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** Normalize case provenance links while rejecting executable or local-file URL schemes. */
export function normalizeRelatedUrls(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : value == null
        ? []
        : (() => { throw invalidRelatedUrl("関連URLはURL文字列のリストで指定してください。"); })();
  const normalized = [];
  const seen = new Set();
  for (const item of items) {
    const raw = String(item ?? "").trim();
    if (!raw || seen.has(raw)) continue;
    if (/[\u0000-\u001f\u007f]/.test(raw)) {
      throw invalidRelatedUrl("関連URLに制御文字は使用できません。");
    }
    if (raw.length > MAX_RELATED_URL_LENGTH) {
      throw invalidRelatedUrl(`関連URLは1件${MAX_RELATED_URL_LENGTH}文字以内で指定してください。`);
    }
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw invalidRelatedUrl(`関連URLの形式が正しくありません: ${raw}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw invalidRelatedUrl(`関連URLはhttpまたはhttpsで指定してください: ${raw}`);
    }
    if (parsed.username || parsed.password) {
      throw invalidRelatedUrl("関連URLにユーザー名やパスワードを含めることはできません。");
    }
    seen.add(raw);
    normalized.push(raw);
  }
  if (normalized.length > MAX_RELATED_URLS) {
    throw invalidRelatedUrl(`関連URLは最大${MAX_RELATED_URLS}件まで指定できます。`);
  }
  return normalized;
}
