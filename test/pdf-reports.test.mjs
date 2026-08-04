import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, PDFName } from "@pdfme/pdf-lib";
import {
  addBrandLogo,
  buildCaseSpecInputs,
  buildSuiteRunInputs,
  caseEditorUrl,
  dataAgentResourceUrl,
  pdfFilename,
  renderCaseSpecPdf,
  renderSuiteRunPdf,
  runDetailUrl,
  suiteEditorUrl,
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
      relatedUrls: ["https://example.com/slack/thread-1"],
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

const agents = [{
  id: "agent_x",
  displayName: "デモAgent",
  resourceName: "projects/demo/locations/global/dataAgents/agent_x"
}];

const report = {
  id: "suite_run_1",
  createdAt: "2026-08-04T01:02:03.000Z",
  suiteId: "suite_demo",
  suiteName: "デモスイート",
  status: "passed",
  aiSummary: {
    status: "succeeded",
    headline: "全ケースで安定した結果",
    comment: "システム要件は安定しています。ビジネス要件には軽微な確認事項があります。",
    strengths: ["SQL生成が安定"],
    concerns: ["期間表現を確認"],
    nextActions: ["対象月を明示して再実行"],
    model: "gemini-2.5-flash"
  },
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

const runFixture = {
  id: "run_1",
  createdAt: "2026-08-04T01:02:03.000Z",
  question: "6月の売上を教えて",
  summary: { chartCount: 0 },
  events: [
    { kind: "data.generated_sql", payload: "SELECT SUM(sales) FROM orders WHERE month = 6" },
    { kind: "text.final_response", payload: { parts: ["6月の売上は 120万円です。"] } }
  ],
  jobs: [
    {
      configuration: {
        query: { query: "SELECT SUM(sales) FROM orders WHERE month = 6" }
      }
    }
  ]
};

test("builds case-spec inputs with checklist and system lines", () => {
  const inputs = buildCaseSpecInputs({ suite, cases: suite.cases, agents });
  assert.equal(inputs.length, 1);
  assert.match(inputs[0].docType, /テストケース仕様書/);
  assert.equal(inputs[0].title, "月次売上");
  assert.match(inputs[0].metaTable, /デモAgent/);
  assert.match(inputs[0].systemTable, /SQL必須/);
  assert.match(inputs[0].businessTable, /売上が数値/);
  assert.equal(inputs[0].specSystemHead0, "項目");
  assert.equal(inputs[0].specCriteriaHead1, "ビジネス要件");
  assert.match(inputs[0].openLink, /ケースを開く/);
  assert.equal(inputs[0].openLinkUrl, caseEditorUrl("suite_demo", "case_1"));
  assert.match(inputs[0].relatedUrls, /https:\/\/example.com\/slack\/thread-1/);
});

test("builds suite-run cover plus case pages, or a single case page", () => {
  const batch = buildSuiteRunInputs({ report, agents, runsById: { run_1: runFixture } });
  assert.equal(batch.length, 6); // cover + index + overview + trace + business + response
  assert.ok(batch[0].summaryTable);
  assert.match(batch[0].heroMetric, /%/);
  assert.match(batch[0].statusPieSvg, /<svg/);
  assert.match(batch[0].gradeBarSvg, /<svg/);
  assert.match(batch[0].caseIndexTable, /月次売上/);
  assert.match(batch[0].caseIndexTable, /6月の売上を教えて/);
  assert.equal(batch[0].overallScoreLabel, "総合等級");
  assert.equal(batch[0].overallScoreValue, "B");
  assert.equal(batch[0].systemScoreValue, "A");
  assert.equal(batch[0].businessScoreValue, "C");
  assert.equal(batch[0].aiSummaryHeadline, "全ケースで安定した結果");
  assert.match(batch[0].aiSummaryComment, /システム要件は安定/);
  assert.equal(batch[0].aiSummaryEyebrow, "サマリー");
  assert.equal(batch[0].gateDecision, undefined);
  assert.equal(batch[0].openLinkUrl, "");
  assert.deepEqual(batch[0]._referenceLinks, [
    dataAgentResourceUrl(agents[0].resourceName),
    suiteEditorUrl("suite_demo"),
    suiteRunReportUrl("suite_run_1")
  ]);
  assert.equal(batch[0].referenceLabel0, "データエージェント");
  assert.equal(batch[0].referenceLabel1, "テストスイート");
  assert.equal(batch[0].referenceLabel2, "テスト実行");
  assert.match(batch[0].footer, /出力日時 .+ ｜  CONFIDENTIAL｜機密情報・外部共有禁止/);
  assert.doesNotMatch(batch[0].footer, /suite_run_/);
  assert.equal(batch[1]._pageKind, "index");
  assert.equal(batch[1].indexSummary, undefined);
  assert.match(batch[1].caseIndexTable, /月次売上/);
  assert.equal(batch[1].indexHeadCaseId, "ケースID");
  assert.equal(batch[1].indexHeadSystem, "システム等級");
  assert.equal(batch[1].indexHeadScore, "総合等級");
  assert.equal(batch[1].indexRowTitle0, "月次売上  ›");
  assert.equal(batch[1].indexRowId0, "case_1");
  assert.equal(batch[1].indexRowPrompt0, "質問: 6月の売上を教えて");
  assert.equal(batch[1].openLink, "");
  assert.equal(batch[1].openLinkUrl, "");
  assert.equal(batch[1].indexRowSystem0, "A");
  assert.equal(batch[1].indexRowScore0, "B");
  assert.equal(batch[2]._pageKind, "case-overview");
  assert.equal(batch[2].sectionStep, "セクション 1 / 3");
  assert.equal(batch[2].sectionName, "判定・評価");
  assert.equal(batch[3]._pageKind, "case-trace");
  assert.equal(batch[4]._pageKind, "case-detail");
  assert.equal(batch[5]._pageKind, "case-evidence");
  assert.match(batch[4].businessTable, /適合|一部適合|不適合/);
  assert.equal(batch[2].systemChecksHead0, "判定");
  assert.equal(batch[4].businessHeadReason, "判定根拠");
  assert.equal(batch[2].openLinkUrl, "");
  assert.match(batch[2].resultBanner, /PASS|FAIL|合格|不合格/);
  assert.equal(batch[5].sectionResponseAnswer, "回答");
  assert.equal(batch[5].sectionResponseData, "結果データ");
  assert.equal(batch[5].sectionResponseChart, "チャート");
  assert.equal(batch[2].docType, "");
  assert.match(batch[2].title, /case_1/);
  assert.match(batch[2].subtitle, /2026-08-04 10:02:03 JST/);
  assert.equal(batch[2].caseOverallValue, "B");
  assert.equal(batch[2].caseSystemValue, "A");
  assert.equal(batch[2].caseBusinessValue, "B");
  assert.match(batch[2].caseOverallNote, /90点/);
  assert.equal(batch[2].resultEyebrow, "");
  assert.equal(batch[2].resultDescriptor, "設定した基準を満たす");
  assert.equal(batch[2].resultGrade, "B");
  assert.equal(batch[2].resultSystemValue, "A");
  assert.equal(batch[2].resultBusinessValue, "B");
  assert.equal(batch[2].resultEvidenceValue, "0 / 0");
  assert.equal(batch[3].userPromptBody, "6月の売上を教えて");
  assert.match(batch[3].userPromptIconSvg, /<svg/);
  assert.match(batch[3].executedSqlIconSvg, /<svg/);
  assert.equal(batch[3].sectionStep, "セクション 2 / 3");
  assert.equal(batch[3].sectionName, "入力・SQL");
  assert.equal(batch[3].traceHeadline, undefined);
  assert.match(batch[3].executedSqlBody, /SELECT SUM\(sales\)/);
  assert.equal(batch[3].executedSqlBody.match(/SELECT/g)?.length, 1);
  assert.match(batch[2].systemPieSvg, /<svg/);
  assert.equal(batch[0].pageLabel, "1 / 6 ページ");
  assert.equal(batch[5].pageLabel, "6 / 6 ページ");
  assert.equal(batch[5].sectionStep, "セクション 3 / 3");
  assert.equal(batch[5].sectionName, "回答・データ・チャート");

  const one = buildSuiteRunInputs({
    report,
    caseIds: ["case_1"],
    agents,
    runsById: { run_1: runFixture }
  });
  assert.equal(one.length, 4);
  assert.equal(one[0].summaryTable, undefined);
  assert.equal(one[0].docType, "");
  assert.equal(one[1]._pageKind, "case-trace");

  const partial = buildSuiteRunInputs({
    report: { ...report, partialRun: true, selectedCaseIds: ["case_1"] },
    agents,
    runsById: {
      run_1: {
        id: "run_1",
        createdAt: "2026-08-04T01:02:03.000Z",
        question: "6月の売上を教えて",
        summary: { chartCount: 1 },
        events: [
          {
            kind: "data.generated_sql",
            payload: "SELECT month, SUM(sales) FROM orders GROUP BY month"
          },
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
  assert.equal(partial.length, 4);
  assert.equal(partial[0].summaryTable, undefined);
  assert.match(partial[1].executedSqlBody, /GROUP BY month/);
  assert.equal(partial[2]._pageKind, "case-detail");
  assert.equal(partial[3]._pageKind, "case-evidence");
  assert.match(partial[3].responseAnswer, /120万円/);
  assert.match(partial[3].sectionResponseData, /結果データ/);
  assert.match(partial[3].sectionResponseChart, /チャート/);
  assert.match(partial[0].systemTable, /適合|不適合/);
  assert.equal(partial[3].responseDataHead0, "month");
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
  assert.equal(reportInputs.length, 6);
  assert.match(reportInputs[4].sectionBusiness, /1 \/ 2/);
  assert.match(reportInputs[5].sectionBusiness, /2 \/ 2/);
  assert.equal(reportInputs[5]._businessItems[0].criterion, "判定項目 4");
  assert.equal(reportInputs[5]._businessItems[1].criterion, "判定項目 5");
});

test("renders zero-evaluation and skipped cases without a misleading pass rate", () => {
  const skippedReport = {
    ...report,
    status: "passed",
    summary: {
      ...report.summary,
      score: 99,
      systemScore: 99,
      businessScore: 99,
      passed: 0,
      total: 1
    },
    caseRuns: [
      {
        caseId: "case_1",
        title: "月次売上",
        status: "skipped",
        runId: null,
        runSummary: { durationMs: 0, totalBytesBilled: 0, sqlCount: 0, chartCount: 0 },
        evaluation: {
          score: null,
          system: { status: "skipped", score: null, checks: [] },
          business: { status: "not_configured", grade: null, score: null, itemResults: [] }
        }
      }
    ]
  };
  const inputs = buildSuiteRunInputs({ report: skippedReport, agents });
  assert.equal(inputs[0].passRateValue, "—");
  assert.equal(inputs[0].overallScoreValue, "—");
  assert.match(inputs[0].aiSummaryHeadline, /全ケースで安定/);
  assert.match(inputs[0].footer, /JST/);
  assert.equal(inputs[2]._notEvaluated, true);
  assert.match(inputs[2].notEvaluatedRow1Col1, /下書き|実行対象|除外/);
  assert.match(inputs[2].notEvaluatedRow2Col1, /合格率の分母から除外/);
});

test("omits the business page when business requirements are not configured", () => {
  const noBusinessReport = structuredClone(report);
  noBusinessReport.caseRuns[0].evaluation.business = {
    status: "not_configured",
    grade: null,
    score: null,
    itemResults: []
  };
  const inputs = buildSuiteRunInputs({
    report: noBusinessReport,
    caseIds: ["case_1"],
    agents,
    runsById: { run_1: runFixture }
  });

  assert.deepEqual(
    inputs.map((input) => input._pageKind),
    ["case-overview", "case-trace", "case-evidence"]
  );
  assert.equal(inputs[0]._hasBusiness, false);
  assert.equal(inputs[0].resultDurationLabel, "実行時間");
});

test("app deep-link helpers use the fixed local base URL", () => {
  assert.equal(
    caseEditorUrl("suite_1", "case_a"),
    "http://127.0.0.1:4318/#/suites/suite_1/edit/case_a"
  );
  assert.equal(suiteRunReportUrl("suite_run_9"), "http://127.0.0.1:4318/#/reports/suite_run_9");
  assert.equal(runDetailUrl("run_9"), "http://127.0.0.1:4318/#/runs/run_9");
  assert.equal(suiteEditorUrl("suite_1"), "http://127.0.0.1:4318/#/suites/suite_1/edit");
  assert.equal(
    dataAgentResourceUrl("projects/demo/locations/global/dataAgents/agent_1"),
    "https://geminidataanalytics.googleapis.com/v1/projects/demo/locations/global/dataAgents/agent_1"
  );
});

test("pdfFilename sanitizes ids", () => {
  assert.equal(pdfFilename("case", "case/1"), "prismtrail-case-case_1.pdf");
  assert.equal(pdfFilename("cases", "suite_1"), "prismtrail-suite-suite_1-cases.pdf");
  assert.equal(pdfFilename("run", "suite_run_1"), "prismtrail-run-suite_run_1.pdf");
});

test("addBrandLogo embeds the official PrismTrail mark", async () => {
  const document = await PDFDocument.create();
  document.addPage([595, 842]);
  const plainPdf = await document.save({ useObjectStreams: false });
  const brandedPdf = await addBrandLogo(plainPdf);

  assert.ok(brandedPdf.length > plainPdf.length + 1000);
  const brandedDocument = await PDFDocument.load(brandedPdf);
  assert.equal(brandedDocument.getPageCount(), 1);
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
  const pdf = await renderSuiteRunPdf({ report, agents, runsById: { run_1: runFixture } });
  const latin1 = Buffer.from(pdf).toString("latin1");
  assert.equal(Buffer.from(pdf).subarray(0, 4).toString("utf8"), "%PDF");
  assert.match(latin1, /\/URI/);
  assert.match(latin1, /\/GoTo/);
  assert.doesNotMatch(latin1, /127\.0\.0\.1:4318\/#\/runs\/run_1/);
  assert.match(latin1, /127\.0\.0\.1:4318\/#\/reports\/suite_run_1/);
  assert.match(latin1, /geminidataanalytics\.googleapis\.com\/v1\/projects\/demo/);
  assert.match(latin1, /127\.0\.0\.1:4318\/#\/suites\/suite_demo\/edit/);
  const document = await PDFDocument.load(pdf);
  assert.equal(document.getPageCount(), 6);
  const pages = document.getPages();
  const overviewAnnotations = pages[2].node.lookup(PDFName.of("Annots"));
  const overviewGoTo = Array.from({ length: overviewAnnotations.size() }, (_, index) =>
    overviewAnnotations.lookup(index)
  ).find((annotation) =>
    annotation
      .lookup(PDFName.of("A"))
      ?.get(PDFName.of("S"))
      ?.toString() === "/GoTo"
  );
  assert.ok(overviewGoTo, "case overview should include a summary navigation annotation");
  const destination = overviewGoTo.lookup(PDFName.of("A")).lookup(PDFName.of("D"));
  assert.equal(destination.get(0), pages[0].ref);

  await assert.rejects(
    () => renderSuiteRunPdf({ report: { ...report, status: "running" }, agents }),
    /実行中のレポートはPDF出力できません/
  );
});

test("fits up to fourteen cases on one compact index page", () => {
  const cases = Array.from({ length: 14 }, (_, index) => ({
    ...suite.cases[0],
    id: `case_${index + 1}`,
    title: `ケース ${index + 1}`,
    prompt: `質問 ${index + 1}`
  }));
  const caseRuns = cases.map((testCase) => ({
    ...report.caseRuns[0],
    caseId: testCase.id,
    title: testCase.title,
    runId: null
  }));
  const inputs = buildSuiteRunInputs({
    report: {
      ...report,
      suiteSnapshot: { cases },
      caseRuns,
      summary: { ...report.summary, total: 14, passed: 14 }
    },
    agents
  });
  const indexPages = inputs.filter((input) => input._pageKind === "index");
  assert.equal(indexPages.length, 1);
  assert.equal(indexPages[0]._caseRows.length, 14);
});
