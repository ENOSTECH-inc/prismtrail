import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("Google Sheets is a Settings tab instead of a sidebar integration", () => {
  assert.match(app, /data-settings-tab="sheets"/);
  assert.match(app, /renderSheetsSettings\(\)/);
  assert.doesNotMatch(app, /id="nav-integrations"/);
  assert.doesNotMatch(app, /href="#\/sheets"/);
});

test("Google Sheets links and legacy route resolve to Settings", () => {
  assert.match(app, /href="#\/settings\/sheets"/);
  assert.match(app, /location\.replace\("#\/settings\/sheets"\)/);
  assert.match(app, /\["auth", "sheets", "storage", "mcp"\]/);
});

test("Sheets mutations rerender the Settings shell", () => {
  assert.match(app, /function bindSheets\(\)/);
  assert.doesNotMatch(app, /renderSheets\(\)/);
  assert.match(app, /renderSettings\(\); refreshIcons\(\);/);
});

test("Sheets Settings only manages connections and delegates workflows to their owning screens", () => {
  assert.match(app, /id="sheet-connect-form"/);
  assert.match(app, /data-check-sheet=/);
  assert.match(app, /スプレッドシートを開く/);
  assert.match(app, /テストスイート画面とテスト実行結果画面から更新します/);
  assert.doesNotMatch(app, /data-export-suite=/);
  assert.doesNotMatch(app, /data-import-suite=/);
  assert.doesNotMatch(app, /data-export-report=/);
  assert.doesNotMatch(app, /スイートを作成・編集/);
});

test("Cursor is available as an MCP client with project config guidance", () => {
  assert.match(app, /cursor:\s*\{/);
  assert.match(app, /cursor-agent mcp list-tools prismtrail/);
  assert.match(app, /\.cursor\/mcp\.json/);
  assert.match(app, /\$\{env:\$\{envName\}\}/);
  assert.match(app, /clientId === "cursor"[\s\S]*?npm run setup -- skill/);
});
