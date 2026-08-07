import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const googleCloud = await readFile(new URL("../lib/google-cloud.mjs", import.meta.url), "utf8");

test("suite run persists proposal lifecycle and selects targets on the server", () => {
  assert.match(server, /schemaVersion: 3/);
  assert.match(server, /improvementProposals: \{ status: "pending", targetCaseIds: \[\] \}/);
  assert.match(server, /const targetCaseIds = improvementTargetCaseIds\(suiteRun\)/);
  assert.match(server, /mapWithConcurrency\(targets, 3/);
  assert.match(server, /mapWithConcurrency\(targetAgentIds, 5/);
  assert.match(server, /改善提案の準備に失敗しました/);
  assert.match(server, /createSuiteAiSummary\(suiteRun\),\s*createSuiteImprovementProposals/s);
  const completionFlow = server.slice(
    server.indexOf("const [aiSummary, improvementResult]"),
    server.indexOf("async function startSuiteRun")
  );
  assert.ok(
    completionFlow.indexOf("applySuiteImprovementProposals(suiteRun, improvementResult)") <
      completionFlow.indexOf("suiteRun.sheetExport = await autoExportSuiteRun(suiteRun)")
  );
});

test("proposal API regenerates from persisted run data and refreshes Sheets", () => {
  const source = server.slice(
    server.indexOf("async function regenerateSuiteImprovementProposals"),
    server.indexOf("async function regenerateSuiteAiSummary")
  );
  assert.match(source, /suiteRunStore\.get\(reportId\)/);
  assert.match(source, /prepareImprovementGeneration\(suiteRun\)/);
  assert.match(source, /autoExportSuiteRun\(suiteRun\)/);
  assert.match(source, /activeImprovementRegenerations\.has\(reportId\)/);
  assert.match(source, /activeImprovementRegenerations\.delete\(reportId\)/);
  assert.doesNotMatch(source, /body\?\.caseIds|request\.body/);
  assert.match(server, /\/improvement-proposals\$\//);
});

test("Gemini response schema requires the fixed four sections", () => {
  assert.match(googleCloud, /required: \["diagnosis", "sections", "evidenceGaps"\]/);
  assert.match(googleCloud, /required: \["systemPrompt", "referenceQuery", "sourceMart", "other"\]/);
  assert.match(googleCloud, /評価結果、点数、等級、合否は変更・再判定せず/);
  assert.match(googleCloud, /思考過程は出力しない/);
});
