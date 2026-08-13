import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { markdownToSafeHtml, renderHtmlReport } from "../lib/html-reports.mjs";

function fixture() {
  const report = {
    id: "suite_run_html",
    status: "completed",
    completedAt: "2026-08-13T00:00:00.000Z",
    suiteSnapshot: {
      name: "HTML report suite",
      cases: [
        { id: "case_one", title: "Unsafe <img src=x onerror=alert(1)>", prompt: "質問 <script>alert(2)</script>" },
        { id: "case_two", title: "Second case", prompt: "二件目" }
      ]
    },
    caseRuns: [
      { caseId: "case_one", title: "Unsafe", status: "passed", runId: "run_one", evaluation: { score: 100, system: { score: 100, checks: [] } } },
      { caseId: "case_two", title: "Second", status: "failed", runId: "run_two", evaluation: { score: 70, system: { score: 70, checks: [{ passed: false, label: "SQL" }] } } }
    ]
  };
  const maliciousRun = {
    question: "保存された質問 <script>alert(6)</script>",
    agentLabel: "売上分析 Agent",
    summary: { durationMs: 2345 },
    events: [
      { kind: "text.progress", label: "進捗", payload: { parts: ["データを集計しています"] } },
      { kind: "text.thought", label: "エージェント思考", payload: { parts: ["地域差を比較します <img src=x onerror=alert(7)>"] } },
      { kind: "analysis.planner_reasoning", label: "分析計画", payload: "売上推移と前年差を確認します" },
      { kind: "analysis.result_natural_language", label: "分析結果", payload: "東日本の伸びが全体を牽引しました" },
      { kind: "analysis.code", label: "Pythonコード", payload: "print('<script>alert(8)</script>')" },
      { kind: "text.final_response", payload: { parts: ["# 回答\n<script>alert(3)</script>\n**安全に表示**"] } },
      { kind: "data.result", payload: { name: "result", formattedData: [{ label: "<svg onload=alert(4)>", value: "=1+1" }] } },
      { kind: "data.result", payload: { name: "地域別", formattedData: [{ region: "東日本", sales: 120 }] } },
      { kind: "chart.result", payload: { mark: "bar", data: { values: [{ x: "A", y: 1 }] }, encoding: { x: { field: "x" }, y: { field: "y", type: "quantitative" }, href: { value: "data:text/html,<script>alert(9)</script>" } } } },
      { kind: "text.followup_questions", label: "フォローアップ候補", payload: { parts: ["西日本の内訳も確認しますか？"] } },
      { kind: "data.generated_sql", payload: "SELECT '<script>alert(5)</script>'" }
    ]
  };
  return { report, runsById: { run_one: maliciousRun, run_two: maliciousRun } };
}

test("single HTML report renders the imported design and escapes all untrusted text", async () => {
  const { report, runsById } = fixture();
  const result = await renderHtmlReport({ report, caseIds: ["case_one"], runsById });
  assert.equal(result.filename, "prismtrail-case-case_one.html");
  assert.match(result.html, /分析レポート/);
  assert.match(result.html, /保存された質問 &lt;script&gt;alert\(6\)&lt;\/script&gt;/);
  assert.match(result.html, /分析コメント/);
  assert.match(result.html, /データを集計しています/);
  assert.match(result.html, /売上推移と前年差を確認します/);
  assert.match(result.html, /東日本の伸びが全体を牽引しました/);
  assert.match(result.html, /Pythonコード/);
  assert.match(result.html, /西日本の内訳も確認しますか？/);
  assert.match(result.html, /地域別/);
  assert.match(result.html, /Data Agent 応答JSON/);
  assert.match(result.html, /text\.thought/);
  assert.match(result.html, /テーブル<\/span>\s*<span class="meta-value">2件/);
  assert.match(result.html, /&lt;script&gt;alert\(3\)&lt;\/script&gt;/);
  assert.match(result.html, /&lt;svg onload=alert\(4\)&gt;/);
  assert.doesNotMatch(result.html, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(result.html, /<script>alert\([23456789]\)<\/script>/);
  const chartData = result.html.match(/<img src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/)?.[1];
  assert.ok(chartData);
  const chartSvg = Buffer.from(chartData, "base64").toString("utf8");
  assert.doesNotMatch(chartSvg, /<a\b|href=|xlink:href=|data:text\/html|<script/i);
  assert.match(result.html, /headers\.map\(csvCell\)/);
  assert.doesNotMatch(result.html, /総合グレード|システム要件|ビジネス要件|判定:/);
});

test("integrated HTML embeds each generated single report and keeps inner frames sandboxed", async () => {
  const { report, runsById } = fixture();
  const result = await renderHtmlReport({ report, runsById });
  assert.equal(result.filename, "prismtrail-run-suite_run_html.html");
  assert.match(result.html, /2 件のData Agent分析を統合/);
  assert.match(result.html, /Data Agent分析/);
  assert.match(result.html, /sandbox="allow-scripts allow-downloads"/);
  assert.doesNotMatch(result.html, /allow-same-origin/);
  const encoded = result.html.match(/data-b64="([A-Za-z0-9+/=]+)"/)?.[1];
  assert.ok(encoded);
  const single = Buffer.from(encoded, "base64").toString("utf8");
  assert.match(single, /prismtrail-case_one\.csv/);
  assert.match(single, /&lt;script&gt;alert\(3\)&lt;\/script&gt;/);
});

test("markdown conversion never treats source HTML as trusted markup", () => {
  const html = markdownToSafeHtml("## title\n<script src=x></script>\n- **ok**");
  assert.match(html, /<h2>title<\/h2>/);
  assert.match(html, /&lt;script src=x&gt;&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script src=x>/);
});

test("single report omits empty optional response sections", async () => {
  const { report } = fixture();
  const result = await renderHtmlReport({
    report,
    caseIds: ["case_one"],
    runsById: {
      run_one: {
        question: "最小レスポンス",
        events: [{ kind: "text.final_response", payload: { parts: ["回答だけです。"] } }]
      }
    }
  });
  assert.match(result.html, /回答だけです。/);
  assert.doesNotMatch(result.html, /href="#sec-datatable"|href="#sec-charts"|href="#sec-analysis"|href="#sec-followups"|href="#sec-appendix"/);
});

test("reports include only cases with a persisted Data Agent response", async () => {
  const { report, runsById } = fixture();
  const result = await renderHtmlReport({ report, runsById: { run_one: runsById.run_one } });
  assert.equal(result.filename, "prismtrail-case-case_one.html");
  assert.doesNotMatch(result.html, /Second case/);
  await assert.rejects(
    renderHtmlReport({ report, caseIds: ["case_two"], runsById: {} }),
    (error) => error?.status === 404 && /Data Agent応答/.test(error.message)
  );
});
