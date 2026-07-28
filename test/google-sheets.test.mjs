import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDelimitedText,
  parseSpreadsheetId,
  pastedTextToSuiteInput,
  REPORT_DISPLAY_HEADERS,
  reportToRows,
  rowsToSuiteInput,
  SUITE_DISPLAY_HEADERS,
  suiteToRows
} from "../lib/google-sheets.mjs";

test("parseSpreadsheetId accepts a Sheets URL and raw id", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
  assert.equal(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  assert.equal(parseSpreadsheetId(id), id);
  assert.throws(() => parseSpreadsheetId("https://example.com/not-a-sheet"), /URLまたはSpreadsheet ID/);
});

test("suite format round-trips through fixed rows", () => {
  const source = {
    id: "suite_1",
    name: "営業分析",
    description: "実業務テスト",
    status: "active",
    knowledgeSourceIds: ["knowledge_1"],
    cases: [
      {
        id: "case_1",
        title: "月次売上",
        prompt: "Show monthly sales.",
        agentId: "agent_1",
        thinkingMode: "THINKING",
        knowledgeSourceIds: ["knowledge_2"],
        expectations: {
          requireSql: true,
          requireChart: true,
          maxDurationMs: 120000,
          maxBytesBilled: 1048576,
          requiredPhrases: ["sales", "month"],
          businessRequirements: {
            enabled: true,
            accuracyCriteria: "2026年6月の売上は65,200円",
            passingGrade: "B"
          }
        }
      }
    ]
  };
  const rows = suiteToRows(source);
  assert.equal(SUITE_DISPLAY_HEADERS[10], "ビジネス要件の検証内容（自然言語）");
  assert.match(rows[8][1], /コピー範囲/);
  assert.deepEqual(rows[9], SUITE_DISPLAY_HEADERS);
  const parsed = rowsToSuiteInput(rows);
  assert.equal(parsed.sourceSuiteId, source.id);
  assert.equal(parsed.name, source.name);
  assert.equal(parsed.cases[0].thinkingMode, "THINKING");
  assert.deepEqual(parsed.cases[0].expectations.requiredPhrases, ["sales", "month"]);
  assert.equal(parsed.cases[0].expectations.businessRequirements.accuracyCriteria, "2026年6月の売上は65,200円");
  assert.deepEqual(parsed.cases[0].knowledgeSourceIds, ["knowledge_2"]);
});

test("legacy accuracy header remains import-compatible", () => {
  const rows = suiteToRows({
    id: "suite_1",
    name: "営業分析",
    cases: [{
      id: "case_1",
      title: "月次売上",
      prompt: "Show monthly sales.",
      agentId: "agent_1",
      expectations: {
        businessRequirements: {
          enabled: true,
          accuracyCriteria: "売上は65,200円"
        }
      }
    }]
  });
  rows[9][10] = "精度条件（自然言語）";
  assert.equal(
    rowsToSuiteInput(rows).cases[0].expectations.businessRequirements.accuracyCriteria,
    "売上は65,200円"
  );
});

test("suite import rejects a changed header contract", () => {
  const rows = suiteToRows({ id: "suite_1", name: "Suite", cases: [] });
  rows[9][2] = "不正な列";
  assert.throws(() => rowsToSuiteInput(rows), /列定義を変更しないでください/);
});

test("suite import ignores empty checkbox template rows", () => {
  const rows = suiteToRows({
    id: "suite_1",
    name: "Suite",
    cases: [
      {
        id: "case_1",
        title: "Case",
        prompt: "Prompt",
        agentId: "agent_1",
        expectations: { requireSql: true, requireChart: false }
      }
    ]
  });
  rows.push(["", "", "", "", "", false, false, "", ""]);
  assert.equal(rowsToSuiteInput(rows).cases.length, 1);
});

test("full Google Sheets TSV paste round-trips a suite", () => {
  const source = {
    id: "suite_1",
    name: "営業分析",
    status: "active",
    cases: [{
      id: "case_1",
      title: "月次売上",
      prompt: "Show monthly sales.",
      agentId: "agent_1",
      expectations: { requireSql: true, requireChart: true }
    }]
  };
  const text = suiteToRows(source).map((row) => row.join("\t")).join("\n");
  const imported = pastedTextToSuiteInput(text);
  assert.equal(imported.format, "full");
  assert.equal(imported.delimiter, "tsv");
  assert.equal(imported.suite.sourceSuiteId, source.id);
  assert.equal(imported.suite.cases[0].title, "月次売上");
});

test("CSV paste supports quoted commas and embedded newlines", () => {
  const parsed = parseDelimitedText('title,prompt\n"Sales, monthly","line 1\nline 2"\n');
  assert.equal(parsed.delimiter, "csv");
  assert.deepEqual(parsed.rows, [
    ["title", "prompt"],
    ["Sales, monthly", "line 1\nline 2"]
  ]);
});

test("case-table TSV paste preserves target suite metadata", () => {
  const targetSuite = {
    id: "suite_1",
    name: "既存スイート",
    description: "保持する説明",
    status: "active",
    knowledgeSourceIds: ["knowledge_1"],
    cases: []
  };
  const caseRow = [
    "case_1", "月次売上", "Show monthly sales.", "agent_1", "FAST",
    "TRUE", "TRUE", "120000", "0", "sales", ""
  ];
  const text = [SUITE_DISPLAY_HEADERS, caseRow].map((row) => row.join("\t")).join("\n");
  const imported = pastedTextToSuiteInput(text, { targetSuite });
  assert.equal(imported.format, "table-with-header");
  assert.equal(imported.suite.name, targetSuite.name);
  assert.equal(imported.suite.description, targetSuite.description);
  assert.deepEqual(imported.suite.knowledgeSourceIds, ["knowledge_1"]);
  assert.equal(imported.suite.cases[0].agentId, "agent_1");
});

test("full sheet paste can target the currently edited suite and preserve its metadata", () => {
  const source = {
    id: "suite_from_sheet",
    name: "シート上の名前",
    description: "シート上の説明",
    status: "active",
    knowledgeSourceIds: ["knowledge_from_sheet"],
    cases: [{
      id: "case_1",
      title: "月次売上",
      prompt: "Show monthly sales.",
      agentId: "agent_1",
      expectations: { requireSql: true }
    }]
  };
  const targetSuite = {
    id: "suite_in_editor",
    name: "編集中のスイート",
    description: "保持する説明",
    status: "draft",
    knowledgeSourceIds: ["knowledge_current"],
    cases: []
  };
  const text = suiteToRows(source).map((row) => row.join("\t")).join("\n");
  const imported = pastedTextToSuiteInput(text, {
    targetSuite,
    preferTargetSuite: true,
    includeSuiteMetadata: false
  });
  assert.equal(imported.suite.sourceSuiteId, targetSuite.id);
  assert.equal(imported.suite.name, targetSuite.name);
  assert.equal(imported.suite.description, targetSuite.description);
  assert.equal(imported.suite.status, targetSuite.status);
  assert.deepEqual(imported.suite.knowledgeSourceIds, targetSuite.knowledgeSourceIds);
  assert.equal(imported.suite.cases[0].title, "月次売上");
});

test("blank suite may import metadata from a full pasted sheet", () => {
  const source = {
    id: "suite_from_sheet",
    name: "インポートする名前",
    description: "インポートする説明",
    cases: []
  };
  const targetSuite = { id: "suite_blank", name: "新しいテストスイート", cases: [] };
  const text = suiteToRows(source).map((row) => row.join("\t")).join("\n");
  const imported = pastedTextToSuiteInput(text, {
    targetSuite,
    preferTargetSuite: true,
    includeSuiteMetadata: true
  });
  assert.equal(imported.suite.sourceSuiteId, targetSuite.id);
  assert.equal(imported.suite.name, source.name);
  assert.equal(imported.suite.description, source.description);
});

test("case-row paste requires a selected target suite", () => {
  assert.throws(
    () => pastedTextToSuiteInput("case_1\tTitle\tPrompt\tagent_1"),
    /更新対象のテストスイートを選択/
  );
});

test("paste parser rejects an unclosed quoted cell", () => {
  assert.throws(() => parseDelimitedText('title,prompt\n"broken,value'), /引用符が閉じられていない/);
});

test("report format contains stable metadata and case rows", () => {
  const rows = reportToRows({
    id: "suite_run_1",
    suiteId: "suite_1",
    suiteName: "営業分析",
    status: "passed",
    summary: { score: 96, systemScore: 90, businessScore: 100, passRate: 100 },
    caseRuns: [
      {
        caseId: "case_1",
        title: "月次売上",
        status: "passed",
        runId: "run_1",
        runSummary: { durationMs: 800, totalBytesBilled: 1024 },
        evaluation: {
          score: 100,
          checks: [{ passed: true, label: "SQLを生成" }],
          system: { status: "passed", score: 100, checks: [{ passed: true, label: "SQLを生成" }] },
          business: {
            status: "passed",
            grade: "A",
            symbol: "◎",
            score: 100,
            summary: "完全一致",
            expectedCriteria: "売上は65,200円",
            evidence: [{ quote: "65,200円", explanation: "一致" }],
            judgeAudit: { model: "gemini-2.5-flash-lite" }
          }
        }
      }
    ]
  });
  assert.match(rows[14][1], /紫色の列/);
  assert.equal(rows[12][1], 100);
  assert.equal(REPORT_DISPLAY_HEADERS[7], "ビジネス評価 (A/B/C/D)");
  assert.equal(REPORT_DISPLAY_HEADERS[12], "ビジネス要件の検証内容");
  assert.deepEqual(rows[3], ["Suite Run ID", "suite_run_1"]);
  assert.deepEqual(rows[15], REPORT_DISPLAY_HEADERS);
  assert.equal(rows[16][0], "case_1");
  assert.match(rows[16][6], /✓ SQLを生成/);
  assert.equal(rows[16][7], "A");
  assert.equal(rows[16][10], "合格");
  assert.equal(rows[16][14], "gemini-2.5-flash-lite");
  assert.deepEqual(rows[9], ["システム要件 正解率", 90]);
  assert.deepEqual(rows[10], ["ビジネス要件 正解率", 100]);
});

test("report marks business summaries as unset when no business evaluation ran", () => {
  const rows = reportToRows({
    id: "suite_run_without_business",
    suiteId: "suite_1",
    suiteName: "営業分析",
    status: "passed",
    summary: { score: 100, systemScore: 100, businessPassRate: 0, passRate: 100 },
    caseRuns: [{ caseId: "case_1", title: "月次売上", evaluation: { score: 100 } }]
  });
  assert.deepEqual(rows[10], ["ビジネス要件 正解率", "未設定"]);
  assert.deepEqual(rows[12], ["精度合格率", "未設定"]);
  assert.deepEqual(rows[13], ["精度分布", "未設定"]);
  assert.equal(rows[16][10], "未設定");
});

test("schema v1 suite rows migrate with business accuracy disabled", () => {
  const rows = [
    ["Agent Eval | テストスイート管理"],
    ["スキーマ", "1"],
    ["スイートID", "suite_old"],
    ["スイート名", "旧形式"],
    ["目的・説明", ""],
    ["ステータス", "active"],
    ["共通ナレッジ", ""],
    ["最終出力", ""],
    [],
    ["ケースID", "テストケース", "検証プロンプト", "Data Agent ID", "思考モード", "SQL必須", "チャート必須", "最大時間 (ms)", "最大課金バイト", "必須語句", "ナレッジID"],
    ["case_1", "旧ケース", "質問", "agent_1", "FAST", true, false, 120000, 0, "", ""]
  ];
  const parsed = rowsToSuiteInput(rows);
  assert.equal(parsed.cases[0].expectations.businessRequirements.enabled, false);
  assert.equal(parsed.cases[0].expectations.businessRequirements.accuracyCriteria, "");
});
