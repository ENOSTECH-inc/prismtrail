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

test("Sheets Settings rerenders the shell after Suite-scoped actions", () => {
  assert.match(app, /function bindSheets\(\)/);
  assert.doesNotMatch(app, /renderSheets\(\)/);
  assert.match(app, /renderSettings\(\); refreshIcons\(\);/);
});

test("Sheets Settings only exposes Suite-scoped binding status and delegates ownership to Suite detail", () => {
  assert.doesNotMatch(app, /id="sheet-connect-form"/);
  assert.doesNotMatch(app, /<select name="agentId" required/);
  assert.match(app, /テストスイート別のGシート紐付け/);
  assert.match(app, /const suiteBindings = state\.suites/);
  assert.match(app, /新規紐付け/);
  assert.doesNotMatch(app, /Google Sheets接続の診断/);
  assert.doesNotMatch(app, /Suite専用の固定タブ/);
  assert.doesNotMatch(app, /<section class="sheet-grid"/);
  assert.doesNotMatch(app, /data-export-suite=/);
  assert.doesNotMatch(app, /data-import-suite=/);
  assert.doesNotMatch(app, /data-export-report=/);
  assert.doesNotMatch(app, /スイートを作成・編集/);
});

test("Sheets tab keeps breathing room below the Settings tabs", async () => {
  const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(app, /settings-tab-panel sheets-tab-panel/);
  assert.match(styles, /\.settings-tab-panel\.sheets-tab-panel\s*\{\s*margin-top:\s*14px/);
});

test("Cursor is available as an MCP client with project config guidance", () => {
  assert.match(app, /cursor:\s*\{/);
  assert.match(app, /cursor-agent mcp list-tools prismtrail/);
  assert.match(app, /\.cursor\/mcp\.json/);
  assert.match(app, /\$\{env:\$\{envName\}\}/);
  assert.match(app, /clientId === "cursor"[\s\S]*?npm run setup -- skill/);
});
