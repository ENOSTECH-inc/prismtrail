import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderCaseSpecPdf, renderSuiteRunPdf } from "../lib/pdf-reports.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output", "pdf");

const cases = [
  {
    id: "case_revenue_monthly",
    title: "月次売上と前年同月比を正しく回答できる",
    prompt:
      "2026年6月の売上高、前年同月比、主要な増減要因を説明してください。売上推移を月別の棒グラフで示し、参照したテーブルも明記してください。",
    agentId: "agent_finance",
    thinkingMode: "DEEP",
    status: "active",
    memo: "経営会議で利用する主要KPI。金額単位と比較対象期間を必ず確認する。",
    expectations: {
      systemRequirements: {
        requireSql: true,
        requireChart: true,
        maxDurationMs: 120000,
        maxBytesBilled: 5368709120,
        requiredPhrases: ["売上高", "前年同月比"],
        requiredSqlTables: ["analytics.fact_revenue", "analytics.dim_calendar"]
      },
      businessRequirements: {
        enabled: true,
        passingGrade: "B",
        criteriaItems: [
          "2026年6月の売上高が1億2,450万円と回答されている",
          "前年同月比が+8.4%であることが明記されている",
          "主要な増加要因としてエンタープライズ契約の更新が説明されている"
        ]
      }
    }
  },
  {
    id: "case_active_customers",
    title: "アクティブ顧客数の定義と値を説明できる",
    prompt: "直近四半期の月次アクティブ顧客数を集計し、定義とともに説明してください。",
    agentId: "agent_finance",
    thinkingMode: "FAST",
    status: "active",
    memo: "顧客数は契約単位ではなく請求アカウント単位。",
    expectations: {
      systemRequirements: {
        requireSql: true,
        requireChart: false,
        maxDurationMs: 90000,
        requiredSqlTables: ["analytics.fact_customer_activity"]
      },
      businessRequirements: {
        enabled: true,
        passingGrade: "B",
        criteriaItems: [
          "アクティブ顧客の定義が30日以内に利用実績のある請求アカウントである",
          "2026年6月のアクティブ顧客数が2,184社である"
        ]
      }
    }
  },
  {
    id: "case_churn_rate",
    title: "解約率の分母を誤らずに算出できる",
    prompt: "2026年第2四半期のロゴチャーン率を算出してください。",
    agentId: "agent_finance",
    thinkingMode: "FAST",
    status: "active",
    memo: "期首顧客数を分母とする。",
    expectations: {
      systemRequirements: {
        requireSql: true,
        requireChart: false,
        maxDurationMs: 90000
      },
      businessRequirements: {
        enabled: true,
        passingGrade: "B",
        criteriaItems: ["期首顧客数を分母としている", "四半期ロゴチャーン率が2.1%である"]
      }
    }
  },
  {
    id: "case_pipeline",
    title: "営業パイプラインをステージ別に可視化できる",
    prompt: "今四半期の営業パイプラインをステージ別に可視化してください。",
    agentId: "agent_sales",
    thinkingMode: "FAST",
    status: "active",
    memo: "",
    expectations: {
      systemRequirements: { requireSql: true, requireChart: true, maxDurationMs: 90000 },
      businessRequirements: {
        enabled: true,
        criteriaItems: ["ステージ別の金額と案件数が表示されている"]
      }
    }
  },
  {
    id: "case_draft_forecast",
    title: "来四半期の売上予測を説明できる",
    prompt: "来四半期の売上を予測してください。",
    agentId: "agent_finance",
    thinkingMode: "DEEP",
    status: "draft",
    memo: "予測ロジックのレビュー完了後に有効化する。",
    expectations: {
      systemRequirements: { requireSql: true, requireChart: true },
      businessRequirements: { enabled: false, criteriaItems: [] }
    }
  }
];

const suite = {
  id: "suite_executive_metrics",
  name: "経営指標データエージェント 回帰テスト",
  description: "経営会議で利用する主要指標の正確性、再現性、説明品質を検証します。",
  cases
};

const agents = [
  { id: "agent_finance", displayName: "Finance Analytics Agent" },
  { id: "agent_sales", displayName: "Sales Intelligence Agent" }
];

function makeEvaluation({
  status,
  score,
  systemScore,
  grade,
  businessScore,
  businessStatus = "passed",
  failedCheck = false,
  summary,
  items
}) {
  return {
    score,
    status,
    system: {
      status: failedCheck ? "failed" : "passed",
      score: systemScore,
      checks: [
        { id: "sql", passed: true, label: "SQLが生成され、実行に成功した" },
        { id: "table", passed: true, label: "必須SQLテーブルを参照した" },
        { id: "chart", passed: !failedCheck, label: "指定された図表が生成された" },
        { id: "latency", passed: true, label: "最大実行時間以内に完了した" },
        { id: "budget", passed: true, label: "課金上限以内で完了した" }
      ]
    },
    business: {
      status: businessStatus,
      grade,
      score: businessScore,
      summary,
      itemResults: items
    }
  };
}

const report = {
  id: "suite_run_20260731_093000",
  suiteId: suite.id,
  suiteName: suite.name,
  status: "failed",
  startedAt: "2026-07-31T00:30:00.000Z",
  completedAt: "2026-07-31T00:34:32.000Z",
  summary: {
    score: 76,
    systemScore: 88,
    businessScore: 71,
    passed: 2,
    failed: 1,
    reviewRequired: 1,
    skipped: 1,
    total: 5,
    totalDurationMs: 272000,
    totalBytesBilled: 4138270720,
    accuracyGrades: { A: 1, B: 1, C: 1, D: 0 }
  },
  suiteSnapshot: { ...suite },
  caseRuns: [
    {
      caseId: cases[0].id,
      title: cases[0].title,
      status: "passed",
      runId: "run_revenue_01",
      runSummary: {
        durationMs: 48200,
        totalBytesBilled: 734003200,
        sqlCount: 2,
        chartCount: 1
      },
      evaluation: makeEvaluation({
        status: "passed",
        score: 96,
        systemScore: 100,
        grade: "A",
        businessScore: 94,
        summary: "期待値、比較期間、増減要因のすべてを明確に説明しています。",
        items: [
          {
            criterion: "2026年6月の売上高が1億2,450万円と回答されている",
            mark: "sun",
            reason: "回答本文と集計テーブルの双方で1億2,450万円を確認しました。"
          },
          {
            criterion: "前年同月比が+8.4%であることが明記されている",
            mark: "sun",
            reason: "比較期間と計算結果が明示されています。"
          },
          {
            criterion: "主要な増加要因としてエンタープライズ契約の更新が説明されている",
            mark: "sun",
            reason: "主要因と寄与額が説明されています。"
          }
        ]
      })
    },
    {
      caseId: cases[1].id,
      title: cases[1].title,
      status: "passed",
      runId: "run_customers_01",
      runSummary: {
        durationMs: 36900,
        totalBytesBilled: 419430400,
        sqlCount: 1,
        chartCount: 0
      },
      evaluation: makeEvaluation({
        status: "passed",
        score: 84,
        systemScore: 100,
        grade: "B",
        businessScore: 79,
        summary: "値は正確ですが、定義の説明がやや簡潔です。",
        items: [
          {
            criterion: "アクティブ顧客の定義が30日以内に利用実績のある請求アカウントである",
            mark: "cloud",
            reason: "30日以内の利用実績は説明されていますが、請求アカウント単位の明記が弱いです。"
          },
          {
            criterion: "2026年6月のアクティブ顧客数が2,184社である",
            mark: "sun",
            reason: "回答本文と結果テーブルの値が一致しています。"
          }
        ]
      })
    },
    {
      caseId: cases[2].id,
      title: cases[2].title,
      status: "failed",
      runId: "run_churn_01",
      runSummary: {
        durationMs: 87200,
        totalBytesBilled: 2147483648,
        sqlCount: 1,
        chartCount: 0
      },
      evaluation: makeEvaluation({
        status: "failed",
        score: 42,
        systemScore: 70,
        grade: "C",
        businessScore: 35,
        businessStatus: "failed",
        failedCheck: true,
        summary: "算出値と分母の定義に確認が必要です。",
        items: [
          {
            criterion: "期首顧客数を分母としている",
            mark: "rain",
            reason: "期末顧客数を分母としており、定義と一致しません。"
          },
          {
            criterion: "四半期ロゴチャーン率が2.1%である",
            mark: "cloud",
            reason: "回答は2.3%で、許容範囲を超えています。"
          }
        ]
      })
    },
    {
      caseId: cases[3].id,
      title: cases[3].title,
      status: "review_required",
      runId: "run_pipeline_01",
      runSummary: {
        durationMs: 99700,
        totalBytesBilled: 838860800,
        sqlCount: 2,
        chartCount: 1
      },
      evaluation: makeEvaluation({
        status: "review_required",
        score: 64,
        systemScore: 82,
        grade: null,
        businessScore: null,
        businessStatus: "review_required",
        summary: "業務判定モデルが一時的に利用できなかったため、人による確認が必要です。",
        items: []
      })
    },
    {
      caseId: cases[4].id,
      title: cases[4].title,
      status: "skipped",
      runId: null,
      runSummary: { durationMs: 0, totalBytesBilled: 0, sqlCount: 0, chartCount: 0 },
      evaluation: {
        status: "skipped",
        score: null,
        system: { status: "skipped", score: null, checks: [] },
        business: { status: "not_configured", grade: null, score: null, itemResults: [] }
      }
    }
  ]
};

const runsById = {
  run_revenue_01: {
    id: "run_revenue_01",
    summary: { chartCount: 1 },
    events: [
      {
        kind: "text.final_response",
        payload: {
          parts: [
            "2026年6月の売上高は1億2,450万円で、前年同月比は+8.4%でした。主な増加要因はエンタープライズ契約の更新と新規大型案件の稼働です。売上の定義は請求確定額（税抜）で、キャンセル済み取引を除外しています。"
          ]
        }
      },
      {
        kind: "data.result",
        payload: {
          name: "monthly_revenue",
          formattedData: [
            { month: "2026-04", revenue: "¥108,420,000", yoy: "+5.1%" },
            { month: "2026-05", revenue: "¥115,800,000", yoy: "+6.7%" },
            { month: "2026-06", revenue: "¥124,500,000", yoy: "+8.4%" }
          ]
        }
      },
      { kind: "chart.result", payload: { mark: "bar", title: "月次売上高と前年同月比" } }
    ]
  },
  run_customers_01: {
    id: "run_customers_01",
    events: [
      {
        kind: "text.final_response",
        payload: { parts: ["2026年6月の月次アクティブ顧客数は2,184社です。"] }
      }
    ]
  },
  run_churn_01: {
    id: "run_churn_01",
    events: [
      {
        kind: "text.final_response",
        payload: {
          parts: [
            "2026年第2四半期のロゴチャーン率は2.3%です。四半期末の顧客数を分母に算出しました。"
          ]
        }
      }
    ]
  },
  run_pipeline_01: {
    id: "run_pipeline_01",
    events: [
      {
        kind: "text.final_response",
        payload: { parts: ["今四半期の営業パイプラインをステージ別に集計しました。"] }
      }
    ]
  }
};

await mkdir(outputDir, { recursive: true });

const casePdf = await renderCaseSpecPdf({
  suite,
  cases: [cases[0], cases[1]],
  agents
});
const reportPdf = await renderSuiteRunPdf({ report, agents, runsById });
const singleCasePdf = await renderSuiteRunPdf({
  report,
  caseIds: [cases[0].id],
  agents,
  runsById
});

const casePath = path.join(outputDir, "prismtrail-case-spec-sample.pdf");
const reportPath = path.join(outputDir, "prismtrail-suite-run-sample.pdf");
const singleCasePath = path.join(outputDir, "prismtrail-single-case-result-sample.pdf");
await Promise.all([
  writeFile(casePath, casePdf),
  writeFile(reportPath, reportPdf),
  writeFile(singleCasePath, singleCasePdf)
]);

console.log(casePath);
console.log(reportPath);
console.log(singleCasePath);
