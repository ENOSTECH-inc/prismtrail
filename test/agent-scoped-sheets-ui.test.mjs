import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("Sheets connection UI requires a target Data Agent", () => {
  assert.match(app, /<input name="sheetName" required maxlength="120"/);
  assert.match(app, /<select name="agentId" required/);
  assert.match(app, /Object\.fromEntries\(new FormData\(event\.currentTarget\)\)/);
});

test("suite editor resolves Sheets by the suite's unique agent", () => {
  assert.match(app, /const editorAgentId = suiteAgentId\(suite\)/);
  assert.match(app, /sheetConnectionForAgent\(editorAgentId/);
  assert.doesNotMatch(app, /sheetConnections\.find\(\(connection\) => connection\.status === "ready"/);
});

test("Sheets Settings delegates suite and run operations to their scoped screens", () => {
  assert.match(app, /sheetConnectionForAgent\(editorAgentId/);
  assert.match(app, /テストスイート画面とテスト実行結果画面から更新します/);
  assert.doesNotMatch(app, /data-export-suite=/);
  assert.doesNotMatch(app, /data-import-suite=/);
  assert.doesNotMatch(app, /data-export-report=/);
});
