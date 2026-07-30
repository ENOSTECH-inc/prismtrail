import {
  formatLocaleDate,
  formatLocaleNumber,
  getLocale,
  localizeDocument,
  setLocale,
  tr,
  translateApiMessage
} from "./i18n.js";

const state = {
  config: null,
  agents: [],
  knowledgeSources: [],
  suites: [],
  suiteRuns: [],
  runs: [],
  sheetConnections: [],
  sheetFormat: null,
  suitePasteOpen: false,
  suitePasteText: "",
  suitePasteValidation: null,
  suitePasteError: "",
  suitePasteBusy: false,
  preserveEditorOnLocale: false,
  storageConfig: null,
  storageDraft: null,
  storageTestResult: null,
  selectedSuite: null,
  selectedCaseIndex: 0,
  editorTab: "cases",
  selectedRun: null,
  assistantMessages: [],
  assistantPatch: null,
  assistantOpen: false,
  knowledgePlan: null,
  selectedKnowledgeDetail: null,
  reportPollTimer: null,
  sidebarCollapsed: localStorage.getItem("prismtrail-sidebar-collapsed") === "true",
  busy: false
};

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function fmtDate(value) {
  return value ? formatLocaleDate(value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : tr("未実行", "Never");
}

/** Display name for a suite evaluation run: 実行時刻_テストスイート名 */
function suiteRunLabel(run) {
  const when = fmtDate(run?.createdAt || run?.completedAt);
  const name = String(run?.suiteName || "").trim() || tr("無題のテストスイート", "Untitled suite");
  return `${when}_${name}`;
}

function fmtDuration(ms = 0) {
  if (ms < 1000) return `${ms} ms`;
  return ms < 60000
    ? tr("{seconds} 秒", "{seconds} sec", { seconds: formatLocaleNumber(ms / 1000, { maximumFractionDigits: 1 }) })
    : tr("{minutes}分 {seconds}秒", "{minutes} min {seconds} sec", {
      minutes: formatLocaleNumber(Math.floor(ms / 60000)),
      seconds: formatLocaleNumber(Math.round((ms % 60000) / 1000))
    });
}

function fmtBytes(value = 0) {
  const bytes = Number(value);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}

function notify(message, kind = "error") {
  toast.textContent = message;
  toast.className = `toast ${kind}`;
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => (toast.hidden = true), 7000);
}

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(translateApiMessage(body.error?.message || body.error || `HTTP ${response.status}`));
  return body;
}

function icon(name, size = 17) {
  return `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;
}

function statusPill(status) {
  const label = {
    passed: tr("合格", "Passed"),
    failed: tr("不合格", "Failed"),
    review_required: tr("要確認", "Review required"),
    skipped: tr("スキップ", "Skipped"),
    warning: tr("注意", "Warning"),
    ready: tr("接続済み", "Connected"),
    unchecked: tr("未確認", "Unchecked"),
    error: tr("エラー", "Error"),
    draft: tr("下書き", "Draft"),
    active: tr("実行可", "Runnable"),
    running: tr("実行中", "Running")
  }[status] || status;
  return `<span class="status-pill ${esc(status)}">${esc(label)}</span>`;
}

function gradeBadge(business) {
  if (!business || business.status === "not_configured") {
    return `<span class="grade-badge grade-none" aria-label="${tr("精度判定なし", "No accuracy evaluation")}">— <small>${tr("精度判定なし", "Not evaluated")}</small></span>`;
  }
  if (business.status === "judge_error") {
    return `<span class="grade-badge grade-error" aria-label="${tr("精度判定保留", "Accuracy evaluation pending")}">! <small>${tr("判定保留", "Pending")}</small></span>`;
  }
  const grade = business.grade || "D";
  const labels = {
    A: tr("◎ 完全一致", "◎ Exact match"),
    B: tr("○ おおむね一致", "○ Mostly correct"),
    C: tr("△ 一部不一致", "△ Partially incorrect"),
    D: tr("× 不一致", "× Incorrect")
  };
  return `<span class="grade-badge grade-${grade.toLowerCase()}" aria-label="${tr("精度評価 {grade}、{label}", "Accuracy grade {grade}: {label}", { grade, label: labels[grade] })}"><b>${grade}</b><small>${labels[grade]}</small></span>`;
}

function localeSelector(compact = false) {
  const locale = getLocale();
  return `<div class="locale-switch ${compact ? "compact" : ""}" role="group" aria-label="${tr("表示言語", "Display language")}">
    <button type="button" data-set-locale="ja" class="${locale === "ja" ? "active" : ""}" aria-pressed="${locale === "ja"}" title="${tr("日本語に切り替える", "Switch to Japanese")}">JA</button>
    <button type="button" data-set-locale="en" class="${locale === "en" ? "active" : ""}" aria-pressed="${locale === "en"}" title="${tr("英語に切り替える", "Switch to English")}">EN</button>
  </div>`;
}

function shell(content, active = "suites", mode = false) {
  if (mode === true || mode === "editor") return content;
  const collapsed = state.sidebarCollapsed;
  const mainClass = mode === "detail" ? "main detail-mode" : "main";
  return `
    <div class="app-shell ${collapsed ? "sidebar-collapsed" : ""}">
      <aside class="sidebar ${collapsed ? "collapsed" : ""}">
        <div class="sidebar-head">
          <a class="brand" href="#/suites" aria-label="${tr("PrismTrail ホーム", "PrismTrail home")}">
            <span class="brand-icon"><img src="/assets/prismtrail-mark.png" alt="" width="32" height="32"></span>
            <span class="brand-copy"><strong>PrismTrail</strong><small>${tr("データエージェント評価", "Data agent evaluation")}</small></span>
          </a>
          <button id="sidebar-toggle" class="sidebar-toggle" type="button" aria-label="${collapsed ? tr("サイドバーを展開", "Expand sidebar") : tr("サイドバーを折りたたむ", "Collapse sidebar")}" aria-expanded="${!collapsed}" title="${collapsed ? tr("サイドバーを展開", "Expand sidebar") : tr("サイドバーを折りたたむ", "Collapse sidebar")}">${icon(collapsed ? "panel-left-open" : "panel-left-close", 16)}</button>
        </div>
        <nav aria-label="${tr("メインナビゲーション", "Main navigation")}">
          <section class="nav-group ${["suites", "run", "reports"].includes(active) ? "active-group" : ""}" aria-labelledby="nav-evaluation">
            <h2 id="nav-evaluation" class="nav-group-label">${tr("評価ワークフロー", "Evaluation")}</h2>
            <a class="${active === "suites" ? "active" : ""}" href="#/suites" title="${tr("テストスイート", "Test suites")}">${icon("layers-3")}<span class="nav-label">${tr("テストスイート", "Test suites")}</span></a>
            <a class="${active === "run" ? "active" : ""}" href="#/run" title="${tr("テスト実行", "Test run")}">${icon("play-circle")}<span class="nav-label">${tr("テスト実行", "Test run")}</span></a>
            <a class="${active === "reports" ? "active" : ""}" href="#/reports" title="${tr("評価レポート", "Evaluation reports")}">${icon("chart-no-axes-combined")}<span class="nav-label">${tr("評価レポート", "Evaluation reports")}</span></a>
          </section>
          <section class="nav-group ${["agents", "knowledge"].includes(active) ? "active-group" : ""}" aria-labelledby="nav-resources">
            <h2 id="nav-resources" class="nav-group-label">${tr("データ・ナレッジ", "Data & knowledge")}</h2>
            <a class="${active === "agents" ? "active" : ""}" href="#/agents" title="${tr("データエージェント", "Data agents")}">${icon("bot")}<span class="nav-label">${tr("データエージェント", "Data agents")}</span></a>
            <a class="${active === "knowledge" ? "active" : ""}" href="#/knowledge" title="${tr("GCSナレッジ", "GCS knowledge")}">${icon("library-big")}<span class="nav-label">${tr("GCSナレッジ", "GCS knowledge")}</span></a>
          </section>
          <section class="nav-group ${active === "sheets" ? "active-group" : ""}" aria-labelledby="nav-integrations">
            <h2 id="nav-integrations" class="nav-group-label">${tr("外部連携", "Integrations")}</h2>
            <a class="${active === "sheets" ? "active" : ""}" href="#/sheets" title="Google Sheets">${icon("sheet")}<span class="nav-label">Google Sheets</span></a>
          </section>
          <section class="nav-group ${active === "settings" ? "active-group" : ""}" aria-labelledby="nav-system">
            <h2 id="nav-system" class="nav-group-label">${tr("システム管理", "System")}</h2>
            <a class="${active === "settings" ? "active" : ""}" href="#/settings" title="${tr("設定", "Settings")}">${icon("settings-2")}<span class="nav-label">${tr("設定", "Settings")}</span></a>
          </section>
        </nav>
        ${localeSelector(collapsed)}
        <div class="sidebar-auth">
          <span class="live-dot"></span>
          <span class="auth-copy"><strong>Google Cloud ADC</strong><small>${esc(state.config?.billingProject || tr("接続確認中", "Checking connection"))}</small></span>
        </div>
      </aside>
      <main class="${mainClass}">${content}</main>
    </div>`;
}

function pageHead(title, text, action = "") {
  return `<header class="page-head"><div><h1>${esc(title)}</h1><p>${esc(text)}</p></div>${action}</header>`;
}

/**
 * Shared navigation chrome: back arrow + title/subtitle (suite-editor mental model).
 * Prefer this over breadcrumbs for nested screens.
 */
function navHeader({
  title,
  subtitle = "",
  subtitleHtml = "",
  backHref = "",
  backLabel = "",
  actions = ""
} = {}) {
  const label = backLabel || tr("戻る", "Back");
  const back = backHref
    ? `<a href="${esc(backHref)}" class="toolbar-back" aria-label="${esc(label)}" title="${esc(label)}">${icon("arrow-left", 18)}</a>`
    : "";
  const sub = subtitleHtml
    ? `<span>${subtitleHtml}</span>`
    : subtitle
      ? `<span>${esc(subtitle)}</span>`
      : "";
  return `
    <header class="nav-toolbar">
      <div class="toolbar-leading">
        ${back}
        <div class="toolbar-name">
          <strong>${esc(title)}</strong>
          ${sub}
        </div>
      </div>
      ${actions ? `<div class="toolbar-actions">${actions}</div>` : ""}
    </header>`;
}

function detailBody(content) {
  return `<div class="detail-body">${content}</div>`;
}

function empty(title, text) {
  return `<div class="empty">${icon("inbox", 28)}<strong>${esc(title)}</strong><p>${esc(text)}</p></div>`;
}

function refreshIcons() {
  localizeDocument(app);
  window.lucide?.createIcons();
}

function renderSuites() {
  const cards = state.suites
    .map((suite) => {
      const last = state.suiteRuns.find((run) => run.suiteId === suite.id);
      const activeRun = state.suiteRuns.find((run) => run.suiteId === suite.id && run.status === "running");
      return `<article class="suite-card">
        <div class="card-top">
          <span class="suite-icon">${icon("layers-3")}</span>
          <div class="card-top-actions">
            ${statusPill(suite.status)}
            <button class="icon-button danger" data-delete-suite="${suite.id}" aria-label="${tr("スイートを削除", "Delete suite")}" ${activeRun ? "disabled" : ""}>${icon("trash-2", 15)}</button>
          </div>
        </div>
        <h2>${esc(suite.name)}</h2>
        <p>${esc(suite.description || tr("説明はまだありません", "No description yet"))}</p>
        <div class="suite-meta">
          <span>${icon("list-checks", 14)}${tr("{count} ケース", "{count} cases", { count: formatLocaleNumber(suite.cases?.length || 0) })}</span>
          <span>${icon("clock-3", 14)}${fmtDate(suite.lastRunAt)}</span>
        </div>
        ${last ? `<div class="last-result"><span>${last.status === "running" ? tr("現在の実行", "Current run") : tr("直近の評価", "Latest evaluation")}</span><strong>${last.status === "running" ? `${last.summary?.completed || 0}/${last.summary?.total || suite.cases?.length || 0}` : `${last.summary?.passRate || 0}%`}</strong>${statusPill(last.status)}</div>` : ""}
        <div class="card-actions"><a class="button secondary" href="#/suites/${suite.id}/edit">${tr("編集する", "Edit")}</a>${activeRun ? `<a class="button primary" href="#/reports/${activeRun.id}">${icon("activity", 15)}${tr("進捗を見る", "View progress")}</a>` : `<button class="button primary" data-run-suite="${suite.id}">${icon("play", 15)}${tr("一括実行", "Run suite")}</button>`}</div>
      </article>`;
    })
    .join("");
  app.innerHTML = shell(`
    ${pageHead(tr("テストスイート", "Test suites"), tr("実業務プロンプトをまとめて実行し、品質とコストを継続評価します。", "Run real-world prompts together and continuously evaluate quality and cost."), `<div class="head-actions"><a href="#/sheets" class="button secondary">${icon("sheet", 16)}${tr("Sheets連携", "Sheets integration")}</a><button id="new-suite" class="button primary">${icon("plus", 16)}${tr("新しいスイート", "New suite")}</button></div>`)}
    <section class="summary-strip">
      <div><span>${tr("スイート", "Suites")}</span><strong>${formatLocaleNumber(state.suites.length)}</strong></div>
      <div><span>${tr("登録ケース", "Test cases")}</span><strong>${formatLocaleNumber(state.suites.reduce((n, s) => n + (s.cases?.length || 0), 0))}</strong></div>
      <div><span>${tr("実行レポート", "Run reports")}</span><strong>${formatLocaleNumber(state.suiteRuns.length)}</strong></div>
      <div><span>Data Agent</span><strong>${state.agents.length}</strong></div>
    </section>
    <section class="card-grid">${cards || empty(tr("まだスイートがありません", "No suites yet"), tr("最初のテストスイートを作成してください。", "Create your first test suite."))}</section>
  `, "suites");

  document.querySelector("#new-suite")?.addEventListener("click", createSuite);
  document.querySelectorAll("[data-run-suite]").forEach((button) => button.addEventListener("click", () => runSuite(button.dataset.runSuite)));
  document.querySelectorAll("[data-delete-suite]").forEach((button) => button.addEventListener("click", () => deleteSuite(button.dataset.deleteSuite)));
}

async function deleteSuite(id) {
  const suite = state.suites.find((item) => item.id === id);
  if (!suite) return;
  if (state.suiteRuns.some((run) => run.suiteId === id && run.status === "running")) {
    notify(tr("実行中のスイートは削除できません。", "A running suite cannot be deleted."));
    return;
  }
  if (
    !confirm(
      tr(
        "「{name}」を削除しますか？この操作は取り消せません。",
        "Delete “{name}”? This cannot be undone.",
        { name: suite.name }
      )
    )
  ) {
    return;
  }
  try {
    await json(`/api/suites/${id}`, { method: "DELETE" });
    state.suites = state.suites.filter((item) => item.id !== id);
    if (state.selectedSuite?.id === id) state.selectedSuite = null;
    notify(tr("テストスイートを削除しました。", "Deleted the test suite."), "success");
    renderSuites();
    refreshIcons();
  } catch (error) {
    notify(error.message);
  }
}

async function createSuite() {
  try {
    const suite = await json("/api/suites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tr("新しいテストスイート", "New test suite"), description: "", cases: [] })
    });
    state.suites.unshift(suite);
    location.hash = `#/suites/${suite.id}/edit`;
  } catch (error) {
    notify(error.message);
  }
}

function clampSelectedCaseIndex() {
  const total = state.selectedSuite?.cases?.length || 0;
  if (total === 0) {
    state.selectedCaseIndex = 0;
    return;
  }
  if (state.selectedCaseIndex < 0) state.selectedCaseIndex = 0;
  if (state.selectedCaseIndex >= total) state.selectedCaseIndex = total - 1;
}

function caseNav(suite) {
  return `<nav class="case-nav" aria-label="${tr("テストケース一覧", "Test case list")}">
    <div class="case-nav-head"><span>${tr("ケース", "Cases")}</span><strong>${formatLocaleNumber(suite.cases.length)}</strong></div>
    <div class="case-nav-list">
      ${suite.cases
        .map((item, index) => {
          const active = index === state.selectedCaseIndex;
          const title = String(item.title || "").trim() || tr("無題のケース", "Untitled case");
          const system = item.expectations?.systemRequirements || item.expectations || {};
          const business = item.expectations?.businessRequirements || {};
          const agent =
            state.agents.find((entry) => entry.id === item.agentId)?.displayName ||
            item.agentId ||
            tr("Data Agent未選択", "No Data Agent selected");
          const thinking = item.thinkingMode === "THINKING" ? "THINKING" : "FAST";
          const caseStatus = item.status === "draft" ? "draft" : "active";
          const promptPreview = String(item.prompt || "").trim();
          const flags = [
            system.requireSql !== false
              ? `<span class="case-nav-flag">${icon("database", 11)}SQL</span>`
              : "",
            system.requireChart ? `<span class="case-nav-flag">${icon("chart-column", 11)}${tr("チャート", "Chart")}</span>` : "",
            business.enabled && business.accuracyCriteria
              ? `<span class="case-nav-flag accent">${icon("sparkles", 11)}${tr("精度", "Accuracy")}</span>`
              : ""
          ]
            .filter(Boolean)
            .join("");
          return `<button type="button" class="case-nav-item${active ? " active" : ""}${caseStatus === "draft" ? " is-draft" : ""}" data-select-case="${index}" aria-current="${active ? "page" : "false"}" title="${esc(title)}">
            <div class="case-nav-card-top">
              <span class="case-nav-number">${String(index + 1).padStart(2, "0")}</span>
              <span class="case-nav-status ${caseStatus}">${caseStatus === "active" ? tr("実行可", "Runnable") : tr("下書き", "Draft")}</span>
            </div>
            <span class="case-nav-title">${esc(title)}</span>
            <span class="case-nav-agent">${esc(agent)}</span>
            <span class="case-nav-mode${thinking === "THINKING" ? " thinking" : ""}">${thinking}</span>
            ${promptPreview ? `<span class="case-nav-prompt">${esc(promptPreview)}</span>` : `<span class="case-nav-prompt muted">${tr("プロンプト未設定", "No prompt yet")}</span>`}
            ${flags ? `<div class="case-nav-flags">${flags}</div>` : ""}
          </button>`;
        })
        .join("")}
    </div>
  </nav>`;
}

function caseForm(item, index) {
  const system = item.expectations?.systemRequirements || item.expectations || {};
  const business = item.expectations?.businessRequirements || {};
  return `<article class="case-editor" data-case-index="${index}">
    <div class="case-titlebar">
      <span class="case-number">${String(index + 1).padStart(2, "0")}</span>
      <div><input class="plain-title" data-field="title" value="${esc(item.title)}" aria-label="${tr("テストケース名", "Test case name")}"><small>${esc(state.agents.find((a) => a.id === item.agentId)?.displayName || tr("Data Agent未選択", "No Data Agent selected"))}</small></div>
      <button class="icon-button danger" data-remove-case="${index}" aria-label="${tr("ケースを削除", "Delete case")}">${icon("trash-2")}</button>
    </div>
    <div class="field-grid">
      <label class="span-2">${tr("検証プロンプト", "Test prompt")}<textarea data-field="prompt" rows="4">${esc(item.prompt)}</textarea></label>
      <label>${tr("対象Data Agent", "Target Data Agent")}<select data-field="agentId">${state.agents.map((agent) => `<option value="${agent.id}" ${agent.id === item.agentId ? "selected" : ""}>${esc(agent.displayName)}</option>`).join("")}</select></label>
      <label>${tr("思考モード", "Thinking mode")}<select data-field="thinkingMode"><option value="FAST" ${item.thinkingMode !== "THINKING" ? "selected" : ""}>FAST</option><option value="THINKING" ${item.thinkingMode === "THINKING" ? "selected" : ""}>THINKING</option></select></label>
      <label>${tr("ステータス", "Status")}<select data-field="status"><option value="active" ${item.status !== "draft" ? "selected" : ""}>${tr("実行可", "Runnable")}</option><option value="draft" ${item.status === "draft" ? "selected" : ""}>${tr("下書き", "Draft")}</option></select><small class="field-help">${tr("下書きのケースは評価レポート実行時にスキップされます。", "Draft cases are skipped when a suite evaluation runs.")}</small></label>
      <label class="span-2">${tr("ケース固有バケット（複数選択）", "Case-specific buckets (multiple selection)")}
        <select data-knowledge multiple size="${Math.min(3, Math.max(2, state.knowledgeSources.length))}">
          ${state.knowledgeSources.map((source) => `<option value="${source.id}" ${(item.knowledgeSourceIds || []).includes(source.id) ? "selected" : ""}>${esc(source.name)} · gs://${esc(source.bucket)}/${esc(source.prefix || "")} · ${tr("{count} チャンク", "{count} chunks", { count: formatLocaleNumber(source.chunkCount || 0) })}</option>`).join("")}
        </select>
        <small class="field-help">${tr("未選択の場合はスイート共通ナレッジを使います。選択時はVertex AIが回答と関連チャンクの整合性を評価します。", "If none are selected, the suite-level knowledge is used. When selected, Vertex AI evaluates consistency between the answer and relevant chunks.")}</small>
      </label>
    </div>
    <details class="expectations" open>
      <summary>${tr("評価条件", "Evaluation criteria")}</summary>
      <fieldset class="requirement-section system-requirements">
        <legend>${tr("システム要件", "System requirements")} <small>${tr("動作チェック", "Behavior checks")}</small></legend>
        <p>${tr("回答・SQL・チャート・時間・コストが指定どおりかを決定論的に確認します。", "Deterministically verify the response, SQL, chart, duration, and cost.")}</p>
        <div class="expectation-grid">
          <label class="check"><input type="checkbox" data-system-expect="requireSql" ${system.requireSql !== false ? "checked" : ""}> ${tr("SQLを生成・実行", "Generate and run SQL")}</label>
          <label class="check"><input type="checkbox" data-system-expect="requireChart" ${system.requireChart ? "checked" : ""}> ${tr("チャートを生成", "Generate a chart")}</label>
          <label>${tr("最大実行時間（秒）", "Maximum duration (sec)")}<input type="number" min="0" data-system-expect="maxDurationMs" data-scale="1000" value="${Number(system.maxDurationMs || 0) / 1000}"></label>
          <label>${tr("最大課金量（MB）", "Maximum bytes billed (MB)")}<input type="number" min="0" data-system-expect="maxBytesBilled" data-scale="1048576" value="${Number(system.maxBytesBilled || 0) / 1048576}"></label>
          <label class="span-2">${tr("回答に含める語句（カンマ区切り）", "Required phrases (comma-separated)")}<input data-system-expect="requiredPhrases" value="${esc((system.requiredPhrases || []).join(", "))}"></label>
        </div>
      </fieldset>
      <fieldset class="requirement-section business-requirements">
        <legend>${tr("ビジネス要件", "Business requirements")} <small>${tr("精度チェック", "Accuracy check")}</small></legend>
        <p>${tr("回答内容が、事前に定義した正しい事実・判断基準と一致するかをGeminiで採点します。", "Gemini grades whether the answer matches the predefined facts and decision criteria.")}</p>
        <div class="business-toggle-row">
          <label class="check"><input type="checkbox" data-business-enabled ${business.enabled && business.accuracyCriteria ? "checked" : ""}> ${tr("AIで回答精度を判定", "Evaluate answer accuracy with AI")}</label>
          <label>${tr("合格ライン", "Passing grade")}<select data-business-passing-grade><option value="B" ${business.passingGrade !== "C" ? "selected" : ""}>${tr("B以上（推奨）", "B or higher (recommended)")}</option><option value="C" ${business.passingGrade === "C" ? "selected" : ""}>${tr("C以上", "C or higher")}</option></select></label>
        </div>
        <label>${tr("期待する正解・判定条件", "Expected answer and criteria")}
          <textarea rows="4" maxlength="5000" data-business-criteria placeholder="${tr("例: 2026年6月の求人応募数は65,200件。期間・数値・単位が一致すること。", "Example: There were 65,200 job applications in June 2026. The period, value, and unit must match.")}">${esc(business.accuracyCriteria || "")}</textarea>
          <small class="field-help">${tr("正解値、対象期間、単位、許容差を具体的に書くと判定が安定します。", "Specify the expected value, period, unit, and tolerance for more stable grading.")} Vertex AI · ${esc(state.config.vertexJudgeModel || "gemini-2.5-flash-lite")}</small>
        </label>
        <div class="grade-legend">${gradeBadge({ grade: "A", status: "passed" })}${gradeBadge({ grade: "B", status: "passed" })}${gradeBadge({ grade: "C", status: "review" })}${gradeBadge({ grade: "D", status: "failed" })}</div>
      </fieldset>
    </details>
  </article>`;
}

function suitePasteDialog(suite) {
  const validation = state.suitePasteValidation;
  const text = state.suitePasteText;
  const rows = text ? text.replace(/\r\n/g, "\n").split("\n").filter((line) => line.trim()).length : 0;
  const detected = text ? tr("{format} · {count}行を検出", "{format} · {count} rows detected", { format: text.includes("\t") ? "TSV" : "CSV", count: formatLocaleNumber(rows) }) : "";
  const diff = validation?.diff;
  const preview = validation?.preview || [];
  const status = state.suitePasteError
    ? `<div class="paste-validation error">${icon("circle-alert", 17)}<div><strong>検証できませんでした</strong><p>${esc(state.suitePasteError)}</p></div></div>`
    : validation
      ? `<div class="paste-validation success">${icon("badge-check", 17)}<div><strong>${tr("{count}ケースを更新できます", "{count} cases are ready to update", { count: formatLocaleNumber(validation.caseCount) })}</strong><p>${validation.delimiter.toUpperCase()} · ${tr("追加 {added} · 変更 {updated} · 削除 {removed} · 変更なし {unchanged}", "Added {added} · Updated {updated} · Removed {removed} · Unchanged {unchanged}", { added: formatLocaleNumber(diff?.added || 0), updated: formatLocaleNumber(diff?.updated || 0), removed: formatLocaleNumber(diff?.removed || 0), unchanged: formatLocaleNumber(diff?.unchanged || 0) })}</p></div></div>`
      : `<div class="paste-detection">${icon("scan-text", 16)}<span>${detected || "貼り付けるとCSV / TSVと行数を自動判定します。"}</span></div>`;
  return `
    <dialog id="suite-paste-dialog" class="suite-paste-dialog">
      <form method="dialog" class="paste-dialog-shell">
        <header>
          <div><span class="eyebrow">ケース一括編集</span><h2>表を貼り付けてテストケースを更新</h2><p>Google SheetsやExcelのセル範囲を、そのまま貼り付けられます。</p></div>
          <button class="icon-button" value="cancel" aria-label="閉じる">${icon("x", 17)}</button>
        </header>
        <div class="paste-target">${icon("layers-3", 16)}<span>更新先</span><strong>${esc(suite.name)}</strong><small>この画面のスイートに固定されています</small></div>
        <label>コピーしたセル
          <textarea id="suite-paste-text" rows="10" spellcheck="false" placeholder="ケースID&#9;ケース名&#9;プロンプト&#9;Data Agent ID&#10;case_001&#9;月次売上&#9;月次売上を集計して&#9;agent_...">${esc(text)}</textarea>
        </label>
        ${status}
        ${preview.length ? `<section class="paste-preview"><header><strong>${tr("反映プレビュー", "Import preview")}</strong><span>${tr("先頭{count}件", "First {count}", { count: formatLocaleNumber(preview.length) })}</span></header><div class="paste-preview-table">${preview.map((item) => `<div><code>${esc(item.id)}</code><strong>${esc(item.title)}</strong><span>${esc(item.prompt)}</span><small>${esc(state.agents.find((agent) => agent.id === item.agentId)?.displayName || item.agentId)}</small></div>`).join("")}</div></section>` : ""}
        <aside class="replace-warning">${icon("info", 15)}<span>適用すると、現在のテストケースは検証済みの内容で置き換わります。検証だけでは保存されません。</span></aside>
        <footer>
          <button class="button secondary" value="cancel">キャンセル</button>
          ${validation
            ? `<button id="apply-suite-paste" class="button primary" type="button" ${state.suitePasteBusy ? "disabled" : ""}>${icon("replace-all", 15)}全ケースを置き換える</button>`
            : `<button id="validate-suite-paste" class="button primary" type="button" ${!text.trim() || state.suitePasteBusy ? "disabled" : ""}>${icon("clipboard-check", 15)}内容を検証</button>`}
        </footer>
      </form>
    </dialog>`;
}

function renderEditor() {
  const suite = state.selectedSuite;
  clampSelectedCaseIndex();
  if (state.editorTab !== "basics" && state.editorTab !== "cases") state.editorTab = "cases";
  const selectedCase = suite.cases[state.selectedCaseIndex];
  const onCasesTab = state.editorTab === "cases";
  const connectedSheet =
    state.sheetConnections.find((connection) => connection.status === "ready" && connection.spreadsheetUrl) ||
    state.sheetConnections.find((connection) => connection.spreadsheetUrl);
  const sheetShortcut = connectedSheet
    ? `<button id="open-linked-sheet" class="button sheet-link" type="button">${icon("sheet", 15)}${tr("Gシートで編集", "Edit in Sheets")}${icon("external-link", 13)}</button>`
    : `<a class="button secondary" href="#/sheets">${icon("sheet", 15)}${tr("Google Sheetsを連携", "Connect Google Sheets")}</a>`;
  const assistantToggle = `<button id="toggle-assistant" class="button secondary${state.assistantOpen ? " active" : ""}" type="button" aria-pressed="${state.assistantOpen ? "true" : "false"}">${icon("sparkles", 15)}${state.assistantOpen ? tr("AIを閉じる", "Close AI") : tr("AIアシスタント", "AI assistant")}</button>`;
  const messages = state.assistantMessages
    .map((message) => `<div class="chat ${message.role}"><span>${message.role === "assistant" ? "AI" : "YOU"}</span><p>${esc(message.text)}</p></div>`)
    .join("");
  const showCaseNav = onCasesTab && suite.cases.length > 0;
  const columnClass = [
    "editor-columns",
    showCaseNav ? "has-cases" : "no-cases",
    state.assistantOpen ? "assistant-open" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const assistantPanel = state.assistantOpen
    ? `<aside class="assistant-panel" aria-label="AIテストスイートアシスタント">
          <header>
            <span class="assistant-icon">${icon("sparkles", 20)}</span>
            <div><strong>AIテストスイートアシスタント</strong><small>Vertex AI · ${esc(state.config.vertexModel)} · RAG ${suite.knowledgeSourceIds?.length || 0}</small></div>
            <button id="close-assistant" class="icon-button" type="button" aria-label="${tr("AIパネルを閉じる", "Close AI panel")}">${icon("x", 16)}</button>
            <span class="adc-badge"><i></i> ADC</span>
          </header>
          <div class="assistant-body">
            ${messages || `<div class="assistant-intro"><div class="assistant-orb">${icon("wand-sparkles", 25)}</div><h2>業務シナリオから<br>テスト設計を作れます</h2><p>選択したGCS資料から関連箇所を検索し、プロンプトと評価条件の提案に使います。</p></div>
            <div class="quick-actions">
              <button data-assistant-prompt="このスイートのカバレッジ不足を調べて、実業務向けケースを提案して">カバレッジを確認${icon("chevron-right")}</button>
              <button data-assistant-prompt="システム要件の動作チェックを実運用に耐えるよう厳密にして">システム要件を厳密にする${icon("chevron-right")}</button>
              <button data-assistant-prompt="各ケースのビジネス上の正解条件を確認し、不明な値は捏造せず質問して">ビジネス正解条件を整える${icon("chevron-right")}</button>
              <button data-assistant-prompt="プロンプトの表現と粒度を統一して">プロンプトを整える${icon("chevron-right")}</button>
            </div>`}
            ${state.assistantPatch ? `<div class="proposal"><strong>${icon("file-diff", 16)}変更案があります</strong><pre>${esc(JSON.stringify(state.assistantPatch, null, 2))}</pre><div><button id="discard-patch" class="button secondary">破棄</button><button id="apply-patch" class="button accent">変更を適用</button></div></div>` : ""}
          </div>
          <form id="assistant-form" class="assistant-composer">
            <textarea id="assistant-input" rows="3" placeholder="例: 販売チャネル別の成長率を評価するケースを追加して"></textarea>
            <button type="submit" aria-label="送信" ${state.busy ? "disabled" : ""}>${state.busy ? icon("loader-circle") : icon("arrow-up")}</button>
            <small>ADC認証でVertex AIに接続します。変更は確認後に適用されます。</small>
          </form>
        </aside>`
    : "";
  const basicsPanel = `<section class="basic-panel">
            <label>${tr("スイート名", "Suite name")}<input id="suite-name" value="${esc(suite.name)}"></label>
            <label>${tr("接続先Data Agent", "Target Data Agent")}
              <select id="suite-default-agent">
                <option value="">${tr("ケースごとに選択", "Choose per case")}</option>
                ${state.agents.map((agent) => {
                  const selected =
                    suite.defaultAgentId === agent.id ||
                    (!suite.defaultAgentId &&
                      suite.cases.length > 0 &&
                      suite.cases.every((item) => item.agentId === agent.id));
                  return `<option value="${agent.id}" ${selected ? "selected" : ""}>${esc(agent.displayName)}</option>`;
                }).join("")}
              </select>
              <small class="field-help">${tr("シートへ同期するとき、未設定のケースへこのAgent IDを自動入力します。", "When syncing to Sheets, empty case Agent IDs are filled with this value.")}</small>
            </label>
            <label>${tr("目的・説明", "Purpose and description")}<textarea id="suite-description" rows="3">${esc(suite.description)}</textarea></label>
            <div class="suite-knowledge">
              <span>実行時に接続するナレッジバケット（複数選択）</span>
              <div>${state.knowledgeSources.map((source) => `<label class="source-check"><input type="checkbox" data-suite-source value="${source.id}" ${(suite.knowledgeSourceIds || []).includes(source.id) ? "checked" : ""}><span>${icon("file-stack", 14)}${esc(source.name)}<small>gs://${esc(source.bucket)}/${esc(source.prefix || "")} · ${source.chunkCount || 0} チャンク</small></span></label>`).join("") || `<a href="#/knowledge" class="text-link">GCSナレッジを登録する ${icon("arrow-right", 14)}</a>`}</div>
            </div>
          </section>`;
  const casesPanel = `
          ${suite.cases.length ? "" : `<section class="suite-start-panel">
            <div><span class="eyebrow">作成方法を選択</span><h2>最初のテストケースを追加しましょう</h2><p>複数ケースをまとめて扱える「表で入力する」方法がおすすめです。</p></div>
            <div class="suite-start-options">
              <button id="start-with-paste" class="start-option primary" type="button"><span>${icon("clipboard-paste", 19)}</span><strong>表で入力する <em>おすすめ</em></strong><small>Sheets・Excelの複数ケースを一括追加</small>${icon("arrow-right", 15)}</button>
              <button id="start-manually" class="start-option" type="button"><span>${icon("square-pen", 19)}</span><strong>1件ずつ追加</strong><small>フォームでプロンプトと条件を設定</small>${icon("arrow-right", 15)}</button>
              <button id="start-with-ai" class="start-option" type="button"><span>${icon("sparkles", 19)}</span><strong>AIで作成</strong><small>業務シナリオを伝えて設計案を作る</small>${icon("arrow-right", 15)}</button>
            </div>
            <div class="sheet-direct-row">
              <span class="sheet-direct-icon">${icon("sheet", 18)}</span>
              <div><strong>${connectedSheet ? esc(connectedSheet.title || "連携済みGoogle Sheets") : "Google Sheetsと連携"}</strong><small>${connectedSheet ? "シート上でケースを編集し、アプリへ取り込めます。" : "連携すると、ここから編集用シートを直接開けます。"}</small></div>
              ${connectedSheet
                ? `<button id="open-linked-sheet-inline" class="button sheet-link" type="button">${icon("sheet", 15)}${tr("Gシートで編集", "Edit in Sheets")}${icon("external-link", 13)}</button>`
                : `<a class="button secondary" href="#/sheets">${icon("sheet", 15)}${tr("Google Sheetsを連携", "Connect Google Sheets")}</a>`}
            </div>
          </section>`}
          <div class="section-row">
            <div>
              <h2>${tr("テストケース", "Test cases")}</h2>
              <p>${tr("左の一覧から選択して編集します。上から順に実行されます。", "Select a case from the left list to edit. Cases run from top to bottom.")}</p>
            </div>
            <div class="section-actions">
              ${sheetShortcut}
              <button id="paste-cases" class="button secondary">${icon("clipboard-paste", 15)}${tr("表を貼り付けて一括編集", "Bulk edit by pasting a table")}</button>
              <button id="add-case" class="button secondary">${icon("plus", 15)}${tr("ケースを追加", "Add case")}</button>
            </div>
          </div>
          <div id="case-detail">${selectedCase ? caseForm(selectedCase, state.selectedCaseIndex) : empty(tr("ケースがありません", "No test cases"), tr("上の作成方法から、最初のケースを追加してください。", "Choose a method above to add your first case."))}</div>`;
  app.innerHTML = shell(`
    <div class="editor-shell">
      ${navHeader({
        title: suite.name,
        subtitleHtml: `<em id="save-state">${tr("保存済み", "Saved")}</em> · ${tr("テストスイート", "Test suites")}`,
        backHref: "#/suites",
        backLabel: tr("テストスイート一覧に戻る", "Back to test suites"),
        actions: `${localeSelector(true)}${assistantToggle}<button id="save-suite" class="button secondary">${icon("save", 15)}${tr("保存", "Save")}</button><button id="run-current-suite" class="button bright">${icon("play", 15)}${tr("スイートを実行", "Run suite")}</button>`
      })}
      <div class="${columnClass}">
        ${showCaseNav ? caseNav(suite) : ""}
        <main class="suite-workspace">
          <div class="workspace-title">
            <div>
              <h1>${tr("テスト設計を編集", "Edit test design")}</h1>
              <p>${onCasesTab
                ? tr("プロンプトと合格条件をケースごとに定義します。", "Define the prompt and passing criteria for each case.")
                : tr("スイート全体の名前・接続先・ナレッジを設定します。", "Configure the suite name, target agent, and knowledge.")}</p>
            </div>
            <span class="count-badge">${tr("{count} ケース", "{count} cases", { count: formatLocaleNumber(suite.cases.length) })}</span>
          </div>
          <div class="editor-tabs" role="tablist" aria-label="${tr("編集モード", "Edit mode")}">
            <button type="button" class="editor-tab${state.editorTab === "basics" ? " active" : ""}" role="tab" aria-selected="${state.editorTab === "basics" ? "true" : "false"}" data-editor-tab="basics">${icon("sliders-horizontal", 15)}${tr("基本情報", "Basics")}</button>
            <button type="button" class="editor-tab${state.editorTab === "cases" ? " active" : ""}" role="tab" aria-selected="${state.editorTab === "cases" ? "true" : "false"}" data-editor-tab="cases">${icon("list-checks", 15)}${tr("テストケース", "Test cases")}<em>${formatLocaleNumber(suite.cases.length)}</em></button>
          </div>
          <div class="editor-tab-panel" data-tab-panel="basics" ${state.editorTab === "basics" ? "" : "hidden"}>${basicsPanel}</div>
          <div class="editor-tab-panel" data-tab-panel="cases" ${state.editorTab === "cases" ? "" : "hidden"}>${casesPanel}</div>
        </main>
        ${assistantPanel}
      </div>
      ${suitePasteDialog(suite)}
    </div>`, "suites", "editor");
  refreshIcons();
  bindEditor();
  if (state.suitePasteOpen) document.querySelector("#suite-paste-dialog")?.showModal();
}

function addCaseToSuite() {
  if (document.querySelector("#suite-name")) {
    state.selectedSuite = collectSuite();
  }
  const defaultAgentId =
    document.querySelector("#suite-default-agent")?.value ||
    state.selectedSuite.defaultAgentId ||
    state.agents[0]?.id ||
    "";
  state.selectedSuite.cases.push({
    id: `case_${Date.now()}`,
    title: "新しいテストケース",
    prompt: "",
    agentId: defaultAgentId,
    thinkingMode: "FAST",
    status: "draft",
    expectations: {
      systemRequirements: { requireSql: true, requireChart: false, maxDurationMs: 120000, maxBytesBilled: 0, requiredPhrases: [] },
      businessRequirements: { enabled: false, accuracyCriteria: "", passingGrade: "B" }
    }
  });
  state.selectedCaseIndex = state.selectedSuite.cases.length - 1;
  state.editorTab = "cases";
  renderEditor();
}

function openSuitePaste() {
  if (document.querySelector("#suite-name")) state.selectedSuite = collectSuite();
  state.editorTab = "cases";
  state.suitePasteOpen = true;
  state.suitePasteValidation = null;
  state.suitePasteError = "";
  renderEditor();
}

async function submitSuitePaste(validateOnly) {
  const text = state.suitePasteText.trim();
  if (!text || state.suitePasteBusy) return;
  const wasBlank = state.selectedSuite.cases.length === 0;
  state.suitePasteBusy = true;
  state.suitePasteError = "";
  const button = document.querySelector(validateOnly ? "#validate-suite-paste" : "#apply-suite-paste");
  if (button) {
    button.disabled = true;
    button.innerHTML = `${icon("loader-circle", 15)}${validateOnly ? tr("検証中…", "Validating…") : tr("反映中…", "Applying…")}`;
    refreshIcons();
  }
  try {
    await saveSuite({ silent: true });
    const result = await json("/api/suites/import-paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetSuiteId: state.selectedSuite.id,
        text,
        validateOnly,
        preferTargetSuite: true,
        includeSuiteMetadata: wasBlank
      })
    });
    if (validateOnly) {
      state.suitePasteValidation = result.validation;
      state.suitePasteOpen = true;
      renderEditor();
      return;
    }
    state.selectedSuite = result.suite;
    state.suites = [result.suite, ...state.suites.filter((item) => item.id !== result.suite.id)];
    state.selectedCaseIndex = 0;
    state.editorTab = "cases";
    state.suitePasteOpen = false;
    state.suitePasteText = "";
    state.suitePasteValidation = null;
    notify(tr("{count}ケースを反映しました。", "Applied {count} cases.", { count: formatLocaleNumber(result.validation.caseCount) }), "success");
    renderEditor();
  } catch (error) {
    state.suitePasteError = error.message;
    state.suitePasteValidation = null;
    state.suitePasteOpen = true;
    renderEditor();
  } finally {
    state.suitePasteBusy = false;
    const nextButton = document.querySelector(state.suitePasteValidation ? "#apply-suite-paste" : "#validate-suite-paste");
    if (nextButton) nextButton.disabled = !state.suitePasteValidation && !state.suitePasteText.trim();
  }
}

function bindEditor() {
  document.querySelector("#save-suite").addEventListener("click", saveSuite);
  document.querySelector("#run-current-suite").addEventListener("click", () => runSuite(state.selectedSuite.id));
  document.querySelector("#add-case").addEventListener("click", addCaseToSuite);
  document.querySelector("#start-manually")?.addEventListener("click", addCaseToSuite);
  document.querySelector("#paste-cases").addEventListener("click", openSuitePaste);
  document.querySelector("#start-with-paste")?.addEventListener("click", openSuitePaste);
  document.querySelector("#start-with-ai")?.addEventListener("click", () => {
    state.editorTab = "cases";
    state.assistantOpen = true;
    renderEditor();
    const input = document.querySelector("#assistant-input");
    if (input) {
      input.value = "実業務で使う代表的なテストケースを提案して";
      input.focus();
    }
  });
  document.querySelectorAll("[data-editor-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.editorTab;
      if (next !== "basics" && next !== "cases") return;
      if (next === state.editorTab) return;
      if (document.querySelector("#suite-name")) state.selectedSuite = collectSuite();
      state.editorTab = next;
      renderEditor();
    });
  });
  const setAssistantOpen = (open) => {
    if (state.assistantOpen === open) return;
    if (document.querySelector("#suite-name")) state.selectedSuite = collectSuite();
    state.assistantOpen = open;
    renderEditor();
  };
  document.querySelector("#toggle-assistant")?.addEventListener("click", () => setAssistantOpen(!state.assistantOpen));
  document.querySelector("#close-assistant")?.addEventListener("click", () => setAssistantOpen(false));
  document.querySelectorAll("[data-select-case]").forEach((button) =>
    button.addEventListener("click", () => {
      const nextIndex = Number(button.dataset.selectCase);
      if (nextIndex === state.selectedCaseIndex) return;
      state.selectedSuite = collectSuite();
      state.selectedCaseIndex = nextIndex;
      renderEditor();
    })
  );
  const linkedDataButtonLabel = () =>
    `${icon("sheet", 15)}${tr("Gシートで編集", "Edit in Sheets")}${icon("external-link", 13)}`;
  const linkedDataBusyLabel = () => `${icon("loader-circle", 15)}${tr("連携中…", "Syncing…")}`;
  const setLinkedDataButtonsBusy = (busy) => {
    document.querySelectorAll("#open-linked-sheet, #open-linked-sheet-inline").forEach((item) => {
      item.disabled = busy;
      item.classList.toggle("is-busy", busy);
      item.setAttribute("aria-busy", busy ? "true" : "false");
      item.innerHTML = busy ? linkedDataBusyLabel() : linkedDataButtonLabel();
    });
    window.lucide?.createIcons();
  };
  const openLinkedSheet = async () => {
    const connection =
      state.sheetConnections.find((item) => item.status === "ready" && item.spreadsheetUrl) ||
      state.sheetConnections.find((item) => item.spreadsheetUrl);
    if (!connection) {
      location.hash = "#/sheets";
      return;
    }
    setLinkedDataButtonsBusy(true);
    try {
      await saveSuite({ silent: true });
      const exported = await json(`/api/sheets/connections/${connection.id}/export-suite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suiteId: state.selectedSuite.id })
      });
      updateSheetConnection(exported.connection);
      notify(
        tr(
          "連携データをSheetsへ同期しました。シートを開きます。",
          "Synced linked data to Sheets. Opening the sheet."
        ),
        "success"
      );
      window.open(exported.connection.spreadsheetUrl || connection.spreadsheetUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      notify(error.message);
    } finally {
      setLinkedDataButtonsBusy(false);
    }
  };
  document.querySelector("#open-linked-sheet")?.addEventListener("click", () => openLinkedSheet());
  document.querySelector("#open-linked-sheet-inline")?.addEventListener("click", () => openLinkedSheet());
  document.querySelector("#suite-default-agent")?.addEventListener("change", (event) => {
    const agentId = event.currentTarget.value;
    state.selectedSuite.defaultAgentId = agentId;
    if (!agentId) {
      document.querySelector("#save-state").textContent = tr("未保存", "Unsaved");
      return;
    }
    document.querySelectorAll(".case-editor [data-field='agentId']").forEach((select) => {
      if (!select.value) select.value = agentId;
    });
    state.selectedSuite.cases = state.selectedSuite.cases.map((item) => ({
      ...item,
      agentId: item.agentId || agentId
    }));
    document.querySelector("#save-state").textContent = tr("未保存", "Unsaved");
  });
  const pasteDialog = document.querySelector("#suite-paste-dialog");
  pasteDialog?.addEventListener("close", () => {
    state.suitePasteOpen = false;
    state.suitePasteValidation = null;
    state.suitePasteError = "";
  });
  const pasteText = document.querySelector("#suite-paste-text");
  pasteText?.addEventListener("input", () => {
    state.suitePasteText = pasteText.value;
    state.suitePasteValidation = null;
    state.suitePasteError = "";
    const rows = pasteText.value.replace(/\r\n/g, "\n").split("\n").filter((line) => line.trim()).length;
    const detection = document.querySelector(".paste-detection span");
    if (detection) {
      detection.textContent = pasteText.value.trim()
        ? tr("{format} · {count}行を検出", "{format} · {count} rows detected", { format: pasteText.value.includes("\t") ? "TSV" : "CSV", count: formatLocaleNumber(rows) })
        : tr("貼り付けるとCSV / TSVと行数を自動判定します。", "Paste CSV or TSV to detect its format and row count automatically.");
    }
    const validate = document.querySelector("#validate-suite-paste");
    if (validate) validate.disabled = !pasteText.value.trim();
  });
  document.querySelector("#validate-suite-paste")?.addEventListener("click", () => {
    state.suitePasteText = pasteText.value;
    submitSuitePaste(true);
  });
  document.querySelector("#apply-suite-paste")?.addEventListener("click", () => submitSuitePaste(false));
  document.querySelectorAll("[data-remove-case]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!confirm(tr("このテストケースを削除しますか？", "Delete this test case?"))) return;
      state.selectedSuite = collectSuite();
      const removed = Number(button.dataset.removeCase);
      state.selectedSuite.cases.splice(removed, 1);
      if (state.selectedCaseIndex >= state.selectedSuite.cases.length) {
        state.selectedCaseIndex = Math.max(0, state.selectedSuite.cases.length - 1);
      } else if (state.selectedCaseIndex > removed) {
        state.selectedCaseIndex -= 1;
      }
      renderEditor();
    })
  );
  document.querySelectorAll("[data-assistant-prompt]").forEach((button) => button.addEventListener("click", () => sendAssistant(button.dataset.assistantPrompt)));
  document.querySelector("#assistant-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#assistant-input");
    if (input?.value.trim()) sendAssistant(input.value.trim());
  });
  document.querySelector("#discard-patch")?.addEventListener("click", () => {
    state.assistantPatch = null;
    renderEditor();
  });
  document.querySelector("#apply-patch")?.addEventListener("click", applyPatch);
  document.querySelectorAll("input,textarea,select").forEach((input) => {
    if (input.closest("#assistant-form") || input.closest("#suite-paste-dialog")) return;
    input.addEventListener("input", () => {
      document.querySelector("#save-state").textContent = tr("未保存", "Unsaved");
      const activeCard = document.querySelector(".case-nav-item.active");
      if (!activeCard || !input.closest(".case-editor")) return;
      if (input.dataset.field === "title") {
        const title = activeCard.querySelector(".case-nav-title");
        if (title) title.textContent = input.value.trim() || tr("無題のケース", "Untitled case");
      }
      if (input.dataset.field === "prompt") {
        const prompt = activeCard.querySelector(".case-nav-prompt");
        if (prompt) {
          const value = input.value.trim();
          prompt.textContent = value || tr("プロンプト未設定", "No prompt yet");
          prompt.classList.toggle("muted", !value);
        }
      }
      if (input.dataset.field === "agentId") {
        const agent = activeCard.querySelector(".case-nav-agent");
        const label =
          state.agents.find((entry) => entry.id === input.value)?.displayName ||
          input.value ||
          tr("Data Agent未選択", "No Data Agent selected");
        if (agent) agent.textContent = label;
      }
      if (input.dataset.field === "thinkingMode") {
        const mode = activeCard.querySelector(".case-nav-mode");
        if (mode) {
          mode.textContent = input.value === "THINKING" ? "THINKING" : "FAST";
          mode.classList.toggle("thinking", input.value === "THINKING");
        }
      }
      if (input.dataset.field === "status") {
        const badge = activeCard.querySelector(".case-nav-status");
        const draft = input.value === "draft";
        activeCard.classList.toggle("is-draft", draft);
        if (badge) {
          badge.className = `case-nav-status ${draft ? "draft" : "active"}`;
          badge.textContent = draft ? tr("下書き", "Draft") : tr("実行可", "Runnable");
        }
      }
    });
  });
}

function collectCaseFromCard(card, source, defaultAgentId) {
  const previousSystem = source.expectations?.systemRequirements || source.expectations || {};
  const previousBusiness = source.expectations?.businessRequirements || {};
  const next = {
    ...source,
    expectations: {
      schemaVersion: 2,
      systemRequirements: { ...previousSystem },
      businessRequirements: { ...previousBusiness }
    }
  };
  card.querySelectorAll("[data-field]").forEach((input) => (next[input.dataset.field] = input.value));
  if (!String(next.agentId || "").trim()) next.agentId = defaultAgentId;
  const knowledgeSelect = card.querySelector("[data-knowledge]");
  next.knowledgeSourceIds = knowledgeSelect ? [...knowledgeSelect.selectedOptions].map((option) => option.value) : [];
  card.querySelectorAll("[data-system-expect]").forEach((input) => {
    const key = input.dataset.systemExpect;
    if (input.type === "checkbox") next.expectations.systemRequirements[key] = input.checked;
    else if (key === "requiredPhrases") next.expectations.systemRequirements[key] = input.value.split(",").map((v) => v.trim()).filter(Boolean);
    else next.expectations.systemRequirements[key] = Number(input.value || 0) * Number(input.dataset.scale || 1);
  });
  const accuracyCriteria = card.querySelector("[data-business-criteria]").value.trim();
  next.expectations.businessRequirements = {
    enabled: card.querySelector("[data-business-enabled]").checked && Boolean(accuracyCriteria),
    accuracyCriteria,
    passingGrade: card.querySelector("[data-business-passing-grade]").value
  };
  return next;
}

function collectSuite() {
  const defaultAgentId = document.querySelector("#suite-default-agent")?.value || "";
  const cases = [...(state.selectedSuite.cases || [])];
  const card = document.querySelector(".case-editor");
  if (card) {
    const index = Number(card.dataset.caseIndex);
    if (cases[index]) cases[index] = collectCaseFromCard(card, cases[index], defaultAgentId);
  }
  return {
    ...state.selectedSuite,
    name: document.querySelector("#suite-name").value,
    description: document.querySelector("#suite-description").value,
    defaultAgentId,
    knowledgeSourceIds: [...document.querySelectorAll("[data-suite-source]:checked")].map((input) => input.value),
    cases
  };
}

async function saveSuite({ silent = false } = {}) {
  try {
    const suite = collectSuite();
    const saved = await json(`/api/suites/${suite.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(suite) });
    state.selectedSuite = saved;
    state.suites = state.suites.map((item) => (item.id === saved.id ? saved : item));
    document.querySelector("#save-state").textContent = tr("保存済み", "Saved");
    if (!silent) notify(tr("テストスイートを保存しました。", "Test suite saved."), "success");
    return saved;
  } catch (error) {
    notify(error.message);
    throw error;
  }
}

async function sendAssistant(text) {
  if (state.busy) return;
  try {
    state.selectedSuite = collectSuite();
    state.assistantOpen = true;
    state.assistantMessages.push({ role: "user", text });
    state.busy = true;
    renderEditor();
    const reply = await json("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suite: state.selectedSuite, messages: state.assistantMessages })
    });
    state.assistantMessages.push({ role: "assistant", text: reply.message || "変更案を作成しました。" });
    state.assistantPatch = reply.patch && Object.keys(reply.patch).length ? reply.patch : null;
  } catch (error) {
    state.assistantMessages.push({ role: "assistant", text: tr("Vertex AIに接続できませんでした: {message}", "Could not connect to Vertex AI: {message}", { message: translateApiMessage(error.message) }) });
    notify(error.message);
  } finally {
    state.busy = false;
    renderEditor();
  }
}

async function applyPatch() {
  const patch = state.assistantPatch || {};
  if (patch.name) state.selectedSuite.name = patch.name;
  if (patch.description) state.selectedSuite.description = patch.description;
  if (Array.isArray(patch.cases)) {
    const cases = new Map(state.selectedSuite.cases.map((item) => [item.id, item]));
    patch.cases.forEach((item) => {
      const id = item.id && cases.has(item.id) ? item.id : `case_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
      cases.set(id, { ...(cases.get(id) || {}), ...item, id });
    });
    state.selectedSuite.cases = [...cases.values()];
  }
  state.assistantPatch = null;
  clampSelectedCaseIndex();
  renderEditor();
  await saveSuite();
}

async function runSuite(id) {
  const suite = state.suites.find((item) => item.id === id) || (state.selectedSuite?.id === id ? state.selectedSuite : null);
  if (!suite?.cases?.length) return notify(tr("ケースを1件以上登録してください。", "Add at least one test case."));
  const runnable = suite.cases.filter((item) => item.status !== "draft");
  if (!runnable.length) {
    return notify(tr("実行可のテストケースがありません。", "There are no runnable test cases."));
  }
  const skipped = suite.cases.length - runnable.length;
  if (
    !confirm(
      skipped
        ? tr(
            "{name} の実行可 {runnable} ケースを実行します（下書き {skipped} 件はスキップ）。BigQuery利用料金が発生する可能性があります。続けますか？",
            "Run {runnable} runnable cases in {name} ({skipped} draft cases will be skipped)? BigQuery usage charges may apply. Continue?",
            { name: suite.name, runnable: formatLocaleNumber(runnable.length), skipped: formatLocaleNumber(skipped) }
          )
        : tr(
            "{name} の {count} ケースを実行します。BigQuery利用料金が発生する可能性があります。続けますか？",
            "Run {count} cases in {name}? BigQuery usage charges may apply. Continue?",
            { name: suite.name, count: formatLocaleNumber(suite.cases.length) }
          )
    )
  ) {
    return;
  }
  try {
    state.busy = true;
    const run = await json(`/api/suites/${id}/run`, { method: "POST" });
    state.suiteRuns = [run, ...state.suiteRuns.filter((item) => item.id !== run.id)];
    location.hash = `#/reports/${run.id}`;
  } catch (error) {
    notify(error.message);
  } finally {
    state.busy = false;
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let offset = 0; offset < view.length; offset += 0x8000) {
    binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function gcsConsoleUrl(source) {
  const objectPath = [source.bucket, ...String(source.prefix || "").split("/").filter(Boolean)]
    .map(encodeURIComponent)
    .join("/");
  const project = encodeURIComponent(source.projectId || state.config?.billingProject || "");
  return `https://console.cloud.google.com/storage/browser/${objectPath}?project=${project}`;
}

function renderKnowledge() {
  const sourceCards = state.knowledgeSources.map((source) => `
    <article class="knowledge-card">
      <header><span class="suite-icon">${icon("bucket", 18)}</span><div><h2><a href="#/knowledge/${source.id}">${esc(source.name)}</a></h2><code>${esc(source.projectId || "project未設定")} · gs://${esc(source.bucket)}/${esc(source.prefix || "")}</code></div>${statusPill(source.status)}</header>
      <p>${esc(source.description || "GCS上の業務資料をテスト設計と評価のコンテキストとして利用します。")}</p>
      <div class="knowledge-stats"><span><b>${formatLocaleNumber(source.objectCount || 0)}</b> ${tr("ファイル", "files")}</span><span><b>${formatLocaleNumber(source.chunkCount || 0)}</b> ${tr("チャンク", "chunks")}</span><span><b>${fmtDate(source.lastSyncedAt)}</b> ${tr("同期", "synced")}</span></div>
      <div class="knowledge-actions">
        <a class="button primary" href="#/knowledge/${source.id}">${icon("folder-open", 14)}詳細を見る</a>
        <a class="button secondary" href="${esc(gcsConsoleUrl(source))}" target="_blank" rel="noreferrer">${icon("external-link", 14)}GCSを開く</a>
      </div>
    </article>`).join("");
  const plan = state.knowledgePlan;
  app.innerHTML = shell(`
    ${pageHead("GCSナレッジ", "GCSの資料を簡易RAGとして検索し、テスト設計・回答判定・Data Agent計画に利用します。", `<button id="new-knowledge-source" class="button primary">${icon("plus", 16)}バケットを登録</button>`)}
    <section class="rag-flow">
      <div>${icon("cloud-upload", 21)}<span><b>1. GCS</b><small>資料をアップロード</small></span></div><i>${icon("arrow-right", 15)}</i>
      <div>${icon("scan-text", 21)}<span><b>${tr("2. 索引化", "2. Index")}</b><small>${tr("抽出・チャンク化", "Extract & chunk")}</small></span></div><i>${icon("arrow-right", 15)}</i>
      <div>${icon("search-code", 21)}<span><b>${tr("3. 検索", "3. Retrieve")}</b><small>${tr("関連箇所を検索", "Find relevant context")}</small></span></div><i>${icon("arrow-right", 15)}</i>
      <div>${icon("sparkles", 21)}<span><b>4. Vertex AI</b><small>作成・判定・計画</small></span></div>
    </section>
    <section class="knowledge-grid">${sourceCards || empty("GCSバケットが未登録です", "既存バケットとprefixを登録してください。バケット自体は作成しません。")}</section>
    <section class="knowledge-tools">
      <form id="knowledge-search-form" class="rag-tool">
        <h2>検索プレビュー</h2><p>実際にどのチャンクがVertex AIへ渡るかを確認します。</p>
        <label>対象ナレッジ<div class="source-options">${state.knowledgeSources.map((source) => `<label class="source-check"><input type="checkbox" name="sourceIds" value="${source.id}" checked><span>${esc(source.name)}</span></label>`).join("")}</div></label>
        <label>検索クエリ<input name="query" required placeholder="例: 返品率の警告条件"></label>
        <button class="button secondary" type="submit">${icon("search", 14)}関連チャンクを検索</button>
        <div id="retrieval-results" class="retrieval-results"></div>
      </form>
      <form id="agent-plan-form" class="rag-tool planner">
        <h2>新しいData Agentを計画</h2><p>選択資料を根拠に、指示・質問例・テスト案をVertex AIが作成します。</p>
        <label>利用するナレッジ<div class="source-options">${state.knowledgeSources.map((source) => `<label class="source-check"><input type="checkbox" name="sourceIds" value="${source.id}" checked><span>${esc(source.name)}</span></label>`).join("")}</div></label>
        <label>作りたいData Agentの目的<textarea name="goal" rows="4" required placeholder="例: 営業会議向けに売上と返品の異常を説明できるData Agent"></textarea></label>
        <button class="button accent" type="submit">${icon("wand-sparkles", 14)}設計案を生成</button>
        ${plan ? `<div class="plan-result"><h3>${esc(plan.title || "Data Agent設計案")}</h3><p>${esc(plan.summary || "")}</p><label>Data Agentへの指示<textarea rows="8" readonly>${esc(plan.agentInstructions || "")}</textarea></label><h4>質問例</h4><ul>${(plan.exampleQuestions || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul><h4>テスト案</h4>${(plan.testCases || []).map((item) => `<div class="plan-test"><strong>${esc(item.title)}</strong><p>${esc(item.prompt)}</p></div>`).join("")}</div>` : ""}
      </form>
    </section>
    <dialog id="knowledge-dialog" class="knowledge-dialog">
      <form method="dialog" id="knowledge-source-form">
        <header><div><h2>GCSバケットを登録</h2><p>ADCでアクセスできるバケットから選択します。</p></div><button value="cancel" class="icon-button" aria-label="閉じる">${icon("x")}</button></header>
        <label>表示名（1件選択時のみ任意）<input name="name" placeholder="未入力の場合はバケット名"></label>
        <div class="project-picker">
          <label>Google Cloud プロジェクトID<input id="bucket-project-id" name="projectId" required value="${esc(state.config?.billingProject || "")}" placeholder="my-gcp-project"></label>
          <button id="load-buckets" type="button" class="button secondary">${icon("cloud-download", 14)}バケットを取得</button>
        </div>
        <label class="bucket-combobox-label">Bucket
          <div class="bucket-combobox">
            <span class="combo-search-icon">${icon("search", 15)}</span>
            <input id="bucket-search" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="bucket-options" aria-describedby="bucket-status" autocomplete="off" disabled placeholder="先にプロジェクトからバケットを取得">
            <span class="combo-chevron">${icon("chevron-down", 15)}</span>
            <div id="bucket-options" class="bucket-options" role="listbox" hidden></div>
          </div>
          <small id="bucket-status" class="bucket-status">プロジェクトIDを確認して「バケットを取得」を押してください。</small>
          <div id="selected-buckets" class="selected-buckets" aria-live="polite"></div>
        </label>
        <label>プレフィックス（任意）<input name="prefix" placeholder="data-agent/knowledge/"></label>
        <label>説明<textarea name="description" rows="3"></textarea></label>
        <footer><button value="cancel" class="button secondary">キャンセル</button><button value="default" class="button primary">登録する</button></footer>
      </form>
    </dialog>
  `, "knowledge");
  bindKnowledge();
}

function selectedSourceIds(form) {
  return [...form.querySelectorAll('input[name="sourceIds"]:checked')].map((input) => input.value);
}

function renderKnowledgeDetail() {
  const detail = state.selectedKnowledgeDetail;
  const source = detail.source;
  const objects = detail.objects || [];
  const usingSuites = state.suites.filter((suite) =>
    (suite.knowledgeSourceIds || []).includes(source.id) ||
    (suite.cases || []).some((testCase) => (testCase.knowledgeSourceIds || []).includes(source.id))
  );
  const objectRows = objects.map((object) => `
    <tr>
      <td><strong>${esc(object.name)}</strong><small>${esc(object.contentType || "application/octet-stream")}</small></td>
      <td>${fmtBytes(object.size)}</td>
      <td>${fmtDate(object.updated)}</td>
      <td><a class="text-link" href="${esc(`https://console.cloud.google.com/storage/browser/_details/${encodeURIComponent(source.bucket)}/${String(object.name).split("/").map(encodeURIComponent).join("/")}?project=${encodeURIComponent(source.projectId || state.config?.billingProject || "")}`)}" target="_blank" rel="noreferrer">GCSで確認 ${icon("external-link", 12)}</a></td>
    </tr>`).join("");
  app.innerHTML = shell(`
    ${navHeader({
      title: source.name,
      subtitle: `gs://${source.bucket}/${source.prefix || ""}`,
      backHref: "#/knowledge",
      backLabel: tr("GCSナレッジ一覧に戻る", "Back to GCS knowledge"),
      actions: `<a class="button secondary" href="${esc(gcsConsoleUrl(source))}" target="_blank" rel="noreferrer">${icon("external-link", 14)}${tr("GCSを開く", "Open GCS")}</a><button class="button bright" data-detail-sync="${source.id}">${icon("refresh-cw", 14)}${tr("同期する", "Sync")}</button>`
    })}
    ${detailBody(`
    <section class="bucket-detail-hero">
      <div class="bucket-detail-icon">${icon("bucket", 24)}</div>
      <div><span>Google Cloud プロジェクト</span><strong>${esc(source.projectId || "—")}</strong></div>
      <div><span>オブジェクト</span><strong>${objects.length}${detail.truncated ? "+" : ""}</strong></div>
      <div><span>索引済みチャンク</span><strong>${source.chunkCount || 0}</strong></div>
      <div><span>最終同期</span><strong>${fmtDate(source.lastSyncedAt)}</strong></div>
      ${statusPill(source.status)}
    </section>
    <section class="bucket-detail-grid">
      <article class="bucket-upload-panel">
        <h2>ファイルを追加</h2>
        <p>アップロード完了後に自動同期し、検索インデックスとファイル一覧を更新します。</p>
        <label class="bucket-upload-control">${icon("upload-cloud", 22)}<span><strong>ファイルを選択</strong><small>TXT、Markdown、CSV、JSON、YAML、SQL、HTML · 1ファイル4MBまで</small></span><input type="file" data-detail-upload="${source.id}" multiple accept=".txt,.md,.csv,.tsv,.json,.jsonl,.yaml,.yml,.sql,.html,text/*,application/json"></label>
        <div id="upload-progress" class="upload-progress" hidden></div>
      </article>
      <article class="bucket-config-panel">
        <h2>接続設定</h2>
        <dl><div><dt>バケット</dt><dd>${esc(source.bucket)}</dd></div><div><dt>プレフィックス</dt><dd>${esc(source.prefix || "ルート")}</dd></div><div><dt>ADC</dt><dd>${esc(String(detail.authSource || source.authSource || "adc").toUpperCase())}</dd></div></dl>
      </article>
    </section>
    <section class="bucket-files-panel">
      <div class="section-row"><div><h2>GCSファイル</h2><p>${tr("{count}件を表示", "Showing {count}", { count: formatLocaleNumber(objects.length) })}${detail.truncated ? tr("（先頭200件）", " (first 200)") : ""}</p></div></div>
      ${objectRows ? `<div class="table-scroll"><table><thead><tr><th>オブジェクト</th><th>サイズ</th><th>更新日時</th><th></th></tr></thead><tbody>${objectRows}</tbody></table></div>` : empty("ファイルがありません", "上の「ファイルを選択」から追加すると、自動同期後にここへ表示されます。")}
    </section>
    <section class="bucket-usage-panel">
      <div><h2>このバケットを利用するテストスイート</h2><p>テスト実行時は、スイートまたはケースで選択した複数のナレッジバケットをまとめて検索します。</p></div>
      <div class="usage-suite-list">${usingSuites.map((suite) => `<a href="#/suites/${suite.id}/edit">${icon("layers-3", 14)}<span><strong>${esc(suite.name)}</strong><small>${tr("{count}ケース", "{count} cases", { count: formatLocaleNumber(suite.cases?.length || 0) })}</small></span>${icon("arrow-right", 14)}</a>`).join("") || `<a href="#/suites">${icon("plus", 14)}テストスイートで接続先を選択する${icon("arrow-right", 14)}</a>`}</div>
    </section>
    `)}
  `, "knowledge", "detail");
  bindKnowledgeDetail();
}

function updateKnowledgeSourceState(source) {
  state.knowledgeSources = [
    source,
    ...state.knowledgeSources.filter((item) => item.id !== source.id)
  ];
}

async function syncKnowledgeDetail(button, sourceId) {
  button.disabled = true;
  try {
    const result = await json(`/api/knowledge-sources/${sourceId}/sync`, { method: "POST" });
    updateKnowledgeSourceState(result.source);
    state.selectedKnowledgeDetail = {
      ...state.selectedKnowledgeDetail,
      source: result.source,
      objects: result.objects,
      index: result.index
    };
    notify(tr("{files}ファイル、{chunks}チャンクを同期しました。", "Synced {files} files and {chunks} chunks.", { files: formatLocaleNumber(result.source.objectCount), chunks: formatLocaleNumber(result.source.chunkCount) }), "success");
    renderKnowledgeDetail();
    refreshIcons();
  } catch (error) {
    notify(error.message);
    button.disabled = false;
  }
}

async function uploadKnowledgeDetail(input) {
  const files = [...input.files];
  if (!files.length) return;
  if (files.length > 20) return notify(tr("一度に追加できるファイルは20件までです。", "You can add up to 20 files at a time."));
  const progress = document.querySelector("#upload-progress");
  input.disabled = true;
  progress.hidden = false;
  let uploadedCount = 0;
  try {
    for (const [index, file] of files.entries()) {
      if (file.size > 4 * 1024 * 1024) throw new Error(tr("{name} は4MBを超えています。", "{name} exceeds 4 MB.", { name: file.name }));
      progress.textContent = tr("{current} / {total} · {name} をアップロード中", "{current} / {total} · Uploading {name}", { current: formatLocaleNumber(index + 1), total: formatLocaleNumber(files.length), name: file.name });
      await json(`/api/knowledge-sources/${input.dataset.detailUpload}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          contentBase64: bytesToBase64(await file.arrayBuffer())
        })
      });
      uploadedCount += 1;
    }
    progress.textContent = tr("アップロード完了。検索インデックスを同期中…", "Upload complete. Syncing the search index…");
    const result = await json(`/api/knowledge-sources/${input.dataset.detailUpload}/sync`, { method: "POST" });
    updateKnowledgeSourceState(result.source);
    state.selectedKnowledgeDetail = {
      ...state.selectedKnowledgeDetail,
      source: result.source,
      objects: result.objects,
      index: result.index
    };
    notify(tr("{files}ファイルを追加し、{chunks}チャンクへ同期しました。", "Added {files} files and synced {chunks} chunks.", { files: formatLocaleNumber(uploadedCount), chunks: formatLocaleNumber(result.source.chunkCount) }), "success");
    renderKnowledgeDetail();
    refreshIcons();
  } catch (error) {
    const prefix = uploadedCount ? tr("{count}ファイルのアップロード後、同期に失敗しました。", "Sync failed after uploading {count} files. ", { count: formatLocaleNumber(uploadedCount) }) : "";
    progress.className = "upload-progress error";
    progress.textContent = `${prefix}${error.message}`;
    notify(`${prefix}${error.message}`);
    input.disabled = false;
    input.value = "";
  }
}

function bindKnowledgeDetail() {
  document.querySelector("[data-detail-sync]")?.addEventListener("click", (event) =>
    syncKnowledgeDetail(event.currentTarget, event.currentTarget.dataset.detailSync)
  );
  document.querySelector("[data-detail-upload]")?.addEventListener("change", (event) =>
    uploadKnowledgeDetail(event.currentTarget)
  );
}

function bindKnowledge() {
  const dialog = document.querySelector("#knowledge-dialog");
  const form = document.querySelector("#knowledge-source-form");
  const projectInput = document.querySelector("#bucket-project-id");
  const loadButton = document.querySelector("#load-buckets");
  const searchInput = document.querySelector("#bucket-search");
  const optionsPanel = document.querySelector("#bucket-options");
  const bucketStatus = document.querySelector("#bucket-status");
  const selectedBucketsPanel = document.querySelector("#selected-buckets");
  let bucketOptions = [];
  let filteredBuckets = [];
  let activeBucketIndex = -1;
  let selectedBucketNames = new Set();

  function closeBucketOptions() {
    optionsPanel.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
  }

  function setActiveBucket(index) {
    if (!filteredBuckets.length) return;
    activeBucketIndex = (index + filteredBuckets.length) % filteredBuckets.length;
    optionsPanel.querySelectorAll('[role="option"]').forEach((option, optionIndex) => {
      option.classList.toggle("active", optionIndex === activeBucketIndex);
    });
    const activeOption = document.querySelector(`#bucket-option-${activeBucketIndex}`);
    if (activeOption) {
      searchInput.setAttribute("aria-activedescendant", activeOption.id);
      activeOption.scrollIntoView({ block: "nearest" });
    }
  }

  function renderSelectedBuckets() {
    const names = [...selectedBucketNames];
    selectedBucketsPanel.innerHTML = names.map((name) => `
      <span class="selected-bucket">${icon("bucket", 13)}<span>${esc(name)}</span><button type="button" data-remove-bucket="${esc(name)}" aria-label="${tr("{name}を選択解除", "Deselect {name}", { name: esc(name) })}">${icon("x", 12)}</button></span>
    `).join("");
    selectedBucketsPanel.querySelectorAll("[data-remove-bucket]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedBucketNames.delete(button.dataset.removeBucket);
        renderSelectedBuckets();
        if (!optionsPanel.hidden) renderBucketOptions();
      });
    });
    if (names.length) {
      bucketStatus.className = "bucket-status selected";
      bucketStatus.textContent = tr("{count}件のバケットを選択中", "{count} buckets selected", { count: formatLocaleNumber(names.length) });
      if (names.length === 1 && !form.elements.name.value.trim()) form.elements.name.value = names[0];
    }
    refreshIcons();
  }

  function toggleBucket(bucket) {
    if (selectedBucketNames.has(bucket.name)) selectedBucketNames.delete(bucket.name);
    else selectedBucketNames.add(bucket.name);
    searchInput.value = "";
    renderSelectedBuckets();
    renderBucketOptions();
    searchInput.focus();
  }

  function renderBucketOptions() {
    const query = searchInput.value.trim().toLowerCase();
    filteredBuckets = bucketOptions.filter((bucket) =>
      [bucket.name, bucket.location, bucket.storageClass].some((value) =>
        String(value || "").toLowerCase().includes(query)
      )
    );
    activeBucketIndex = filteredBuckets.length ? 0 : -1;
    optionsPanel.innerHTML = filteredBuckets.map((bucket, index) => `
      <div id="bucket-option-${index}" class="bucket-option ${index === 0 ? "active" : ""}" role="option" aria-selected="${selectedBucketNames.has(bucket.name)}" data-bucket-name="${esc(bucket.name)}">
        <span class="bucket-option-icon">${icon("bucket", 15)}</span>
        <span><strong>${esc(bucket.name)}</strong><small>${esc(bucket.location || "—")} · ${esc(bucket.storageClass || "—")}</small></span>
        ${selectedBucketNames.has(bucket.name) ? icon("check", 15) : ""}
      </div>`).join("");
    optionsPanel.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
    if (filteredBuckets.length) {
      searchInput.setAttribute("aria-activedescendant", "bucket-option-0");
      bucketStatus.className = "bucket-status";
      bucketStatus.textContent = tr("{visible} / {total} バケットを表示 · {selected}件選択", "Showing {visible} / {total} buckets · {selected} selected", { visible: formatLocaleNumber(filteredBuckets.length), total: formatLocaleNumber(bucketOptions.length), selected: formatLocaleNumber(selectedBucketNames.size) });
    } else {
      searchInput.removeAttribute("aria-activedescendant");
      optionsPanel.innerHTML = `<div class="bucket-empty">${icon("search-x", 18)}<span><strong>該当するバケットがありません</strong><small>名前、ロケーション、ストレージクラスで検索できます。</small></span></div>`;
      bucketStatus.className = "bucket-status";
      bucketStatus.textContent = tr("0 / {total} バケットを表示", "Showing 0 / {total} buckets", { total: formatLocaleNumber(bucketOptions.length) });
    }
    optionsPanel.querySelectorAll("[data-bucket-name]").forEach((option) => {
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => {
        const bucket = bucketOptions.find((item) => item.name === option.dataset.bucketName);
        if (bucket) toggleBucket(bucket);
      });
    });
    refreshIcons();
  }

  async function loadBuckets() {
    if (!projectInput.reportValidity()) return;
    loadButton.disabled = true;
    searchInput.disabled = true;
    selectedBucketNames = new Set();
    renderSelectedBuckets();
    bucketOptions = [];
    closeBucketOptions();
    bucketStatus.className = "bucket-status loading";
    bucketStatus.textContent = "ADCでCloud Storageへ接続しています…";
    try {
      const result = await json(`/api/gcs/buckets?projectId=${encodeURIComponent(projectInput.value.trim())}`);
      bucketOptions = result.buckets || [];
      searchInput.disabled = false;
      searchInput.value = "";
      if (bucketOptions.length) {
        renderBucketOptions();
        searchInput.focus();
      } else {
        bucketStatus.className = "bucket-status";
        bucketStatus.textContent = tr("このプロジェクトで選択可能なバケットはありません。", "No selectable buckets were found in this project.");
      }
    } catch (error) {
      bucketStatus.className = "bucket-status error";
      bucketStatus.textContent = error.message;
      notify(error.message);
    } finally {
      loadButton.disabled = false;
    }
  }

  document.querySelector("#new-knowledge-source").addEventListener("click", () => {
    form.reset();
    bucketOptions = [];
    selectedBucketNames = new Set();
    renderSelectedBuckets();
    searchInput.value = "";
    searchInput.disabled = true;
    bucketStatus.className = "bucket-status";
    bucketStatus.textContent = tr("プロジェクトIDを確認して「バケットを取得」を押してください。", "Check the project ID, then select “Load buckets”.");
    closeBucketOptions();
    dialog.showModal();
  });
  loadButton.addEventListener("click", loadBuckets);
  projectInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadBuckets();
    }
  });
  projectInput.addEventListener("input", () => {
    bucketOptions = [];
    selectedBucketNames = new Set();
    renderSelectedBuckets();
    searchInput.value = "";
    searchInput.disabled = true;
    closeBucketOptions();
    bucketStatus.className = "bucket-status";
    bucketStatus.textContent = tr("プロジェクトを変更しました。バケットを再取得してください。", "The project changed. Load the bucket list again.");
  });
  searchInput.addEventListener("focus", () => {
    if (bucketOptions.length) renderBucketOptions();
  });
  searchInput.addEventListener("input", () => {
    renderBucketOptions();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (optionsPanel.hidden) renderBucketOptions();
      else setActiveBucket(activeBucketIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (optionsPanel.hidden) renderBucketOptions();
      else setActiveBucket(activeBucketIndex - 1);
    } else if (event.key === "Enter" && !optionsPanel.hidden && activeBucketIndex >= 0) {
      event.preventDefault();
      toggleBucket(filteredBuckets[activeBucketIndex]);
    } else if (event.key === "Escape") {
      closeBucketOptions();
    }
  });
  searchInput.addEventListener("blur", () => setTimeout(closeBucketOptions, 120));
  form.addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    if (!selectedBucketNames.size) {
      bucketStatus.className = "bucket-status error";
      bucketStatus.textContent = tr("一覧から登録するバケットを1件以上選択してください。", "Select at least one bucket from the list.");
      searchInput.focus();
      return;
    }
    try {
      const values = Object.fromEntries(new FormData(form));
      const result = await json("/api/knowledge-sources/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, buckets: [...selectedBucketNames] })
      });
      state.knowledgeSources = [
        ...result.sources,
        ...state.knowledgeSources.filter((item) => !result.sources.some((source) => source.id === item.id))
      ];
      dialog.close();
      const skippedText = result.skipped?.length ? tr("、{count}件は登録済みのためスキップ", "; skipped {count} already registered", { count: formatLocaleNumber(result.skipped.length) }) : "";
      notify(tr("{count}件のバケットを登録しました{skipped}。", "Registered {count} buckets{skipped}.", { count: formatLocaleNumber(result.sources.length), skipped: skippedText }), "success");
      renderKnowledge();
      refreshIcons();
    } catch (error) { notify(error.message); }
  });
  document.querySelectorAll("[data-sync-source]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await json(`/api/knowledge-sources/${button.dataset.syncSource}/sync`, { method: "POST" });
      state.knowledgeSources = state.knowledgeSources.map((item) => item.id === result.source.id ? result.source : item);
      notify(tr("{files}ファイル、{chunks}チャンクを同期しました。", "Synced {files} files and {chunks} chunks.", { files: formatLocaleNumber(result.source.objectCount), chunks: formatLocaleNumber(result.source.chunkCount) }), "success");
      renderKnowledge(); refreshIcons();
    } catch (error) { notify(error.message); button.disabled = false; }
  }));
  document.querySelectorAll("[data-upload-source]").forEach((input) => input.addEventListener("change", async () => {
    const files = [...input.files];
    if (!files.length) return;
    try {
      for (const file of files) {
        if (file.size > 4 * 1024 * 1024) throw new Error(tr("{name} は4MBを超えています。", "{name} exceeds 4 MB.", { name: file.name }));
        await json(`/api/knowledge-sources/${input.dataset.uploadSource}/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, contentType: file.type, contentBase64: bytesToBase64(await file.arrayBuffer()) })
        });
      }
      notify(tr("{count}ファイルをGCSへアップロードしました。同期すると検索対象になります。", "Uploaded {count} files to GCS. Sync to make them searchable.", { count: formatLocaleNumber(files.length) }), "success");
    } catch (error) { notify(error.message); }
    input.value = "";
  }));
  document.querySelector("#knowledge-search-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const target = document.querySelector("#retrieval-results");
    target.innerHTML = '<div class="loading-line">検索中...</div>';
    try {
      const result = await json("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: form.elements.query.value, sourceIds: selectedSourceIds(form) })
      });
      target.innerHTML = result.matches.map((match) => `<article><header><strong>${esc(match.objectName)}</strong><code>#${match.chunkIndex + 1} · ${Number(match.score).toFixed(2)}</code></header><p>${esc(match.text)}</p></article>`).join("") || empty("該当チャンクなし", "同期済み資料と検索語を確認してください。");
    } catch (error) { target.innerHTML = `<p class="error-text">${esc(error.message)}</p>`; }
  });
  document.querySelector("#agent-plan-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await json("/api/knowledge/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: form.elements.goal.value, sourceIds: selectedSourceIds(form) })
      });
      state.knowledgePlan = result.plan;
      renderKnowledge(); refreshIcons();
    } catch (error) { notify(error.message); button.disabled = false; }
  });
}

function renderAgents() {
  app.innerHTML = shell(`
    ${pageHead("データエージェント", "Google Cloud上の既存Data Agentを、テスト対象として安全に登録します。", `<button id="register-agent" class="button primary">${icon("plus", 16)}Agentを登録</button>`)}
    <div class="auth-banner">${icon("shield-check", 22)}<div><strong>アプリケーション既定認証情報（ADC）</strong><p>ローカルADCを優先し、利用できない場合はgcloudログインへフォールバックします。トークンは保存しません。</p></div><code>gcloud auth application-default login</code></div>
    <section class="table-panel">
      <table><thead><tr><th>Data Agent</th><th>プロジェクト / ロケーション</th><th>接続状態</th><th>最終確認</th><th></th></tr></thead>
      <tbody>${state.agents.map((agent) => `<tr><td><strong>${esc(agent.displayName)}</strong><small>${esc(agent.resourceName)}</small></td><td>${esc(agent.projectId)}<small>${esc(agent.location)}</small></td><td>${statusPill(agent.status)}</td><td>${fmtDate(agent.lastCheckedAt)}</td><td><button class="button secondary small" data-check-agent="${agent.id}">${icon("plug-zap", 14)}接続確認</button></td></tr>`).join("")}</tbody>
      </table>
    </section>
    <dialog id="agent-dialog"><form method="dialog" id="agent-form"><header><h2>Data Agentを登録</h2><button value="cancel" class="icon-button">${icon("x")}</button></header><label>表示名<input name="displayName" required placeholder="例: 売上分析エージェント"></label><label>リソース名<input name="resourceName" required placeholder="projects/.../locations/global/dataAgents/..."></label><label>説明<textarea name="description" rows="3"></textarea></label><footer><button value="cancel" class="button secondary">キャンセル</button><button id="save-agent" value="default" class="button primary">登録する</button></footer></form></dialog>
  `, "agents");
  const dialog = document.querySelector("#agent-dialog");
  document.querySelector("#register-agent").addEventListener("click", () => dialog.showModal());
  document.querySelector("#agent-form").addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const agent = await json("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      state.agents.unshift(agent);
      dialog.close();
      renderAgents();
    } catch (error) { notify(error.message); }
  });
  document.querySelectorAll("[data-check-agent]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const updated = await json(`/api/agents/${button.dataset.checkAgent}/check`, { method: "POST" });
      state.agents = state.agents.map((item) => (item.id === updated.id ? updated : item));
      notify(tr("接続を確認しました。BigQueryクエリは実行していません。", "Connection verified. No BigQuery query was run."), "success");
      renderAgents();
    } catch (error) { notify(error.message); button.disabled = false; }
  }));
}

function renderSheets() {
  const suiteOptions = state.suites
    .map((suite) => `<option value="${suite.id}">${esc(suite.name)} · ${tr("{count}ケース", "{count} cases", { count: formatLocaleNumber(suite.cases?.length || 0) })}</option>`)
    .join("");
  const reportOptions = state.suiteRuns
    .map((run) => `<option value="${run.id}">${esc(suiteRunLabel(run))} · ${run.summary?.passRate || 0}%</option>`)
    .join("");
  const connections = state.sheetConnections
    .map((connection) => `
      <article class="sheet-card" data-sheet-card="${connection.id}">
        <header>
          <span class="sheet-mark">${icon("sheet", 20)}</span>
          <div><h2>${esc(connection.title)}</h2><code>${esc(connection.spreadsheetId)}</code></div>
          ${statusPill(connection.status)}
        </header>
        <div class="sheet-meta">
          <span><b>認証</b>${esc(String(connection.authSource || "ADC").toUpperCase())}</span>
          <span><b>最終確認</b>${fmtDate(connection.lastCheckedAt)}</span>
          <span><b>最終入出力</b>${fmtDate(connection.lastImportedAt || connection.lastExportedAt)}</span>
        </div>
        <div class="sheet-actions">
          <form data-export-suite="${connection.id}">
            <label>アプリ → Sheets：テストスイート
              <select name="suiteId" ${state.suites.length ? "" : "disabled"}>${suiteOptions}</select>
            </label>
            <button class="button secondary" ${state.suites.length ? "" : "disabled"}>${icon("upload", 14)}固定フォーマットで出力</button>
          </form>
          <div class="sheet-import">
            <div><strong>Sheets → アプリ：テストスイート</strong><p><code>${esc(state.sheetFormat?.suiteTab || "AgentEval_TestSuite")}</code>を検証して取り込みます。同じsuite_idがあれば更新します。</p></div>
            <button class="button accent" data-import-suite="${connection.id}">${icon("download", 14)}取り込む</button>
          </div>
          <form data-export-report="${connection.id}">
            <label>アプリ → Sheets：評価レポート
              <select name="suiteRunId" ${state.suiteRuns.length ? "" : "disabled"}>${reportOptions}</select>
            </label>
            <button class="button secondary" ${state.suiteRuns.length ? "" : "disabled"}>${icon("file-output", 14)}結果を書き出す</button>
          </form>
        </div>
        <footer>
          <button class="text-button" data-check-sheet="${connection.id}">${icon("refresh-cw", 13)}接続を再確認</button>
          <a class="text-link" href="${esc(connection.spreadsheetUrl)}" target="_blank" rel="noreferrer">スプレッドシートを開く ${icon("external-link", 13)}</a>
        </footer>
      </article>`)
    .join("");
  app.innerHTML = shell(`
    ${pageHead("Google Sheets連携", "スプレッドシートの接続、同期、評価レポートの書き戻しを管理します。", `<a href="#/suites" class="button secondary">${icon("layers-3", 15)}スイートを作成・編集</a>`)}
    <section class="sheets-auth">
      <div class="sheets-auth-copy">${icon("shield-check", 24)}<div><strong>アプリケーション既定認証情報（ADC）で接続</strong><p>ADCのGoogleアカウントへ対象シートを共有してください。アクセストークンやセル内容は保存しません。</p></div></div>
      <code>gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets</code>
    </section>
    <section class="sheet-connect-panel">
      <form id="sheet-connect-form">
        <label>GoogleスプレッドシートURL / Spreadsheet ID
          <input name="spreadsheetUrl" required placeholder="https://docs.google.com/spreadsheets/d/.../edit">
        </label>
        <button class="button primary">${icon("link", 15)}接続を追加</button>
      </form>
      <div class="format-note">
        <span>${icon("lock-keyhole", 17)}</span>
        <div><strong>${tr("固定タブと列定義", "Managed tabs and columns")}</strong><p><code>${esc(state.sheetFormat?.suiteTab || "AgentEval_TestSuite")}</code> / <code>${esc(state.sheetFormat?.reportTab || "AgentEval_Report")}</code> ${tr("はUI操作で都度書き換えます。", "are rewritten by UI actions.")} <code>${esc(state.sheetFormat?.agentsTab || "AgentEval_DataAgents")}</code> / <code>${esc(state.sheetFormat?.suitesTab || "AgentEval_Suites")}</code> ${tr("は登録済みAgent・スイートを全件表示します。ユーザー作成タブは変更しません。", "always list all registered agents and suites. User-created tabs are left unchanged.")}</p></div>
        <b>${tr("スキーマ", "Schema")} v${state.sheetFormat?.schemaVersion || 1}</b>
      </div>
    </section>
    <section class="sheet-grid">${connections || empty("接続先がありません", "ADCアカウントへ共有済みのGoogleスプレッドシートを追加してください。")}</section>
  `, "sheets");
  bindSheets();
}

function updateSheetConnection(connection) {
  state.sheetConnections = [
    connection,
    ...state.sheetConnections.filter((item) => item.id !== connection.id)
  ];
}

function bindSheets() {
  document.querySelector("#sheet-connect-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget));
      if (state.selectedSuite?.id) payload.suiteId = state.selectedSuite.id;
      const connection = await json("/api/sheets/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      updateSheetConnection(connection);
      if (connection.bootstrap?.suiteBootstrapped || connection.bootstrap?.reportBootstrapped || connection.bootstrap?.catalogsBootstrapped) {
        notify(
          tr(
            "{title} に接続し、管理タブ（Agent一覧 / スイート一覧含む）を同期しました。",
            "Connected to {title} and synced managed tabs (including agent and suite catalogs).",
            { title: connection.title }
          ),
          "success"
        );
      } else {
        notify(tr("{title} に接続しました。", "Connected to {title}.", { title: connection.title }), "success");
      }
      renderSheets(); refreshIcons();
    } catch (error) { notify(error.message); button.disabled = false; }
  });
  document.querySelectorAll("[data-check-sheet]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const connection = await json(`/api/sheets/connections/${button.dataset.checkSheet}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suiteId: state.selectedSuite?.id || undefined })
      });
      updateSheetConnection(connection);
      if (connection.bootstrap?.suiteBootstrapped || connection.bootstrap?.reportBootstrapped || connection.bootstrap?.catalogsBootstrapped) {
        notify(
          tr(
            "接続を確認し、Agent一覧 / スイート一覧を含む管理タブを同期しました。",
            "Connection verified and managed tabs (including agent and suite catalogs) were synced."
          ),
          "success"
        );
      } else {
        notify(tr("Google Sheets APIへの接続を確認しました。", "Google Sheets API connection verified."), "success");
      }
      renderSheets(); refreshIcons();
    } catch (error) { notify(error.message); button.disabled = false; }
  }));
  document.querySelectorAll("[data-export-suite]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const result = await json(`/api/sheets/connections/${form.dataset.exportSuite}/export-suite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suiteId: form.elements.suiteId.value })
      });
      updateSheetConnection(result.connection);
      notify(tr("{tab} に{count}行を書き出しました。", "Exported {count} rows to {tab}.", { tab: result.tabName, count: formatLocaleNumber(result.rowCount) }), "success");
      renderSheets(); refreshIcons();
    } catch (error) { notify(error.message); button.disabled = false; }
  }));
  document.querySelectorAll("[data-import-suite]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm(tr("固定フォーマットを検証してテストスイートを取り込みます。続けますか？", "Validate the fixed format and import the test suite. Continue?"))) return;
    button.disabled = true;
    try {
      const result = await json(`/api/sheets/connections/${button.dataset.importSuite}/import-suite`, { method: "POST" });
      updateSheetConnection(result.connection);
      state.suites = [result.suite, ...state.suites.filter((item) => item.id !== result.suite.id)];
      notify(result.mode === "updated" ? tr("テストスイートを更新しました。", "Updated the test suite.") : tr("テストスイートを新規作成しました。", "Created a new test suite."), "success");
      renderSheets(); refreshIcons();
    } catch (error) { notify(error.message); button.disabled = false; }
  }));
  document.querySelectorAll("[data-export-report]").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const result = await json(`/api/sheets/connections/${form.dataset.exportReport}/export-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suiteRunId: form.elements.suiteRunId.value })
      });
      updateSheetConnection(result.connection);
      notify(tr("{tab} に評価結果を書き出しました。", "Exported evaluation results to {tab}.", { tab: result.tabName }), "success");
      renderSheets(); refreshIcons();
    } catch (error) { notify(error.message); button.disabled = false; }
  }));
}

function storageConfigFromForm() {
  const form = document.querySelector("#storage-settings-form");
  const driver = form.elements.driver.value;
  return {
    driver,
    projectId: form.elements.projectId.value.trim(),
    bucket: form.elements.bucket.value.trim(),
    prefix: form.elements.prefix.value.trim().replace(/^\/+/, ""),
    localPath: form.elements.localPath.value.trim()
  };
}

function storageDriverLabel(driver) {
  return driver === "local" ? "ローカルファイル" : "Google Cloud Storage";
}

function renderSettings() {
  const config = state.storageConfig || {
    driver: "gcs",
    projectId: state.config?.billingProject || "",
    bucket: "",
    prefix: "agent-eval/"
  };
  const draft = state.storageDraft || {
    driver: config.driver,
    projectId: config.projectId || state.config?.billingProject || "",
    bucket: config.bucket || "",
    prefix: config.prefix || "",
    localPath: config.localPath || "./data"
  };
  const isLocal = config.driver === "local";
  const draftIsLocal = draft.driver === "local";
  const status = config.status || "unchecked";
  const statusCopy = {
    ready: ["利用可能", "保存先へのアクセスを確認できています。"],
    error: ["接続エラー", config.error || "保存先に接続できません。設定と権限を確認してください。"],
    unchecked: ["未確認", "接続テストを実行して、接続先と認証を確認してください。"]
  }[status] || ["確認が必要", "現在の接続状態を確認してください。"];
  const test = state.storageTestResult;

  app.innerHTML = shell(`
    ${pageHead("設定", "システムデータの保存先を設定し、端末が変わっても同じ評価環境を利用できます。")}
    <section class="settings-status ${esc(status)}">
      <span class="settings-status-icon">${icon(status === "ready" ? "shield-check" : status === "error" ? "circle-alert" : "shield-question", 22)}</span>
      <div><span>現在のプライマリーストレージ</span><h2>${esc(storageDriverLabel(config.driver))}</h2><p>${esc(statusCopy[1])}</p></div>
      <div class="settings-status-meta">
        ${statusPill(status)}
        <dl>
          <div><dt>保存先</dt><dd>${esc(isLocal ? config.localPath || "未設定" : config.bucket ? `gs://${config.bucket}/${config.prefix || ""}` : "未設定")}</dd></div>
          <div><dt>最終同期</dt><dd>${esc(config.lastSyncedAt ? fmtDate(config.lastSyncedAt) : "未実行")}</dd></div>
          <div><dt>保存データ</dt><dd>${tr("{count}件", "{count} items", { count: formatLocaleNumber(config.objectCount || 0) })} · ${fmtBytes(config.sizeBytes || 0)}</dd></div>
        </dl>
      </div>
    </section>

    <form id="storage-settings-form" class="storage-settings-form">
      <section class="settings-panel">
        <div class="settings-section-head">
          <div><h2>保存方式</h2><p>複数の利用者で共有する場合はGoogle Cloud Storageを推奨します。</p></div>
        </div>
        <div class="storage-driver-options">
          <label class="storage-driver-card ${!draftIsLocal ? "selected" : ""}">
            <input type="radio" name="driver" value="gcs" ${!draftIsLocal ? "checked" : ""}>
            <span class="storage-driver-icon">${icon("cloud", 20)}</span>
            <span><strong>Google Cloud Storage</strong><small>既定・チーム共有向け</small><em>ADCで認証し、指定したバケットを簡易的な共通システムDBとして利用します。</em></span>
            <i>${icon("circle-check", 18)}</i>
          </label>
          <label class="storage-driver-card ${draftIsLocal ? "selected" : ""}">
            <input type="radio" name="driver" value="local" ${draftIsLocal ? "checked" : ""}>
            <span class="storage-driver-icon">${icon("folder", 20)}</span>
            <span><strong>ローカルファイル</strong><small>個人利用・オフライン検証向け</small><em>この端末のフォルダに保存します。別端末や他の利用者とは自動共有されません。</em></span>
            <i>${icon("circle-check", 18)}</i>
          </label>
        </div>
      </section>

      <section class="settings-panel storage-detail-panel">
        <div class="settings-section-head">
          <div><h2>接続情報</h2><p id="storage-detail-help">${draftIsLocal ? "アプリからアクセスできる絶対パスを指定します。" : "ADCで接続先と認証を確認します。書き込み権限は移行時に確認されます。"}</p></div>
          <span class="adc-inline">${icon("key-round", 13)}${draftIsLocal ? "この端末のみ" : "Google Cloud ADC"}</span>
        </div>
        <div id="gcs-storage-fields" class="storage-fields" ${draftIsLocal ? "hidden" : ""}>
          <label>Google Cloud プロジェクトID<input name="projectId" value="${esc(draft.projectId || state.config?.billingProject || "")}" autocomplete="off" placeholder="my-project"></label>
          <label>バケット名<input name="bucket" value="${esc(draft.bucket || "")}" autocomplete="off" placeholder="my-team-agent-eval"></label>
          <label class="span-2">プレフィックス（任意）<input name="prefix" value="${esc(draft.prefix || "")}" autocomplete="off" placeholder="agent-eval/"><small class="field-help">このプレフィックス配下だけをアプリの管理対象にします。</small></label>
        </div>
        <div id="local-storage-fields" class="storage-fields" ${!draftIsLocal ? "hidden" : ""}>
          <label class="span-2">保存フォルダ<input name="localPath" value="${esc(draft.localPath || "./data")}" autocomplete="off" placeholder="./data"><small class="field-help">Docker利用時は、コンテナにマウントされたパスを指定してください。</small></label>
        </div>
        ${test ? `<div class="storage-test-result ${test.ok ? "success" : "error"}">${icon(test.ok ? "check-circle-2" : "circle-alert", 16)}<div><strong>${test.ok ? "接続できました" : "接続できませんでした"}</strong><p>${esc(test.message || (test.ok ? "接続先と認証を確認しました。" : "設定と権限を確認してください。"))}</p>${test.identity ? `<code>${esc(test.identity)}</code>` : ""}</div></div>` : ""}
        <div class="settings-actions">
          <button id="test-storage" class="button secondary" type="button">${icon("plug-zap", 15)}接続をテスト</button>
          <button id="save-storage" class="button primary" type="submit">${icon("save", 15)}設定を保存</button>
        </div>
      </section>

      <section class="settings-panel migration-panel">
        <div class="settings-section-head">
          <div><h2>既存データの移行・同期</h2><p>現在の保存先にあるスイート、実行履歴、レポート、接続設定を新しい保存先へコピーします。</p></div>
          <span class="migration-icon">${icon("arrow-left-right", 18)}</span>
        </div>
        <div class="migration-flow">
          <div><span>現在</span><strong>${esc(storageDriverLabel(config.driver))}</strong><small>${esc(isLocal ? config.localPath || "未設定" : config.bucket ? `gs://${config.bucket}/${config.prefix || ""}` : "未設定")}</small></div>
          ${icon("arrow-right", 20)}
          <div><span>フォームで指定した保存先</span><strong id="migration-target-label">${esc(storageDriverLabel(draft.driver))}</strong><small id="migration-target-value">${esc(draftIsLocal ? draft.localPath || "保存フォルダ未設定" : draft.bucket ? `gs://${draft.bucket}/${draft.prefix || ""}` : "バケット未設定")}</small></div>
        </div>
        <div class="migration-notice">${icon("info", 15)}<p>移行元のデータは削除しません。コピー完了後に新しい保存先へ切り替えます。</p></div>
        <label class="migration-confirm"><input id="migration-confirm" type="checkbox"> 移行対象と保存先を確認しました</label>
        <div class="settings-actions">
          <button id="sync-storage" class="button secondary" type="button">${icon("refresh-cw", 15)}指定した保存先へ同期</button>
          <button id="migrate-storage" class="button accent" type="button" disabled>${icon("move-right", 15)}データをコピーして切り替え</button>
        </div>
      </section>
    </form>
  `, "settings");
  bindStorageSettings();
}

function bindStorageSettings() {
  const form = document.querySelector("#storage-settings-form");
  const gcsFields = document.querySelector("#gcs-storage-fields");
  const localFields = document.querySelector("#local-storage-fields");
  const detailHelp = document.querySelector("#storage-detail-help");
  const adc = document.querySelector(".adc-inline");
  const migrateButton = document.querySelector("#migrate-storage");
  const confirmation = document.querySelector("#migration-confirm");

  function reflectStorageChoice() {
    const draft = storageConfigFromForm();
    state.storageDraft = draft;
    const local = draft.driver === "local";
    gcsFields.hidden = local;
    localFields.hidden = !local;
    detailHelp.textContent = local ? "アプリからアクセスできる絶対パスを指定します。" : "ADCで接続先と認証を確認します。書き込み権限は移行時に確認されます。";
    adc.innerHTML = `${icon("key-round", 13)}${local ? "この端末のみ" : "Google Cloud ADC"}`;
    document.querySelectorAll(".storage-driver-card").forEach((card) => card.classList.toggle("selected", card.querySelector("input").checked));
    document.querySelector("#migration-target-label").textContent = storageDriverLabel(draft.driver);
    document.querySelector("#migration-target-value").textContent = local ? draft.localPath || "保存フォルダ未設定" : draft.bucket ? `gs://${draft.bucket}/${draft.prefix || ""}` : "バケット未設定";
    refreshIcons();
  }

  form.querySelectorAll("input").forEach((input) => input.addEventListener("input", reflectStorageChoice));
  confirmation.addEventListener("change", () => (migrateButton.disabled = !confirmation.checked));
  reflectStorageChoice();

  document.querySelector("#test-storage").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    state.storageDraft = storageConfigFromForm();
    try {
      state.storageTestResult = await json("/api/storage/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.storageDraft)
      });
      renderSettings();
    } catch (error) {
      state.storageTestResult = { ok: false, message: error.message };
      renderSettings();
    } finally {
      button.disabled = false;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#save-storage");
    button.disabled = true;
    try {
      state.storageDraft = storageConfigFromForm();
      const response = await json("/api/storage/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.storageDraft)
      });
      state.storageConfig = response.config || response;
      state.storageDraft = null;
      state.storageTestResult = null;
      notify(tr("プライマリーストレージ設定を保存しました。", "Primary storage settings saved."), "success");
      renderSettings();
    } catch (error) {
      notify(error.message);
      button.disabled = false;
    }
  });

  document.querySelector("#sync-storage").addEventListener("click", () => migrateStorage("sync"));
  migrateButton.addEventListener("click", () => migrateStorage("copy_and_switch"));
}

async function migrateStorage(mode) {
  const button = document.querySelector(mode === "sync" ? "#sync-storage" : "#migrate-storage");
  button.disabled = true;
  const targetConfig = storageConfigFromForm();
  state.storageDraft = targetConfig;
  try {
    const response = await json("/api/storage/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetConfig, mode })
    });
    if (response.config) state.storageConfig = response.config;
    if (mode === "copy_and_switch") state.storageDraft = null;
    const copied = response.migration?.copiedFiles;
    notify(mode === "sync"
      ? tr("指定した保存先へデータを同期しました。", "Synced data to the selected storage destination.")
      : tr("{count}データをコピーし、保存先を切り替えました。", "Copied {count}items and switched the storage destination.", { count: copied == null ? "" : `${formatLocaleNumber(copied)} ` }), "success");
    renderSettings();
  } catch (error) {
    notify(error.message);
    button.disabled = false;
  }
}

function renderReports() {
  const rows = state.suiteRuns.map((run) => `<tr><td><a href="#/reports/${run.id}"><strong>${esc(suiteRunLabel(run))}</strong><small>${esc(run.id)}</small></a></td><td>${statusPill(run.status)}</td><td><strong>${run.summary?.passRate || 0}%</strong></td><td>${run.summary?.passed || 0} / ${run.summary?.total || 0}</td><td>${fmtDuration(run.summary?.totalDurationMs)}</td><td>${fmtBytes(run.summary?.totalBytesBilled)}</td></tr>`).join("");
  app.innerHTML = shell(`${pageHead("評価レポート", "スイートの品質、速度、BigQuery利用量をチーム共有向けにまとめます。")}<section class="table-panel"><table><thead><tr><th>実行ログ</th><th>結果</th><th>合格率</th><th>合格ケース</th><th>所要時間</th><th>課金量</th></tr></thead><tbody>${rows}</tbody></table>${rows ? "" : empty("レポートがありません", "テストスイートを実行するとここに表示されます。")}</section>`, "reports");
}

function renderReport(report) {
  const isRunning = report.status === "running";
  const completed = report.summary?.completed ?? report.caseRuns?.length ?? 0;
  const total = report.summary?.total ?? report.suiteSnapshot?.cases?.length ?? completed;
  const progress = total ? Math.round((completed / total) * 100) : 0;
  const systemScore = report.summary?.systemScore ?? report.summary?.score ?? 0;
  const businessConfigured = report.summary?.businessConfigured ?? report.summary?.businessEvaluated ?? 0;
  const businessScore = businessConfigured > 0 ? report.summary?.businessScore : null;
  const overallScore = report.summary?.score;
  const scoreText = (value) => value === null || value === undefined ? "—" : `${value}%`;
  const completedCases = new Map((report.caseRuns || []).map((item) => [item.caseId, item]));
  const suiteCases = report.suiteSnapshot?.cases || report.caseRuns || [];
  const cases = suiteCases.map((testCase, index) => {
    const item = completedCases.get(testCase.id || testCase.caseId);
    if (item) {
      const system = item.evaluation?.system || item.evaluation || {};
      const business = item.evaluation?.business;
      if (item.status === "skipped") {
        return `<article class="report-case skipped">
          <header><span>${statusPill("skipped")}</span><div><strong>${esc(item.title)}</strong><small>${esc(item.caseId)}</small></div></header>
          <p class="muted-copy">${esc(translateApiMessage(item.skipReason || "ケースのステータスが実行可ではないためスキップしました。"))}</p>
        </article>`;
      }
      return `<article class="report-case ${item.status}">
        <header><span>${statusPill(item.status)}</span><div><strong>${esc(item.title)}</strong><small>${esc(item.caseId)}</small></div>${gradeBadge(business)}</header>
        ${item.error ? `<p class="error-text">${esc(translateApiMessage(item.error))}</p>` : ""}
        <div class="evaluation-layers">
          <section><div class="layer-title"><strong>${tr("システム要件", "System requirements")}</strong><b>${tr("{passed}/{total} 合格 · {score}点", "{passed}/{total} passed · {score} pts", { passed: formatLocaleNumber(system.passedCount || 0), total: formatLocaleNumber(system.checkCount || 0), score: formatLocaleNumber(system.score ?? 0) })}</b></div><div class="checks">${(system.checks || []).map((check) => `<span class="${check.passed ? "ok" : "ng"}">${icon(check.passed ? "check" : "x", 13)}${esc(translateApiMessage(check.label))}</span>`).join("")}</div></section>
          <section class="business-result"><div class="layer-title"><strong>ビジネス要件</strong></div>${business?.status === "not_configured" || !business ? `<p class="muted-copy">このケースには精度条件が設定されていません。</p>` : `<p><strong>${esc(business.summary || "判定理由はありません。")}</strong></p><details><summary>精度判定の詳細</summary><dl><dt>期待条件</dt><dd>${esc(business.expectedCriteria || "")}</dd><dt>差分</dt><dd>${esc((business.discrepancies || []).join(" / ") || "なし")}</dd><dt>判定モデル</dt><dd>${esc(business.judgeAudit?.model || "—")}</dd></dl></details>`}</section>
        </div>
        ${item.runId ? `<a href="#/runs/${item.runId}" class="text-link">実行トレースを見る ${icon("arrow-right", 14)}</a>` : ""}
      </article>`;
    }
    const active = report.currentCase?.caseId === testCase.id;
    const phaseLabel = {
      running: tr("Data Agentを実行中", "Running Data Agent"),
      evaluating_system: tr("システム要件を確認中", "Checking system requirements"),
      evaluating_business: tr("Geminiで回答精度を判定中", "Evaluating answer accuracy with Gemini")
    }[report.currentCase?.phase] || tr("実行待ち", "Waiting");
    return `<article class="report-case ${active ? "case-running" : "case-pending"}">
      <header>
        <span class="${active ? "live-spinner" : "case-index"}">${active ? "" : String(index + 1).padStart(2, "0")}</span>
        <div><strong>${esc(testCase.title)}</strong><small>${active ? phaseLabel : tr("実行待ち", "Waiting")}</small></div>
        <b>${active ? tr("実行中", "Running") : "—"}</b>
      </header>
      <div class="skeleton-layer"><strong>システム要件</strong><div class="skeleton-checks"><i></i><i></i><i></i></div></div>
      <div class="skeleton-layer"><strong>ビジネス要件</strong><div class="skeleton-grade"></div></div>
    </article>`;
  }).join("");
  const sheetExport = report.sheetExport || { status: "pending" };
  const sheetPanel = sheetExport.status === "succeeded"
    ? `<section class="sheet-export-status succeeded">${icon("sheet", 20)}<div><strong>${tr("評価レポートをGoogle Sheetsへ自動出力しました", "Evaluation report exported to Google Sheets")}</strong><p>${esc(sheetExport.spreadsheetTitle)} · ${esc(sheetExport.tabName)} · ${tr("{count}行", "{count} rows", { count: formatLocaleNumber(sheetExport.rowCount || 0) })}</p></div><a class="button accent" href="${esc(sheetExport.spreadsheetUrl)}" target="_blank" rel="noreferrer">${tr("シートを開く", "Open sheet")} ${icon("external-link", 14)}</a></section>`
    : sheetExport.status === "exporting"
      ? `<section class="sheet-export-status exporting"><span class="live-spinner"></span><div><strong>Google Sheetsへ評価レポートを書き戻しています</strong><p>レポートは完成しています。このまま自動出力の完了を待ちます。</p></div></section>`
      : sheetExport.status === "failed"
        ? `<section class="sheet-export-status failed">${icon("triangle-alert", 20)}<div><strong>${tr("Google Sheetsへの自動出力に失敗しました", "Automatic export to Google Sheets failed")}</strong><p>${esc(translateApiMessage(sheetExport.message))}</p></div><a class="button secondary" href="#/sheets">${tr("Sheets連携を確認", "Check Sheets integration")}</a></section>`
        : sheetExport.status === "skipped"
          ? `<section class="sheet-export-status skipped">${icon("info", 20)}<div><strong>${tr("Google Sheetsへの自動出力は行われませんでした", "Automatic export to Google Sheets was skipped")}</strong><p>${esc(translateApiMessage(sheetExport.message))}</p></div><a class="button secondary" href="#/sheets">${tr("Sheets連携を設定", "Configure Sheets integration")}</a></section>`
          : "";
  const actions = `${sheetExport.status === "succeeded" ? `<a class="button secondary" href="${esc(sheetExport.spreadsheetUrl)}" target="_blank" rel="noreferrer">${icon("sheet", 15)}${tr("シートを開く", "Open sheet")}</a>` : ""}<button onclick="window.print()" class="button secondary" ${isRunning ? "disabled" : ""}>${icon("printer", 15)}${tr("印刷", "Print")}</button>`;
  app.innerHTML = shell(`
    ${navHeader({
      title: suiteRunLabel(report),
      subtitle: report.id,
      backHref: "#/reports",
      backLabel: tr("評価レポート一覧に戻る", "Back to evaluation reports"),
      actions
    })}
    ${detailBody(`
    <section class="report-hero ${report.status}">
      <div class="overall-score"><span>${isRunning ? tr("実行進捗", "Run progress") : tr("総合スコア", "Overall score")}</span><strong>${isRunning ? completed : overallScore ?? "—"}<small>/${isRunning ? total : 100}</small></strong>${!isRunning && businessConfigured > 0 ? `<em>${tr("システム 40% + ビジネス 60%", "System 40% + business 60%")}</em>` : !isRunning ? `<em>${tr("ビジネス要件未評価のためシステムスコアを採用", "System score used because business requirements were not evaluated")}</em>` : ""}</div>
      <div class="ring score-ring system-ring" style="--progress:${systemScore};--ring-color:#65a0ff"><b>${scoreText(systemScore)}</b><span>システム要件</span></div>
      <div class="ring score-ring business-ring ${businessScore === null ? "unscored" : ""}" style="--progress:${businessScore ?? 0};--ring-color:#c084fc"><b>${scoreText(businessScore)}</b><span>ビジネス要件</span></div>
      <div class="hero-copy">${statusPill(report.status)}<h2>${isRunning ? tr("{title}を処理しています", "Processing {title}", { title: report.currentCase?.title || tr("実行準備中", "Preparing run") }) : report.status === "passed" ? tr("すべてのケースが基準を満たしました", "All cases met the criteria") : tr("改善が必要なケースがあります", "Some cases need improvement")}</h2><p>${isRunning ? tr("ケースが完了するたびに、この評価レポートへ結果が追加されます。", "Results appear in this report as each case completes.") : tr("{passed}件合格 / {failed}件不合格", "{passed} passed / {failed} failed", { passed: formatLocaleNumber(report.summary?.passed || 0), failed: formatLocaleNumber(report.summary?.failed || 0) })}</p></div>
      ${isRunning ? `<div class="live-progress"><span style="width:${progress}%"></span></div>` : ""}
    </section>
    <section class="report-metrics"><div><span>${tr("システム要件 正解率", "System requirement pass rate")}</span><strong>${scoreText(systemScore)}</strong><small>${tr("{passed} / {total} ケース合格", "{passed} / {total} cases passed", { passed: formatLocaleNumber(report.summary?.systemPassed ?? report.summary?.passed ?? 0), total: formatLocaleNumber(completed) })}</small></div><div><span>${tr("ビジネス要件 正解率", "Business requirement accuracy")}</span><strong>${scoreText(businessScore)}</strong><small>${businessConfigured ? tr("{evaluated} / {total} ケース採点済み", "{evaluated} / {total} cases evaluated", { evaluated: formatLocaleNumber(report.summary?.businessEvaluated || 0), total: formatLocaleNumber(businessConfigured) }) : tr("精度条件未設定", "No accuracy criteria")}</small></div><div><span>${tr("精度 A / B / C / D", "Accuracy A / B / C / D")}</span><strong>${report.summary?.accuracyGrades?.A || 0} / ${report.summary?.accuracyGrades?.B || 0} / ${report.summary?.accuracyGrades?.C || 0} / ${report.summary?.accuracyGrades?.D || 0}</strong></div><div><span>${tr("所要時間", "Duration")}</span><strong>${fmtDuration(report.summary?.totalDurationMs)}</strong><small>${tr("{completed} / {total} ケース完了", "{completed} / {total} cases completed", { completed: formatLocaleNumber(completed), total: formatLocaleNumber(total) })}</small></div></section>
    ${report.evaluationCorrection?.applied ? `<section class="evaluation-correction">${icon("shield-check", 18)}<div><strong>${tr("SQL実行証跡を再評価しました", "Re-evaluated SQL execution evidence")}</strong><p>${esc(translateApiMessage(report.evaluationCorrection.reason))}</p></div></section>` : ""}
    ${sheetPanel}
    <div class="section-row"><div><h2>${tr("ケース別評価", "Case evaluations")}</h2><p>${isRunning ? tr("完了したケースから評価内容を表示します。", "Evaluations appear as cases complete.") : tr("失敗した条件から改善ポイントを特定できます。", "Use failed criteria to identify areas for improvement.")}</p></div><b class="live-updated">${isRunning ? tr("{completed}/{total} 完了 · 自動更新中", "{completed}/{total} complete · auto-refreshing", { completed: formatLocaleNumber(completed), total: formatLocaleNumber(total) }) : tr("完了 {date}", "Completed {date}", { date: fmtDate(report.completedAt) })}</b></div>
    <section class="report-cases">${cases}</section>
    `)}
  `, "reports", "detail");
  if (isRunning || sheetExport.status === "exporting") {
    state.reportPollTimer = setTimeout(async () => {
      if (location.hash !== `#/reports/${report.id}`) return;
      try {
        const updated = await json(`/api/suite-runs/${report.id}`);
        state.suiteRuns = [updated, ...state.suiteRuns.filter((item) => item.id !== updated.id)];
        renderReport(updated);
        refreshIcons();
      } catch (error) {
        notify(tr("進捗の更新に失敗しました: {message}", "Failed to refresh progress: {message}", { message: translateApiMessage(error.message) }));
      }
    }, 1000);
  }
}

function renderSingleRun() {
  app.innerHTML = shell(`
    ${pageHead("テスト実行", "ひとつのプロンプトをすぐに試し、レスポンストレースを確認します。")}
    <section class="single-run-layout"><form id="single-run-form" class="form-panel"><label>対象Data Agent<select id="single-agent">${state.agents.map((a) => `<option value="${a.id}">${esc(a.displayName)}</option>`).join("")}</select></label><label>検証プロンプト<textarea id="single-prompt" rows="7" required placeholder="分析したい内容を入力してください"></textarea></label><div class="form-row"><label>思考モード<select id="single-mode"><option>FAST</option><option>THINKING</option></select></label><button class="button primary" type="submit">${icon("play", 15)}テストを実行</button></div></form><aside class="recent-panel"><h2>最近の実行</h2>${state.runs.slice(0, 8).map((run) => `<a href="#/runs/${run.id}"><span class="run-dot ${run.summary?.status}"></span><span><strong>${esc(run.question)}</strong><small>${fmtDate(run.createdAt)}</small></span></a>`).join("") || empty("履歴なし", "実行結果がここに並びます。")}</aside></section>
  `, "run");
  document.querySelector("#single-run-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const agent = state.agents.find((a) => a.id === document.querySelector("#single-agent").value);
    if (!confirm(tr("BigQuery利用料金が発生する可能性があります。実行しますか？", "BigQuery usage charges may apply. Run the test?"))) return;
    try {
      const run = await json("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: document.querySelector("#single-prompt").value, agent: agent.resourceName, agentLabel: agent.displayName, thinkingMode: document.querySelector("#single-mode").value }) });
      state.runs.unshift(run);
      state.selectedRun = run;
      location.hash = `#/runs/${run.id}`;
    } catch (error) { notify(error.message); }
  });
}

function renderRunDetail(run) {
  const context = run.context;
  const suiteRun = context ? state.suiteRuns.find((item) => item.id === context.suiteRunId) : null;
  const caseRun = suiteRun?.caseRuns?.find((item) => item.caseId === context?.caseId);
  const systemEvaluation = caseRun?.evaluation?.system || caseRun?.evaluation;
  const businessEvaluation = caseRun?.evaluation?.business;
  const events = run.events.map((event, index) => {
    const matchedSql = event.kind === "data.matched_query"
      ? event.payload?.sqlQuery || event.payload?.exampleQuery?.sqlQuery || ""
      : "";
    const body = event.kind.startsWith("text.")
      ? `<p>${esc((event.payload?.parts || []).join("\n"))}</p>`
      : event.kind === "data.generated_sql"
        ? `<pre>${esc(event.payload)}</pre>`
        : matchedSql
          ? `<div class="matched-sql-note">${icon("badge-check", 14)}検証済みクエリを再利用</div><pre>${esc(matchedSql)}</pre>`
          : `<details><summary>イベントデータ</summary><pre>${esc(JSON.stringify(event.payload, null, 2))}</pre></details>`;
    return `<article class="trace-event"><span class="trace-dot ${event.severity}"></span><div><header><strong>${esc(translateApiMessage(event.label))}</strong><code>${esc(event.kind)} · #${index + 1}</code></header>${body}</div></article>`;
  }).join("");
  const title = context?.caseTitle || run.agentLabel || tr("単一テスト実行", "Single test run");
  const subtitle = context
    ? (context.suiteName || tr("評価レポート", "Evaluation report"))
    : tr("単一プロンプトの実行", "Single prompt run");
  const backHref = context ? `#/reports/${context.suiteRunId}` : "#/run";
  const backLabel = context
    ? tr("評価レポートへ戻る", "Back to evaluation report")
    : tr("テスト実行へ戻る", "Back to test run");
  const actions = `<button onclick="window.print()" class="button secondary">${icon("printer", 15)}${tr("印刷", "Print")}</button>`;
  app.innerHTML = shell(`
    ${navHeader({ title, subtitle, backHref, backLabel, actions })}
    ${detailBody(`
    <section class="run-context"><div><span>${tr("選択中のケース", "Selected case")}</span><strong>${esc(context?.caseTitle || title)}</strong></div><div><span>${tr("検証プロンプト", "Verification prompt")}</span><p>${esc(run.question)}</p></div><code>${esc(run.id)}</code></section>
    <section class="report-metrics"><div><span>${tr("結果", "Result")}</span><strong>${statusPill(run.summary.status)}</strong></div><div><span>${tr("所要時間", "Duration")}</span><strong>${fmtDuration(run.summary.durationMs)}</strong></div><div><span>${tr("課金対象", "Bytes billed")}</span><strong>${fmtBytes(run.summary.totalBytesBilled)}</strong></div><div><span>${tr("SQL / ジョブ", "SQL / jobs")}</span><strong>${run.summary.sqlCount} / ${run.summary.jobCount}</strong></div></section>
    ${caseRun ? `<section class="run-evaluation-summary">
      <article><div class="layer-title"><strong>${tr("システム要件", "System requirements")}</strong><b>${tr("{score}点", "{score} pts", { score: formatLocaleNumber(systemEvaluation?.score ?? 0) })}</b></div><div class="checks">${(systemEvaluation?.checks || []).map((check) => `<span class="${check.passed ? "ok" : "ng"}">${icon(check.passed ? "check" : "x", 13)}${esc(translateApiMessage(check.label))}</span>`).join("")}</div></article>
      <article><div class="layer-title"><strong>ビジネス要件</strong>${gradeBadge(businessEvaluation)}</div><p>${esc(businessEvaluation?.summary || "精度条件は設定されていません。")}</p>${businessEvaluation?.expectedCriteria ? `<dl><dt>期待した内容</dt><dd>${esc(businessEvaluation.expectedCriteria)}</dd><dt>回答との差分</dt><dd>${esc((businessEvaluation.discrepancies || []).join(" / ") || "なし")}</dd></dl>` : ""}</article>
    </section>` : ""}
    <section class="trace-panel"><div class="section-row"><div><h2>${tr("レスポンストレース", "Response trace")}</h2><p>${tr("{count}件のイベント", "{count} events", { count: formatLocaleNumber(run.events.length) })} · ${esc(run.agentLabel)}</p></div></div>${events}</section>
    `)}
  `, context ? "reports" : "run", "detail");
}

async function route() {
  clearTimeout(state.reportPollTimer);
  state.reportPollTimer = null;
  const parts = location.hash.replace(/^#\//, "").split("/").filter(Boolean);
  try {
    if (parts[0] === "knowledge" && parts[1]) {
      state.selectedKnowledgeDetail = await json(`/api/knowledge-sources/${parts[1]}`);
      renderKnowledgeDetail();
    }
    else if (parts[0] === "knowledge") renderKnowledge();
    else if (parts[0] === "sheets") renderSheets();
    else if (parts[0] === "agents") renderAgents();
    else if (parts[0] === "settings") renderSettings();
    else if (parts[0] === "run") renderSingleRun();
    else if (parts[0] === "reports" && parts[1]) renderReport(await json(`/api/suite-runs/${parts[1]}`));
    else if (parts[0] === "reports") renderReports();
    else if (parts[0] === "runs" && parts[1]) renderRunDetail(await json(`/api/runs/${parts[1]}`));
    else if (parts[0] === "suites" && parts[1] && parts[2] === "edit") {
      if (state.selectedSuite?.id !== parts[1]) {
        state.suitePasteOpen = false;
        state.suitePasteText = "";
        state.suitePasteValidation = null;
        state.suitePasteError = "";
        state.selectedCaseIndex = 0;
        state.editorTab = "cases";
        state.assistantOpen = false;
      }
      if (state.preserveEditorOnLocale && state.selectedSuite?.id === parts[1]) {
        state.preserveEditorOnLocale = false;
      } else {
        state.selectedSuite = await json(`/api/suites/${parts[1]}`);
        state.assistantMessages = [];
        state.assistantPatch = null;
        state.selectedCaseIndex = 0;
      }
      renderEditor();
    } else renderSuites();
    refreshIcons();
  } catch (error) {
    notify(error.message);
  }
}

async function initialize() {
  try {
    const [config, agents, knowledgeSources, suites, suiteRuns, runs, sheetConnections, storageConfig] = await Promise.all([
      json("/api/config"),
      json("/api/agents"),
      json("/api/knowledge-sources"),
      json("/api/suites"),
      json("/api/suite-runs"),
      json("/api/runs"),
      json("/api/sheets/connections"),
      json("/api/storage/config").catch(() => null)
    ]);
    Object.assign(state, {
      config,
      agents: agents.agents,
      knowledgeSources: knowledgeSources.sources,
      suites: suites.suites,
      suiteRuns: suiteRuns.suiteRuns,
      runs: runs.runs,
      sheetConnections: sheetConnections.connections,
      sheetFormat: sheetConnections.format,
      storageConfig
    });
    if (!location.hash) location.hash = "#/suites";
    await route();
  } catch (error) {
    app.innerHTML = empty(tr("起動できませんでした", "Could not start the application"), translateApiMessage(error.message));
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("prismtrail:localechange", () => {
  document.documentElement.lang = getLocale();
  route();
});
app.addEventListener("click", (event) => {
  const localeButton = event.target.closest("[data-set-locale]");
  if (localeButton) {
    if (location.hash.match(/^#\/suites\/[^/]+\/edit/) && state.selectedSuite && document.querySelector("#suite-name")) {
      try {
        state.selectedSuite = collectSuite();
        state.preserveEditorOnLocale = true;
      } catch {
        // The editor may be between renders; keep the last in-memory state.
      }
    }
    setLocale(localeButton.dataset.setLocale);
    return;
  }
  const toggle = event.target.closest("#sidebar-toggle");
  if (!toggle) return;
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem("prismtrail-sidebar-collapsed", String(state.sidebarCollapsed));
  route();
});
document.documentElement.lang = getLocale();
initialize();
