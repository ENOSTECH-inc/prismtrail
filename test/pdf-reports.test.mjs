import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "@pdfme/pdf-lib";
import {
  buildCaseSpecInputs,
  buildSuiteRunInputs,
  caseEditorUrl,
  pdfFilename,
  renderChartSpecToSvg,
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
      runSummary: {
        durationMs: 1200,
        totalBytesBilled: 2048,
        sqlCount: 1,
        chartCount: 1
      },
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

const runWithEvidence = {
  id: "run_1",
  summary: { sqlCount: 1, chartCount: 1 },
  events: [
    {
      kind: "text.final_response",
      payload: {
        parts: [
          "# 売上結果\n\n2026年6月の売上は **120万円** です。\n\n- 前月比: +8%\n- 対象期間: 2026年6月"
        ]
      }
    },
    {
      kind: "data.generated_sql",
      payload: "SELECT month, SUM(amount) AS revenue\nFROM marts_core.fact\nWHERE month = '2026-06'\nGROUP BY month"
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
      payload: {
        vegaConfig: {
          $schema: "https://vega.github.io/schema/vega-lite/v6.json",
          mark: "bar",
          title: "月次売上",
          data: {
            values: [
              { month: "4月", amount: 90 },
              { month: "5月", amount: 110 },
              { month: "6月", amount: 120 }
            ]
          },
          encoding: {
            x: { field: "month", type: "ordinal", title: "月" },
            y: { field: "amount", type: "quantitative", title: "売上（万円）" }
          }
        }
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
  assert.equal(inputs[0].specCriteriaHead1, "受入基準");
  assert.match(inputs[0].openLink, /ケースを開く/);
  assert.equal(inputs[0].openLinkUrl, caseEditorUrl("suite_demo", "case_1"));
});

test("builds suite-run cover plus case pages, or a single case page", () => {
  const batch = buildSuiteRunInputs({ report, agents, runsById: { run_1: runWithEvidence } });
  assert.equal(batch.length, 7); // cover + index + overview + business + answer + SQL + chart
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
  assert.equal(batch[4]._pageKind, "case-answer");
  assert.equal(batch[5]._pageKind, "case-sql");
  assert.equal(batch[6]._pageKind, "case-chart");
  assert.match(batch[3].businessTable, /適合|一部適合|不適合/);
  assert.equal(batch[2].systemChecksHead0, "判定");
  assert.equal(batch[3].businessHeadReason, "判定根拠");
  assert.equal(batch[2].openLinkUrl, runDetailUrl("run_1"));
  assert.match(batch[2].resultBanner, /PASS|FAIL|合格|不合格/);
  assert.match(batch[3].evidenceBlock, /回答|結果テーブル|図表/);
  assert.match(batch[2].systemPieSvg, /<svg/);
  assert.match(batch[4].fullText, /■ 売上結果/);
  assert.doesNotMatch(batch[4].fullText, /\*\*120万円\*\*/);
  assert.match(batch[5].fullText, /SELECT month, SUM\(amount\)/);
  assert.equal(batch[5]._sourceText, runWithEvidence.events[1].payload);
  assert.deepEqual(batch[6]._chartSpec.data.values, [
    { month: "4月", amount: 90 },
    { month: "5月", amount: 110 },
    { month: "6月", amount: 120 }
  ]);
  assert.equal(batch[0].pageLabel, "1 / 7 ページ");
  assert.equal(batch[6].pageLabel, "7 / 7 ページ");

  const one = buildSuiteRunInputs({
    report,
    caseIds: ["case_1"],
    agents,
    runsById: { run_1: runWithEvidence }
  });
  assert.equal(one.length, 5);
  assert.equal(one[0].summaryTable, undefined);
  assert.match(one[0].docType, /個別テスト結果/);

  const partial = buildSuiteRunInputs({
    report: { ...report, partialRun: true, selectedCaseIds: ["case_1"] },
    agents,
    runsById: {
      run_1: {
        id: "run_1",
        ...runWithEvidence
      }
    }
  });
  assert.equal(partial.length, 5);
  assert.equal(partial[0].summaryTable, undefined);
  assert.match(partial[1].evidenceAnswer, /後続/);
  assert.match(partial[1].evidenceBlock, /結果テーブル/);
  assert.match(partial[1].evidenceBlock, /図表: あり/);
  assert.match(partial[0].systemTable, /適合|不適合/);
  assert.equal(partial[1].evidenceDataHead0, "month");
  assert.match(partial[2].fullText, /120万円/);
  assert.match(partial[3].fullText, /GROUP BY month/);
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

  const configuredFive = Array.from({ length: 5 }, (_, index) => `受け入れ基準 ${index + 1}`);
  const evaluatedTwo = configuredFive.slice(0, 2).map((criterion, index) => ({
    criterion,
    mark: "sun",
    reason: `根拠 ${index + 1}`
  }));
  const fiveCriteriaCase = {
    ...suite.cases[0],
    expectations: {
      ...suite.cases[0].expectations,
      businessRequirements: {
        ...suite.cases[0].expectations.businessRequirements,
        criteriaItems: configuredFive
      }
    }
  };
  const reportInputs = buildSuiteRunInputs({
    report: {
      ...report,
      suiteSnapshot: { cases: [fiveCriteriaCase] },
      caseRuns: [
        {
          ...report.caseRuns[0],
          evaluation: {
            ...report.caseRuns[0].evaluation,
            business: {
              ...report.caseRuns[0].evaluation.business,
              itemResults: evaluatedTwo
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
  assert.equal(reportInputs[4]._businessItems[0].criterion, "受け入れ基準 4");
  assert.equal(reportInputs[4]._businessItems[1].criterion, "受け入れ基準 5");
  assert.equal(reportInputs[4]._businessItems[0].label, "未評価");
  assert.match(reportInputs[4]._businessItems[0].reason, /判定結果が記録されていません/);
  assert.match(reportInputs[2].checkSummaryRow1Col4, /3/);
});

test("paginates full Markdown answers and SQL without ellipsis", () => {
  const answerLines = Array.from(
    { length: 90 },
    (_, index) => `- 回答明細 ${String(index + 1).padStart(3, "0")}：省略禁止の検証テキスト`
  );
  const sqlLines = Array.from(
    { length: 120 },
    (_, index) => `SELECT ${String(index + 1).padStart(3, "0")} AS sequence_number;`
  );
  const longRun = {
    id: "run_1",
    summary: { sqlCount: 120, chartCount: 0 },
    events: [
      {
        kind: "text.final_response",
        payload: { parts: [`# 完全回答\n\n${answerLines.join("\n")}`] }
      },
      {
        kind: "data.generated_sql",
        payload: sqlLines.join("\n")
      }
    ]
  };
  const inputs = buildSuiteRunInputs({
    report: {
      ...report,
      caseRuns: [
        {
          ...report.caseRuns[0],
          runSummary: {
            ...report.caseRuns[0].runSummary,
            sqlCount: 120,
            chartCount: 0
          }
        }
      ]
    },
    agents,
    runsById: { run_1: longRun }
  });
  const answerPages = inputs.filter((input) => input._pageKind === "case-answer");
  const sqlPages = inputs.filter((input) => input._pageKind === "case-sql");
  assert.ok(answerPages.length >= 3);
  assert.ok(sqlPages.length >= 3);
  const renderedAnswer = answerPages.map((input) => input.fullText).join("\n");
  const renderedSql = sqlPages.map((input) => input.fullText).join("\n");
  assert.match(renderedAnswer, /■ 完全回答/);
  assert.match(renderedAnswer, /回答明細 001/);
  assert.match(renderedAnswer, /回答明細 090/);
  assert.match(renderedSql, /SELECT 001 AS sequence_number/);
  assert.match(renderedSql, /SELECT 120 AS sequence_number/);
  assert.doesNotMatch(renderedAnswer, /…/);
  assert.doesNotMatch(renderedSql, /…/);
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
  assert.match(inputs[0].gateDecision, /判定不能/);
  assert.match(inputs[0].footer, /JST/);
  assert.equal(inputs[2]._notEvaluated, true);
  assert.match(inputs[2].notEvaluatedRow1Col1, /下書き|実行対象|除外/);
  assert.match(inputs[2].notEvaluatedRow2Col1, /合格率の分母から除外/);
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
  const pdf = await renderSuiteRunPdf({
    report,
    agents,
    runsById: { run_1: runWithEvidence }
  });
  const latin1 = Buffer.from(pdf).toString("latin1");
  assert.equal(Buffer.from(pdf).subarray(0, 4).toString("utf8"), "%PDF");
  assert.match(latin1, /\/URI/);
  assert.match(latin1, /127\.0\.0\.1:4318\/#\/runs\/run_1/);
  const document = await PDFDocument.load(pdf);
  assert.equal(document.getPageCount(), 7);

  await assert.rejects(
    () => renderSuiteRunPdf({ report: { ...report, status: "running" }, agents }),
    /実行中のレポートはPDF出力できません/
  );
  await assert.rejects(
    () => renderSuiteRunPdf({ report, agents }),
    /必須項目を省略せずPDF出力できません/
  );
});

test("renders an inline Vega-Lite chart as SVG", async () => {
  const svg = await renderChartSpecToSvg(runWithEvidence.events[3].payload.vegaConfig);
  assert.match(svg, /^<svg/);
  assert.match(svg, /月次売上/);
  assert.match(svg, /role-mark/);
});
