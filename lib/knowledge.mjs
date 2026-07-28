const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".sql",
  ".html",
  ".htm"
]);

function extensionOf(name = "") {
  const match = String(name).toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] || "";
}

export function isIndexableObject(object = {}) {
  const contentType = String(object.contentType || "").toLowerCase();
  return (
    TEXT_EXTENSIONS.has(extensionOf(object.name)) ||
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("yaml") ||
    contentType.includes("csv")
  );
}

export function normalizeText(text, objectName = "") {
  let value = String(text || "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  const extension = extensionOf(objectName);
  if (extension === ".html" || extension === ".htm") {
    value = value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }
  if (extension === ".json") {
    try {
      value = JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      // Keep malformed JSON searchable as plain text.
    }
  }
  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function chunkText(text, options = {}) {
  const maxChars = Math.max(400, Number(options.maxChars || 1600));
  const overlapChars = Math.min(300, Math.max(0, Number(options.overlapChars || 180)));
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  const pushCurrent = () => {
    const value = current.trim();
    if (value) chunks.push(value);
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      let offset = 0;
      while (offset < paragraph.length) {
        chunks.push(paragraph.slice(offset, offset + maxChars));
        offset += Math.max(1, maxChars - overlapChars);
      }
      continue;
    }
    if (current && current.length + paragraph.length + 2 > maxChars) {
      const tail = current.slice(-overlapChars);
      pushCurrent();
      current = tail ? `${tail}\n\n${paragraph}` : paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  pushCurrent();
  return chunks;
}

function tokens(value = "") {
  const text = String(value).toLocaleLowerCase();
  const words = text.match(/[a-z0-9_]{2,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu) || [];
  const result = new Set(words);
  for (const word of words.filter((item) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(item))) {
    for (let index = 0; index < word.length - 1; index += 1) result.add(word.slice(index, index + 2));
  }
  return result;
}

export function searchChunks(chunks = [], query = "", options = {}) {
  const limit = Math.min(12, Math.max(1, Number(options.limit || 6)));
  const queryTokens = tokens(query);
  if (!queryTokens.size) return [];
  return chunks
    .map((chunk) => {
      const chunkTokens = tokens(`${chunk.objectName || ""} ${chunk.text || ""}`);
      let matched = 0;
      for (const token of queryTokens) if (chunkTokens.has(token)) matched += token.length > 2 ? 2 : 1;
      const phraseBonus =
        String(chunk.text || "").toLocaleLowerCase().includes(String(query).trim().toLocaleLowerCase()) ? 8 : 0;
      return { ...chunk, score: matched / Math.sqrt(Math.max(1, chunkTokens.size)) + phraseBonus };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || String(a.objectName).localeCompare(String(b.objectName)))
    .slice(0, limit);
}

export function formatRetrievedContext(chunks = [], maxChars = 12000) {
  let total = 0;
  const selected = [];
  for (const chunk of chunks) {
    const block = `[${chunk.objectName}#${chunk.chunkIndex + 1}]\n${chunk.text}`;
    if (total + block.length > maxChars) break;
    selected.push(block);
    total += block.length;
  }
  return selected.join("\n\n---\n\n");
}

export function createIndexDocument(source, objects = []) {
  const chunks = [];
  for (const object of objects) {
    const normalized = normalizeText(object.text, object.name);
    chunkText(normalized).forEach((text, chunkIndex) => {
      chunks.push({
        id: `${source.id}_${chunks.length + 1}`,
        sourceId: source.id,
        bucket: source.bucket,
        objectName: object.name,
        generation: object.generation || null,
        updated: object.updated || null,
        chunkIndex,
        text
      });
    });
  }
  return {
    schemaVersion: 1,
    id: source.id,
    sourceId: source.id,
    indexedAt: new Date().toISOString(),
    objectCount: objects.length,
    chunkCount: chunks.length,
    chunks
  };
}
