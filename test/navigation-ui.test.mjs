import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const initializeSource = app.slice(app.indexOf("async function initialize()"));

test("global navigation focuses on suites and test run results", () => {
  assert.match(app, /テスト実行結果/);
  assert.doesNotMatch(app, /active === "run"/);
  assert.doesNotMatch(app, /id: "page:run"/);
  assert.doesNotMatch(app, /id: "page:knowledge"/);
});

test("Data Agent details own the connectivity test flow", () => {
  assert.match(app, /function renderAgentDetail\(/);
  assert.match(app, /agent-detail-tabs/);
  assert.match(app, /疎通テスト/);
  assert.match(app, /#\/agents\/\$\{agent\.id\}\/connectivity/);
  assert.match(app, /location\.replace\(agent \? `#\/agents\/\$\{agent\.id\}\/connectivity` : "#\/agents"\)/);
  assert.match(styles, /\.agent-connectivity-intro\s*\{/);
});

test("Data Agent list uses navigable cards and details expose Cloud configuration", () => {
  assert.match(app, /class="agent-card" href="#\/agents\/\$\{agent\.id\}"/);
  assert.match(app, /class="agent-card-grid"/);
  assert.doesNotMatch(app, /data-check-agent="\$\{agent\.id\}">.*接続確認/);
  assert.match(app, /設定情報/);
  assert.match(app, /remoteConfiguration/);
  assert.match(app, /システム指示/);
  assert.match(app, /データソース/);
  assert.match(app, /BigQuery max billed bytes/);
  assert.match(app, /Google Cloudで開く/);
  assert.match(styles, /\.agent-card-grid\s*\{/);
  assert.match(styles, /\.agent-configuration\s*\{/);
});

test("knowledge stays out of the active client surface without erasing stored ids", () => {
  assert.doesNotMatch(initializeSource, /json\("\/api\/knowledge-sources"\)/);
  assert.doesNotMatch(app, /ケース固有バケット/);
  assert.doesNotMatch(app, /data・ナレッジ/i);
  assert.match(app, /source\.knowledgeSourceIds \|\| \[\]/);
  assert.match(app, /state\.selectedSuite\.knowledgeSourceIds \|\| \[\]/);
});

test("initial UI render does not block on heavy GCS-backed history collections", () => {
  const blockingStart = initializeSource.indexOf("const [config, authReadiness, agents, suites, storageConfig]");
  const blockingEnd = initializeSource.indexOf("Object.assign(state", blockingStart);
  const blockingBootstrap = initializeSource.slice(blockingStart, blockingEnd);
  assert.ok(blockingStart >= 0 && blockingEnd > blockingStart);
  assert.doesNotMatch(blockingBootstrap, /\/api\/suite-runs/);
  assert.doesNotMatch(blockingBootstrap, /\/api\/runs/);
  assert.doesNotMatch(blockingBootstrap, /\/api\/sheets\/connections/);
  assert.ok(initializeSource.indexOf("await route()") < initializeSource.indexOf("preloadSecondaryData()"));
  assert.match(app, /async function ensureRouteData\(parts\)/);
});

test("suite editor separates run history from version history and groups actions", () => {
  assert.match(app, /data-editor-tab="runs"/);
  assert.match(app, /実行履歴/);
  assert.match(app, /バージョン履歴/);
  assert.match(app, /suiteRunHistory = state\.suiteRuns\.filter/);
  assert.match(app, /case-action-groups/);
  assert.match(app, /case-export-menu/);
  assert.match(styles, /\.case-export-menu\s*\{/);
});

test("suite case workspace leads with the selected case and keeps actions in one row", () => {
  assert.doesNotMatch(app, /テスト設計を編集/);
  assert.match(app, /class="selected-case-heading"/);
  assert.match(app, /selectedCase\?\.title/);
  assert.match(styles, /\.case-action-groups\s*\{[^}]*flex-wrap:\s*nowrap/);
});
