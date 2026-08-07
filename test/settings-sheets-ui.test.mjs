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

test("legacy Sheets route resolves to the Settings diagnostic tab", () => {
  assert.match(app, /location\.replace\("#\/settings\/sheets"\)/);
  assert.match(app, /\["auth", "sheets", "storage", "mcp"\]/);
});

test("Sheets diagnostics rerender the Settings shell after a connection check", () => {
  assert.match(app, /function bindSheets\(\)/);
  assert.doesNotMatch(app, /renderSheets\(\)/);
  assert.match(app, /renderSettings\(\); refreshIcons\(\);/);
});

test("Sheets Settings is diagnostic-only and delegates connection ownership to Suite detail", () => {
  assert.doesNotMatch(app, /id="sheet-connect-form"/);
  assert.doesNotMatch(app, /<select name="agentId" required/);
  assert.match(app, /data-check-sheet=/);
  assert.match(app, /スプレッドシートを開く/);
  assert.match(app, /接続先の追加・変更は各テストスイートの詳細画面で行います/);
  assert.match(app, /Suiteで接続設定/);
  assert.match(app, /Suite専用の固定タブ/);
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
