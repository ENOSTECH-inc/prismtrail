import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "@pdfme/pdf-lib";
import {
  buildCaseSpecInputs,
  buildSuiteRunInputs,
  caseEditorUrl,
  pdfFilename,
  renderCaseSpecPdf,
  renderSuiteRunPdf,
  runDetailUrl,
  suiteRunReportUrl
} from "../lib/pdf-reports.mjs";

const suite = {
  id: "suite_demo",
  name: "デモスイート",
  cases: [
    {
      id: "case_1",
      title: "月次売上",
      prompt: "6月の売上を教えて",
      agentId: "agent_x",
      thinkingMode: "FAST",
      status: "active",
      memo: "参照メモ",
      expectations: {
        systemRequirements: {
          requireSql: true,
          requireChart: false,
          maxDurationMs: 120000,
          requiredPhrases: ["売上"],
          requiredSqlTables: ["marts_core.fact"]
        },
        businessRequirements: {
          enabled: true,
          criteriaItems: ["売上が数値", "期間が6月"],
          passingGrade: "B"
        }
      }
    }
  ]
};

const agents = [{ id: "agent_x", displayName: "デモAgent" }];

const report = {
  id: "suite_run_1",
  suiteId: "suite_demo",
  suiteName: "デモスイート",
  status: "passed",
  summary: {
    score: 90,
    systemScore: 100,
    businessScore: 80,
    passed: 1,
    total: 1,
    totalDurationMs: 1200,
    totalBytesBilled: 2048,
    accuracyGrades: { A: 0, B: 1, C: 0, D: 0 }
  },
  suiteSnapshot: { cases: suite.cases },
  caseRuns: [
    {
      caseId: "case_1",
      title: "月次売上",
      status: "passed",
      runId: "run_1",
      runSummary: { durationMs: 1200, totalBytesBilled: 2048 },
      evaluation: {
        score: 90,
        system: { status: "passed", score: 100, checks: [{ passed: true, label: "SQLを生成" }] },
        business: {
          status: "passed",
          grade: "B",
          symbol: "○",
          score: 80,
          summary: "おおむね一致",
          itemResults: [
            { criterion: "売上が数値", symbol: "☀️", reason: "数値あり" },
            { criterion: "期間が6月", symbol: "☁️", reason: "明示が弱い" }
          ],
          judgeAudit: { model: "gemini-2.5-flash-lite" }
        }
      }
    }
  ]
};

test("builds case-spec inputs with checklist and system lines", () => {
  const inputs = buildCaseSpecInputs({ suite, cases: suite.cases, agents });
  assert.equal(inputs.length, 1);
  assert.match(inputs[0].docType, /TEST CASE SPECIFICATION/i);
  assert.equal(inputs[0].title, "月次売上");
  assert.match(inputs[0].metaTable, /デモAgent/);
  assert.match(inputs[0].systemTable, /SQL必須/);
  assert.match(inputs[0].businessTable, /売上が数値/);
  assert.match(inputs[0].openLink, /ケースを開く/);
  assert.equal(inputs[0].openLinkUrl, caseEditorUrl("suite_demo", "case_1"));
});

test("builds suite-run cover plus case pages, or a single case page", () => {
  const batch = buildSuiteRunInputs({ report, agents });
  assert.equal(batch.length, 4); // cover + case index + overview + detail
  assert.ok(batch[0].summaryTable);
  assert.match(batch[0].heroMetric, /%/);
  assert.match(batch[0].statusPieSvg, /<svg/);
  assert.match(batch[0].gradeBarSvg, /<svg/);
  assert.match(batch[0].caseIndexTable, /月次売上/);
  assert.equal(batch[0].openLinkUrl, suiteRunReportUrl("suite_run_1"));
  assert.equal(batch[1]._pageKind, "index");
  assert.match(batch[1].caseIndexTable, /月次売上/);
  assert.equal(batch[2]._pageKind, "case-overview");
  assert.equal(batch[3]._pageKind, "case-detail");
  assert.match(batch[3].businessTable, /OK|一部|NG/);
  assert.equal(batch[2].openLinkUrl, runDetailUrl("run_1"));
  assert.match(batch[2].resultBanner, /PASS|FAIL|合格|不合格/);
  assert.match(batch[3].evidenceBlock, /回答|結果テーブル|チャート/);
  assert.match(batch[2].systemPieSvg, /<svg/);
  assert.equal(batch[0].pageLabel, "1 / 4");
  assert.equal(batch[3].pageLabel, "4 / 4");

  const one = buildSuiteRunInputs({ report, caseIds: ["case_1"], agents });
  assert.equal(one.length, 2);
  assert.equal(one[0].summaryTable, undefined);
  assert.match(one[0].docType, /個別実行|SINGLE-CASE/i);

  const partial = buildSuiteRunInputs({
    report: { ...report, partialRun: true, selectedCaseIds: ["case_1"] },
    agents,
    runsById: {
      run_1: {
        id: "run_1",
        summary: { chartCount: 1 },
        events: [
          {
            kind: "text.final_response",
            payload: { parts: ["6月の売上は 120万円です。"] }
          },
          {
            kind: "data.result",
            payload: {
              name: "sales",
              formattedData: [{ month: "6月", amount: 1200000 }]
            }
          },
          {
            kind: "chart.result",
            payload: { mark: "bar", title: "月次売上" }
          }
        ]
      }
    }
  });
  assert.equal(partial.length, 2);
  assert.equal(partial[0].summaryTable, undefined);
  assert.match(partial[1].evidenceBlock, /120万円/);
  assert.match(partial[1].evidenceBlock, /結果テーブル/);
  assert.match(partial[1].evidenceBlock, /チャート: あり/);
  assert.match(partial[0].systemTable, /OK|NG/);
});

test("paginates long acceptance criteria before PDF rendering", () => {
  const manyCriteria = Array.from({ length: 6 }, (_, index) => `受入基準 ${index + 1}`);
  const specInputs = buildCaseSpecInputs({
    suite,
    cases: [
      {
        ...suite.cases[0],
        expectations: {
          ...suite.cases[0].expectations,
          businessRequirements: {
            ...suite.cases[0].expectations.businessRequirements,
            criteriaItems: manyCriteria
          }
        }
      }
    ],
    agents
  });
  assert.equal(specInputs.length, 2);
  assert.match(specInputs[0].sectionBusiness, /1 \/ 2/);
  assert.match(specInputs[1].businessBlock, /受入基準 6/);

  const manyResults = Array.from({ length: 5 }, (_, index) => ({
    criterion: `判定項目 ${index + 1}`,
    mark: index === 4 ? "rain" : "sun",
    reason: `根拠 ${index + 1}`
  }));
  const reportInputs = buildSuiteRunInputs({
    report: {
      ...report,
      caseRuns: [
        {
          ...report.caseRuns[0],
          evaluation: {
            ...report.caseRuns[0].evaluation,
            business: {
              ...report.caseRuns[0].evaluation.business,
              itemResults: manyResults
            }
          }
        }
      ]
    },
    agents
  });
  assert.equal(reportInputs.length, 5);
  assert.match(reportInputs[3].sectionBusiness, /1 \/ 2/);
  assert.match(reportInputs[4].sectionBusiness, /2 \/ 2/);
  assert.equal(reportInputs[4]._businessItems[0].criterion, "判定項目 5");
});

test("app deep-link helpers use the fixed local base URL", () => {
  assert.equal(
    caseEditorUrl("suite_1", "case_a"),
    "http://127.0.0.1:4318/#/suites/suite_1/edit/case_a"
  );
  assert.equal(suiteRunReportUrl("suite_run_9"), "http://127.0.0.1:4318/#/reports/suite_run_9");
  assert.equal(runDetailUrl("run_9"), "http://127.0.0.1:4318/#/runs/run_9");
});

test("pdfFilename sanitizes ids", () => {
  assert.equal(pdfFilename("case", "case/1"), "prismtrail-case-case_1.pdf");
  assert.equal(pdfFilename("cases", "suite_1"), "prismtrail-suite-suite_1-cases.pdf");
  assert.equal(pdfFilename("run", "suite_run_1"), "prismtrail-run-suite_run_1.pdf");
});

test("renderCaseSpecPdf returns a PDF byte stream", async () => {
  const pdf = await renderCaseSpecPdf({ suite, cases: suite.cases, agents });
  const bytes = Buffer.from(pdf);
  assert.ok(bytes.length > 1000);
  assert.equal(bytes.subarray(0, 4).toString("utf8"), "%PDF");
  const latin1 = bytes.toString("latin1");
  assert.match(latin1, /\/URI/);
  assert.match(latin1, /127\.0\.0\.1:4318\/#\/suites\/suite_demo\/edit\/case_1/);
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
});

test("renderSuiteRunPdf returns a PDF and rejects live runs", async () => {
  const pdf = await renderSuiteRunPdf({ report, agents });
  const latin1 = Buffer.from(pdf).toString("latin1");
  assert.equal(Buffer.from(pdf).subarray(0, 4).toString("utf8"), "%PDF");
  assert.match(latin1, /\/URI/);
  assert.match(latin1, /127\.0\.0\.1:4318\/#\/runs\/run_1/);
  const document = await PDFDocument.load(pdf);
  assert.equal(document.getPageCount(), 4);

  await assert.rejects(
    () => renderSuiteRunPdf({ report: { ...report, status: "running" }, agents }),
    /実行中のレポートはPDF出力できません/
  );
});
