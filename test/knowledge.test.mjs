import test from "node:test";
import assert from "node:assert/strict";
import { chunkText, createIndexDocument, searchChunks } from "../lib/knowledge.mjs";

test("chunks long knowledge text with bounded size", () => {
  const chunks = chunkText(["販売計画の前提です。".repeat(80), "返品率は月次で確認します。".repeat(80)].join("\n\n"), {
    maxChars: 500,
    overlapChars: 50
  });
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 550));
});

test("retrieves relevant GCS chunks for Japanese and English queries", () => {
  const source = { id: "source_1", bucket: "demo" };
  const index = createIndexDocument(source, [
    { name: "sales.md", text: "販売チャネル別の売上成長率を月次で評価する。growth rate is a key KPI." },
    { name: "returns.md", text: "返品率はカテゴリ別に確認し、10%を超えた場合に警告する。" }
  ]);
  assert.equal(searchChunks(index.chunks, "返品率の警告", { limit: 1 })[0].objectName, "returns.md");
  assert.equal(searchChunks(index.chunks, "growth KPI", { limit: 1 })[0].objectName, "sales.md");
});
