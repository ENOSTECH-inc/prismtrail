import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("Suite detail owns the Google Sheets connection modal", () => {
  assert.match(app, /function suiteSheetConnectionDialog\(suite, connection\)/);
  assert.match(app, /id="suite-sheet-dialog"/);
  assert.match(app, /data-open-suite-sheet/);
  assert.match(app, /name="spreadsheetUrl" required/);
  assert.match(app, /body: JSON\.stringify\(\{[\s\S]*suiteId: state\.selectedSuite\.id/);
  assert.doesNotMatch(app, /<select name="agentId" required/);
});

test("Suite editor resolves Sheets by Suite ID and supports mixed-Agent Suites", () => {
  assert.match(app, /function sheetConnectionForSuite\(suiteId/);
  assert.match(app, /connection\.suiteId === targetSuiteId/);
  assert.match(app, /sheetConnectionForSuite\(suite\.id/);
  assert.doesNotMatch(app, /複数Agentのため連携不可/);
  assert.doesNotMatch(app, /const editorAgentId = suiteAgentId\(suite\)/);
});

test("successful modal save immediately activates Suite Sheet actions", () => {
  assert.match(app, /updateSheetConnection\(connection\)/);
  assert.match(app, /state\.suiteSheetModalOpen = false/);
  assert.match(app, /renderEditor\(\)/);
  assert.match(app, /同期してGシートを開く/);
});

test("report export resolves the connection by the report Suite", () => {
  assert.match(app, /sheetConnectionForSuite\(report\.suiteId, \{ readyOnly: true \}\)/);
  assert.doesNotMatch(app, /sheetConnectionForAgent\(suiteRunAgentId\(report\)/);
});
