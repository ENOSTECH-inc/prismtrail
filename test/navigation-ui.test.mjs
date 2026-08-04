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

test("knowledge stays out of the active client surface without erasing stored ids", () => {
  assert.doesNotMatch(initializeSource, /json\("\/api\/knowledge-sources"\)/);
  assert.doesNotMatch(app, /ケース固有バケット/);
  assert.doesNotMatch(app, /data・ナレッジ/i);
  assert.match(app, /source\.knowledgeSourceIds \|\| \[\]/);
  assert.match(app, /state\.selectedSuite\.knowledgeSourceIds \|\| \[\]/);
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
