import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("suite overview cards are review-first and show agents with a result donut", () => {
  const renderSuites = app.slice(app.indexOf("function renderSuites()"), app.indexOf("async function deleteSuite"));
  assert.match(renderSuites, /class="suite-card" href="#\/suites\/\$\{suite\.id\}\/edit"/);
  assert.match(renderSuites, /suiteAgentNames\(suite\)/);
  assert.match(renderSuites, /suiteResultDonut\(last, suite\)/);
  assert.doesNotMatch(renderSuites, /data-delete-suite|data-run-suite|編集する|一括実行/);
  assert.match(styles, /\.suite-result-donut\s*\{/);
  assert.match(styles, /conic-gradient/);
});

test("suite deletion is available only after opening the suite editor", () => {
  assert.match(app, /id="delete-current-suite"/);
  assert.match(app, /event\.target\.closest\("#delete-current-suite"\)/);
  assert.match(styles, /\.suite-danger-zone\s*\{/);
});

test("suite editor keeps the PDF toolbar label concise before scope selection", () => {
  assert.match(app, /id="export-latest-results-pdf"[\s\S]*?tr\("PDF出力", "Export PDF"\)/);
});

test("suite-wide execution uses the same primary treatment as case execution", () => {
  assert.match(app, /id="run-current-suite" class="button primary"[\s\S]*?tr\("全てのケースを実行", "Run all cases"\)/);
});

test("suite editor header relies on the sidebar locale switch", () => {
  const editorHeader = app.slice(app.indexOf("title: suite.name"), app.indexOf("<div class=\"${columnClass}\">"));
  assert.doesNotMatch(editorHeader, /localeSelector\(true\)/);
});
