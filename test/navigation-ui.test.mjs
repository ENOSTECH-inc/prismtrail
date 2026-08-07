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
  assert.match(app, /suiteRuns: async \(\) => \{[\s\S]*?state\.suiteRuns = payload\.suiteRuns \|\| \[\];[\s\S]*?renderSuites\(\);/);
});

test("suite editor separates run history from version history and groups actions", () => {
  assert.match(app, /data-editor-tab="runs"/);
  assert.match(app, /実行履歴/);
  assert.match(app, /バージョン履歴/);
  assert.match(app, /suiteRunHistory = state\.suiteRuns\.filter/);
  assert.match(app, /case-action-groups/);
  assert.match(app, /case-export-menu/);
  assert.match(styles, /\.case-export-menu\s*\{/);
  assert.match(app, /id="export-latest-results-pdf"/);
  assert.match(app, /id="export-latest-results-sheet"/);
  assert.match(app, /function askLatestResultsScope\(/);
  assert.match(app, /output: "pdf"/);
  assert.match(app, /output: "sheet"/);
  assert.match(app, /export-latest-results/);
  assert.match(app, /AgentEval_Report/);
  assert.match(app, /latest_per_case/);
  assert.match(app, /latest_run/);
  assert.match(app, /case-nav-result-history/);
  assert.match(app, /case-result-history/);
  assert.match(app, /最終成功/);
  assert.match(app, /最終失敗/);
  assert.match(styles, /\.suite-result-rollup-summary\s*\{/);
  assert.match(styles, /\.suite-action-sheet-note\s*\{/);
});

test("suite case workspace leads with the selected case and keeps actions in one row", () => {
  assert.doesNotMatch(app, /テスト設計を編集/);
  assert.match(app, /class="selected-case-heading"/);
  assert.match(app, /selectedCase\?\.title/);
  assert.match(styles, /\.case-action-groups\s*\{[^}]*flex-wrap:\s*nowrap/);
});

test("single-case and full-suite runs navigate to an optimistic report before storage work", () => {
  const selectedCaseSource = app.slice(
    app.indexOf("async function runSelectedCase()"),
    app.indexOf("function weatherItemList")
  );
  const suiteRunSource = app.slice(
    app.indexOf("async function runSuite(id)"),
    app.indexOf("function bytesToBase64")
  );

  assert.ok(selectedCaseSource.indexOf("beginSuiteRunNavigation") < selectedCaseSource.indexOf("await saveSuite"));
  assert.ok(suiteRunSource.indexOf("beginSuiteRunNavigation") < suiteRunSource.indexOf("await saveSuite"));
  assert.match(selectedCaseSource, /void completeSuiteRunNavigation/);
  assert.match(suiteRunSource, /void completeSuiteRunNavigation/);
  assert.match(app, /state\.pendingSuiteRuns\.get\(parts\[1\]\) \|\| await json/);
  assert.match(app, /rememberSuiteRunAlias\(pendingReport\.id, run\.id\)/);
  assert.match(app, /resolveSuiteRunAlias\(parts\[1\]\)/);
  assert.match(app, /history\.replaceState\(null, "", `#\/reports\/\$\{resolvedReportId\}\$\{suffix\}`\)/);
  assert.match(app, /if \(!launchPending && \(isLive \|\| sheetExport\.status/);
  assert.match(app, /const saveState = document\.querySelector\("#save-state"\)/);
  assert.match(app, /if \(saveState\) saveState\.textContent/);
});

test("suite run modal supports all runnable and never-successful scopes", () => {
  assert.match(app, /function askSuiteRunScope\(/);
  assert.match(app, /value="all"/);
  assert.match(app, /value="without_success"/);
  assert.match(app, /成功履歴がないものだけ実行/);
  assert.match(app, /body: JSON\.stringify\(\{ scope \}\)/);
  assert.match(styles, /\.suite-action-scope-dialog\s*\{/);
});

test("response-failure reruns reuse optimistic report navigation", () => {
  const rerunSource = app.slice(
    app.indexOf('document.querySelector("#rerun-response-failures")'),
    app.indexOf('if (!launchPending && (isLive', app.indexOf('document.querySelector("#rerun-response-failures")'))
  );
  assert.ok(rerunSource.indexOf("beginSuiteRunNavigation") < rerunSource.indexOf("/rerun-response-failures"));
  assert.match(rerunSource, /completeSuiteRunNavigation/);
  assert.match(rerunSource, /report\.suiteSnapshot/);
});

test("suite cases keep acceptance criteria without a separate accuracy-validation editor", () => {
  assert.match(app, /data-criteria-editor/);
  assert.match(app, /Data Agentの回答・SQL・結果表・チャート/);
  assert.doesNotMatch(app, /data-accuracy-enabled|data-add-accuracy-source|accuracy-validation|精度検証/);
  assert.doesNotMatch(styles, /accuracy-source/);
});
