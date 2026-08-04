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
