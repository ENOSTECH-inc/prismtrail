import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("report PDF export opens a scope modal for all vs failed cases", () => {
  assert.match(app, /function askPdfExportScope\(/);
  assert.match(app, /pdf-export-scope-dialog/);
  assert.match(app, /scope", "failed"/);
  assert.match(app, /失敗のみ/);
  assert.match(app, /clipPreviewText\(value, max = 8_000\)/);
  assert.match(styles, /\.pdf-export-scope-dialog/);
});

test("report case workbench shows runnable cases only and ignores stale activeCases when finished", () => {
  assert.match(app, /toLowerCase\(\) !== "draft"/);
  assert.match(app, /liveActiveCases/);
  assert.match(app, /staleActiveIds/);
  assert.match(app, /interrupted:/);
  assert.match(app, /tr\("中断", "Interrupted"\)/);
});

test("report separates response receipt and can rerun only missing responses", () => {
  assert.match(app, /function responseReceiptBadge\(/);
  assert.match(app, /data-report-filter="no_response"/);
  assert.match(app, /responseReceipt\.retryCaseIds/);
  assert.match(app, /id="rerun-response-failures"/);
  assert.match(app, /\/rerun-response-failures/);
  assert.match(app, /retryReason = "response_not_received"/);
  assert.match(styles, /\.response-receipt-badge\.received/);
  assert.match(styles, /\.response-receipt-badge\.not_received/);
});

test("report renders and regenerates persisted four-section improvement proposals", () => {
  assert.match(app, /function improvementProposalHtml\(/);
  assert.match(app, /function improvementSectionStatus\(/);
  assert.match(app, /function improvementProposalNeedsAction\(/);
  assert.match(app, /\["systemPrompt", "referenceQuery", "sourceMart", "other"\]/);
  assert.match(app, /data-report-filter="improvements"/);
  assert.match(app, /tr\("要対応", "Needs action"\)/);
  assert.match(app, /tr\("問題なし", "No issue"\)/);
  assert.match(app, /id="regenerate-improvement-proposals"/);
  assert.match(app, /\/improvement-proposals/);
  assert.match(app, /評価・合否にも影響しません/);
  assert.match(app, /showImprovementProposal: false/);
  assert.ok(app.indexOf("const filteredEntries") < app.indexOf("const selectedEntry"));
  assert.match(app, /class="improvement-generation-status"/);
  assert.match(app, /対象全件を再生成/);
  assert.match(styles, /\.improvement-proposal-grid\s*\{/);
  assert.match(styles, /\.improvement-proposal-card\s*\{/);
  assert.match(styles, /\.improvement-proposal-card\.no_issue/);
  assert.match(styles, /\.improvement-section-status\.needs_action/);
});

test("run details separate the summary from raw response events", () => {
  assert.match(app, /data-run-tab="summary"/);
  assert.match(app, /data-run-tab="trace"/);
  assert.match(app, /role="tablist"/);
  assert.match(app, /window\.scrollTo\(\{ top: 0, behavior: "instant" \}\)/);
});

test("report actions have distinct Sheets, PDF, and raw JSON treatments", () => {
  assert.match(app, /report-action-sheet/);
  assert.match(app, /report-action-pdf/);
  assert.match(app, /report-action-json/);
  assert.match(styles, /\.report-action-sheet\s*\{/);
  assert.match(styles, /\.report-action-pdf\s*\{/);
  assert.match(styles, /\.report-action-json\s*\{/);
  assert.match(app, /function openJsonViewer\(/);
  assert.doesNotMatch(app, /window\.print\(/);
});

test("completed full and single-case reports can export through a newly registered Sheet connection", () => {
  assert.match(app, /sheetConnectionForSuite\(report\.suiteId, \{ readyOnly: true \}\)/);
  assert.match(app, /sheetButtonId = "export-report-sheet"/);
  assert.match(app, /const sheet = !isLive && !proposalsGenerating/);
  assert.match(app, /結果を出力してシートを開く/);
  assert.match(app, /openAfterExport = false/);
  assert.match(app, /if \(openAfterExport\)/);
  assert.match(app, /window\.open\(exported\.connection\.spreadsheetUrl/);
  assert.match(app, /\/export-report/);
  assert.match(app, /body: JSON\.stringify\(\{ suiteRunId: report\.id \}\)/);
  assert.match(app, /exported\.report \|\| \{ \.\.\.report, sheetExport: exported\.sheetExport \}/);
  assert.match(app, /後から登録した接続が見つかりました/);
  assert.match(app, /#\/suites\/\$\{encodeURIComponent\(report\.suiteId\)\}\/edit\/sheets/);
  assert.match(app, /Suiteで連携設定/);
  assert.match(app, /sheetButtonId: "export-context-report-sheet"/);
  assert.match(app, /refreshReportSheetConnections/);
  assert.match(app, /force: name === "sheetConnections" && refreshReportSheetConnections/);
});

test("run detail keeps the report header and provides a closeable case context", () => {
  assert.match(app, /case-drilldown-header/);
  assert.match(app, /case-drilldown-inner/);
  assert.match(app, /case-drilldown-close/);
  assert.match(app, /tr\("閉じる", "Close"\)/);
  assert.match(app, /reportToolbarActions\(suiteRun/);
  assert.match(styles, /\.case-drilldown-header\s*\{/);
  assert.match(styles, /\.case-drilldown-close\s*\{[^}]*#fff0f2/s);
});

test("quick search scopes report and run pages to the current test suite", () => {
  assert.match(app, /function quickSearchScope\(/);
  assert.match(app, /function buildScopedQuickSearchCatalog\(/);
  assert.match(app, /このテストスイート内を検索/);
  assert.match(app, /item\.scoped && item\.href/);
});
