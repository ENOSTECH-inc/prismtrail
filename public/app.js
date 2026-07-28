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
  storageConfig: null,
  storageDraft: null,
  storageTestResult: null,
  selectedSuite: null,
  selectedRun: null,
  assistantMessages: [],
  assistantPatch: null,
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
  return value
    ? new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "未実行";
}

function fmtDuration(ms = 0) {
  if (ms < 1000) return `${ms} ms`;
  return ms < 60000 ? `${(ms / 1000).toFixed(1)} 秒` : `${Math.floor(ms / 60000)}分 ${Math.round((ms % 60000) / 1000)}秒`;
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
  if (!response.ok) throw new Error(body.error?.message || body.error || `HTTP ${response.status}`);
  return body;
}

function icon(name, size = 17) {
  return `<i data-lucide="${name}" style="width:${size}px;height:${size}px"></i>`;
}

function statusPill(status) {
  const label = { passed: "合格", failed: "不合格", review_required: "要確認", warning: "注意", ready: "接続済み", unchecked: "未確認", error: "エラー", draft: "下書き", active: "有効", running: "実行中" }[status] || status;
  return `<span class="status-pill ${esc(status)}">${esc(label)}</span>`;
}

function gradeBadge(business) {
  if (!business || business.status === "not_configured") {
    return `<span class="grade-badge grade-none" aria-label="精度判定なし">— <small>精度判定なし</small></span>`;
  }
  if (business.status === "judge_error") {
    return `<span class="grade-badge grade-error" aria-label="精度判定保留">! <small>判定保留</small></span>`;
  }
  const grade = business.grade || "D";
  const labels = { A: "◎ 完全一致", B: "○ おおむね一致", C: "△ 一部不一致", D: "× 不一致" };
  return `<span class="grade-badge grade-${grade.toLowerCase()}" aria-label="精度評価 ${grade}、${labels[grade]}"><b>${grade}</b><small>${labels[grade]}</small></span>`;
}

function shell(content, active = "suites", editor = false) {
  if (editor) return content;
  const collapsed = state.sidebarCollapsed;
  return `
    <div class="app-shell ${collapsed ? "sidebar-collapsed" : ""}">
      <aside class="sidebar ${collapsed ? "collapsed" : ""}">
        <div class="sidebar-head">
          <a class="brand" href="#/suites" aria-label="PrismTrail ホーム">
            <span class="brand-icon"><img src="/assets/prismtrail-mark.png" alt="" width="32" height="32"></span>
            <span class="brand-copy"><strong>PrismTrail</strong><small>データエージェント評価</small></span>
          </a>
          <button id="sidebar-toggle" class="sidebar-toggle" type="button" aria-label="${collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}" aria-expanded="${!collapsed}" title="${collapsed ? "サイドバーを展開" : "サイドバーを折りたたむ"}">${icon(collapsed ? "panel-left-open" : "panel-left-close", 16)}</button>
        </div>
        <nav aria-label="メインナビゲーション">
          <section class="nav-group ${["suites", "run", "reports"].includes(active) ? "active-group" : ""}" aria-labelledby="nav-evaluation">
            <h2 id="nav-evaluation" class="nav-group-label">評価ワークフロー</h2>
            <a class="${active === "suites" ? "active" : ""}" href="#/suites" title="テストスイート">${icon("layers-3")}<span class="nav-label">テストスイート</span></a>
            <a class="${active === "run" ? "active" : ""}" href="#/run" title="テスト実行">${icon("play-circle")}<span class="nav-label">テスト実行</span></a>
            <a class="${active === "reports" ? "active" : ""}" href="#/reports" title="評価レポート">${icon("chart-no-axes-combined")}<span class="nav-label">評価レポート</span></a>
          </section>
          <section class="nav-group ${["agents", "knowledge"].includes(active) ? "active-group" : ""}" aria-labelledby="nav-resources">
            <h2 id="nav-resources" class="nav-group-label">データ・ナレッジ</h2>
            <a class="${active === "agents" ? "active" : ""}" href="#/agents" title="データエージェント">${icon("bot")}<span class="nav-label">データエージェント</span></a>
            <a class="${active === "knowledge" ? "active" : ""}" href="#/knowledge" title="GCSナレッジ">${icon("library-big")}<span class="nav-label">GCSナレッジ</span></a>
          </section>
          <section class="nav-group ${active === "sheets" ? "active-group" : ""}" aria-labelledby="nav-integrations">
            <h2 id="nav-integrations" class="nav-group-label">外部連携</h2>
            <a class="${active === "sheets" ? "active" : ""}" href="#/sheets" title="Google Sheets">${icon("sheet")}<span class="nav-label">Google Sheets</span></a>
          </section>
          <section class="nav-group ${active === "settings" ? "active-group" : ""}" aria-labelledby="nav-system">
            <h2 id="nav-system" class="nav-group-label">システム管理</h2>
            <a class="${active === "settings" ? "active" : ""}" href="#/settings" title="設定">${icon("settings-2")}<span class="nav-label">設定</span></a>
          </section>
        </nav>
        <div class="sidebar-auth">
          <span class="live-dot"></span>
          <span class="auth-copy"><strong>Google Cloud ADC</strong><small>${esc(state.config?.billingProject || "接続確認中")}</small></span>
        </div>
      </aside>
      <main class="main">${content}</main>
    </div>`;
}

function pageHead(title, text, action = "") {
  return `<header class="page-head"><div><h1>${esc(title)}</h1><p>${esc(text)}</p></div>${action}</header>`;
}

function empty(title, text) {
  return `<div class="empty">${icon("inbox", 28)}<strong>${esc(title)}</strong><p>${esc(text)}</p></div>`;
}

function refreshIcons() {
  window.lucide?.createIcons();
}

function renderSuites() {
  const cards = state.suites
    .map((suite) => {
      const last = state.suiteRuns.find((run) => run.suiteId === suite.id);
      const activeRun = state.suiteRuns.find((run) => run.suiteId === suite.id && run.status === "running");
      return `<article class="suite-card">
        <div class="card-top"><span class="suite-icon">${icon("layers-3")}</span>${statusPill(suite.status)}</div>
        <h2>${esc(suite.name)}</h2>
        <p>${esc(suite.description || "説明はまだありません")}</p>
        <div class="suite-meta">
          <span>${icon("list-checks", 14)}${suite.cases?.length || 0} ケース</span>
          <span>${icon("clock-3", 14)}${fmtDate(suite.lastRunAt)}</span>
        </div>
        ${last ? `<div class="last-result"><span>${last.status === "running" ? "現在の実行" : "直近の評価"}</span><strong>${last.status === "running" ? `${last.summary?.completed || 0}/${last.summary?.total || suite.cases?.length || 0}` : `${last.summary?.passRate || 0}%`}</strong>${statusPill(last.status)}</div>` : ""}
        <div class="card-actions"><a class="button secondary" href="#/suites/${suite.id}/edit">編集する</a>${activeRun ? `<a class="button primary" href="#/reports/${activeRun.id}">${icon("activity", 15)}進捗を見る</a>` : `<button class="button primary" data-run-suite="${suite.id}">${icon("play", 15)}一括実行</button>`}</div>
      </article>`;
    })
    .join("");
  app.innerHTML = shell(`
    ${pageHead("テストスイート", "実業務プロンプトをまとめて実行し、品質とコストを継続評価します。", `<div class="head-actions"><a href="#/sheets" class="button secondary">${icon("sheet", 16)}Sheets連携</a><button id="new-suite" class="button primary">${icon("plus", 16)}新しいスイート</button></div>`)}
    <section class="summary-strip">
      <div><span>スイート</span><strong>${state.suites.length}</strong></div>
      <div><span>登録ケース</span><strong>${state.suites.reduce((n, s) => n + (s.cases?.length || 0), 0)}</strong></div>
      <div><span>実行レポート</span><strong>${state.suiteRuns.length}</strong></div>
      <div><span>Data Agent</span><strong>${state.agents.length}</strong></div>
    </section>
    <section class="card-grid">${cards || empty("まだスイートがありません", "最初のテストスイートを作成してください。")}</section>
  `, "suites");

  document.querySelector("#new-suite")?.addEventListener("click", createSuite);
  document.querySelectorAll("[data-run-suite]").forEach((button) => button.addEventListener("click", () => runSuite(button.dataset.runSuite)));
}

async function createSuite() {
  try {
    const suite = await json("/api/suites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "新しいテストスイート", description: "", cases: [] })
    });
    state.suites.unshift(suite);
    location.hash = `#/suites/${suite.id}/edit`;
  } catch (error) {
    notify(error.message);
  }
}

function caseForm(item, index) {
  const system = item.expectations?.systemRequirements || item.expectations || {};
  const business = item.expectations?.businessRequirements || {};
  return `<article class="case-editor" data-case-index="${index}">
    <div class="case-titlebar">
      <span class="case-number">${String(index + 1).padStart(2, "0")}</span>
      <div><input class="plain-title" data-field="title" value="${esc(item.title)}" aria-label="テストケース名"><small>${esc(state.agents.find((a) => a.id === item.agentId)?.displayName || "Data Agent未選択")}</small></div>
      <button class="icon-button danger" data-remove-case="${index}" aria-label="ケースを削除">${icon("trash-2")}</button>
    </div>
    <div class="field-grid">
      <label class="span-2">検証プロンプト<textarea data-field="prompt" rows="4">${esc(item.prompt)}</textarea></label>
      <label>対象Data Agent<select data-field="agentId">${state.agents.map((agent) => `<option value="${agent.id}" ${agent.id === item.agentId ? "selected" : ""}>${esc(agent.displayName)}</option>`).join("")}</select></label>
      <label>思考モード<select data-field="thinkingMode"><option value="FAST" ${item.thinkingMode !== "THINKING" ? "selected" : ""}>FAST</option><option value="THINKING" ${item.thinkingMode === "THINKING" ? "selected" : ""}>THINKING</option></select></label>
      <label class="span-2">ケース固有バケット（複数選択）
        <select data-knowledge multiple size="${Math.min(3, Math.max(2, state.knowledgeSources.length))}">
          ${state.knowledgeSources.map((source) => `<option value="${source.id}" ${(item.knowledgeSourceIds || []).includes(source.id) ? "selected" : ""}>${esc(source.name)} · gs://${esc(source.bucket)}/${esc(source.prefix || "")} · ${source.chunkCount || 0} チャンク</option>`).join("")}
        </select>
        <small class="field-help">未選択の場合はスイート共通ナレッジを使います。選択時はVertex AIが回答と関連チャンクの整合性を評価します。</small>
      </label>
    </div>
    <details class="expectations" open>
      <summary>評価条件</summary>
      <fieldset class="requirement-section system-requirements">
        <legend>システム要件 <small>動作チェック</small></legend>
        <p>回答・SQL・チャート・時間・コストが指定どおりかを決定論的に確認します。</p>
        <div class="expectation-grid">
          <label class="check"><input type="checkbox" data-system-expect="requireSql" ${system.requireSql !== false ? "checked" : ""}> SQLを生成・実行</label>
          <label class="check"><input type="checkbox" data-system-expect="requireChart" ${system.requireChart ? "checked" : ""}> チャートを生成</label>
          <label>最大実行時間（秒）<input type="number" min="0" data-system-expect="maxDurationMs" data-scale="1000" value="${Number(system.maxDurationMs || 0) / 1000}"></label>
          <label>最大課金量（MB）<input type="number" min="0" data-system-expect="maxBytesBilled" data-scale="1048576" value="${Number(system.maxBytesBilled || 0) / 1048576}"></label>
          <label class="span-2">回答に含める語句（カンマ区切り）<input data-system-expect="requiredPhrases" value="${esc((system.requiredPhrases || []).join(", "))}"></label>
        </div>
      </fieldset>
      <fieldset class="requirement-section business-requirements">
        <legend>ビジネス要件 <small>精度チェック</small></legend>
        <p>回答内容が、事前に定義した正しい事実・判断基準と一致するかをGeminiで採点します。</p>
        <div class="business-toggle-row">
          <label class="check"><input type="checkbox" data-business-enabled ${business.enabled && business.accuracyCriteria ? "checked" : ""}> AIで回答精度を判定</label>
          <label>合格ライン<select data-business-passing-grade><option value="B" ${business.passingGrade !== "C" ? "selected" : ""}>B以上（推奨）</option><option value="C" ${business.passingGrade === "C" ? "selected" : ""}>C以上</option></select></label>
        </div>
        <label>期待する正解・判定条件
          <textarea rows="4" maxlength="5000" data-business-criteria placeholder="例: 2026年6月の求人応募数は65,200件。期間・数値・単位が一致すること。">${esc(business.accuracyCriteria || "")}</textarea>
          <small class="field-help">正解値、対象期間、単位、許容差を具体的に書くと判定が安定します。Vertex AI · ${esc(state.config.vertexJudgeModel || "gemini-2.5-flash-lite")}</small>
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
  const detected = text ? `${text.includes("\t") ? "TSV" : "CSV"} · ${rows}行を検出` : "";
  const diff = validation?.diff;
  const preview = validation?.preview || [];
  const status = state.suitePasteError
    ? `<div class="paste-validation error">${icon("circle-alert", 17)}<div><strong>検証できませんでした</strong><p>${esc(state.suitePasteError)}</p></div></div>`
    : validation
      ? `<div class="paste-validation success">${icon("badge-check", 17)}<div><strong>${validation.caseCount}ケースを更新できます</strong><p>${validation.delimiter.toUpperCase()} · 追加 ${diff?.added || 0} · 変更 ${diff?.updated || 0} · 削除 ${diff?.removed || 0} · 変更なし ${diff?.unchanged || 0}</p></div></div>`
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
        ${preview.length ? `<section class="paste-preview"><header><strong>反映プレビュー</strong><span>先頭${preview.length}件</span></header><div class="paste-preview-table">${preview.map((item) => `<div><code>${esc(item.id)}</code><strong>${esc(item.title)}</strong><span>${esc(item.prompt)}</span><small>${esc(state.agents.find((agent) => agent.id === item.agentId)?.displayName || item.agentId)}</small></div>`).join("")}</div></section>` : ""}
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
  const connectedSheet =
    state.sheetConnections.find((connection) => connection.status === "ready" && connection.spreadsheetUrl) ||
    state.sheetConnections.find((connection) => connection.spreadsheetUrl);
  const sheetShortcut = connectedSheet
    ? `<a class="button sheet-link" href="${esc(connectedSheet.spreadsheetUrl)}" target="_blank" rel="noreferrer">${icon("sheet", 15)}連携シートを開く${icon("external-link", 13)}</a>`
    : `<a class="button secondary" href="#/sheets">${icon("sheet", 15)}Google Sheetsを連携</a>`;
  const messages = state.assistantMessages
    .map((message) => `<div class="chat ${message.role}"><span>${message.role === "assistant" ? "AI" : "YOU"}</span><p>${esc(message.text)}</p></div>`)
    .join("");
  app.innerHTML = shell(`
    <div class="editor-shell">
      <header class="editor-toolbar">
        <a href="#/suites" class="toolbar-back">${icon("arrow-left")}テストスイート</a>
        <div class="toolbar-name"><strong>${esc(suite.name)}</strong><span id="save-state">保存済み</span></div>
        <div class="toolbar-actions">${sheetShortcut}<button id="save-suite" class="button secondary">${icon("save", 15)}保存</button><button id="run-current-suite" class="button bright">${icon("play", 15)}スイートを実行</button></div>
      </header>
      <div class="editor-columns">
        <main class="suite-workspace">
          <div class="workspace-title"><div><h1>テスト設計を編集</h1><p>プロンプト、接続先、合格条件をケースごとに定義します。</p></div><span class="count-badge">${suite.cases.length} ケース</span></div>
          <section class="basic-panel">
            <label>スイート名<input id="suite-name" value="${esc(suite.name)}"></label>
            <label>目的・説明<textarea id="suite-description" rows="2">${esc(suite.description)}</textarea></label>
            <div class="suite-knowledge">
              <span>実行時に接続するナレッジバケット（複数選択）</span>
              <div>${state.knowledgeSources.map((source) => `<label class="source-check"><input type="checkbox" data-suite-source value="${source.id}" ${(suite.knowledgeSourceIds || []).includes(source.id) ? "checked" : ""}><span>${icon("file-stack", 14)}${esc(source.name)}<small>gs://${esc(source.bucket)}/${esc(source.prefix || "")} · ${source.chunkCount || 0} チャンク</small></span></label>`).join("") || `<a href="#/knowledge" class="text-link">GCSナレッジを登録する ${icon("arrow-right", 14)}</a>`}</div>
            </div>
          </section>
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
              ${sheetShortcut}
            </div>
          </section>`}
          <div class="section-row"><div><h2>テストケース</h2><p>上から順に実行されます。</p></div><div class="section-actions"><button id="paste-cases" class="button secondary">${icon("clipboard-paste", 15)}表を貼り付けて一括編集</button><button id="add-case" class="button secondary">${icon("plus", 15)}ケースを追加</button></div></div>
          <div id="case-list">${suite.cases.map(caseForm).join("") || empty("ケースがありません", "上の作成方法から、最初のケースを追加してください。")}</div>
        </main>
        <aside class="assistant-panel" aria-label="AIテストスイートアシスタント">
          <header><span class="assistant-icon">${icon("sparkles", 20)}</span><div><strong>AIテストスイートアシスタント</strong><small>Vertex AI · ${esc(state.config.vertexModel)} · RAG ${suite.knowledgeSourceIds?.length || 0}</small></div><span class="adc-badge"><i></i> ADC</span></header>
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
        </aside>
      </div>
      ${suitePasteDialog(suite)}
    </div>`, "suites", true);
  bindEditor();
  if (state.suitePasteOpen) document.querySelector("#suite-paste-dialog")?.showModal();
}

function addCaseToSuite() {
  state.selectedSuite.cases.push({
    id: `case_${Date.now()}`,
    title: "新しいテストケース",
    prompt: "",
    agentId: state.agents[0]?.id || "",
    thinkingMode: "FAST",
    expectations: {
      systemRequirements: { requireSql: true, requireChart: false, maxDurationMs: 120000, maxBytesBilled: 0, requiredPhrases: [] },
      businessRequirements: { enabled: false, accuracyCriteria: "", passingGrade: "B" }
    }
  });
  renderEditor();
}

function openSuitePaste() {
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
    button.innerHTML = `${icon("loader-circle", 15)}${validateOnly ? "検証中…" : "反映中…"}`;
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
    state.suitePasteOpen = false;
    state.suitePasteText = "";
    state.suitePasteValidation = null;
    notify(`${result.validation.caseCount}ケースを反映しました。`, "success");
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
    const input = document.querySelector("#assistant-input");
    input.value = "実業務で使う代表的なテストケースを提案して";
    input.focus();
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
        ? `${pasteText.value.includes("\t") ? "TSV" : "CSV"} · ${rows}行を検出`
        : "貼り付けるとCSV / TSVと行数を自動判定します。";
    }
    const validate = document.querySelector("#validate-suite-paste");
    if (validate) validate.disabled = !pasteText.value.trim();
  });
  document.querySelector("#validate-suite-paste")?.addEventListener("click", () => {
    state.suitePasteText = pasteText.value;
    submitSuitePaste(true);
  });
  document.querySelector("#apply-suite-paste")?.addEventListener("click", () => submitSuitePaste(false));
  document.querySelectorAll("[data-remove-case]").forEach((button) => button.addEventListener("click", () => {
    if (confirm("このテストケースを削除しますか？")) {
      state.selectedSuite.cases.splice(Number(button.dataset.removeCase), 1);
      renderEditor();
    }
  }));
  document.querySelectorAll("[data-assistant-prompt]").forEach((button) => button.addEventListener("click", () => sendAssistant(button.dataset.assistantPrompt)));
  document.querySelector("#assistant-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#assistant-input");
    if (input.value.trim()) sendAssistant(input.value.trim());
  });
  document.querySelector("#discard-patch")?.addEventListener("click", () => {
    state.assistantPatch = null;
    renderEditor();
  });
  document.querySelector("#apply-patch")?.addEventListener("click", applyPatch);
  document.querySelectorAll("input,textarea,select").forEach((input) => {
    if (input.closest("#assistant-form") || input.closest("#suite-paste-dialog")) return;
    input.addEventListener("input", () => (document.querySelector("#save-state").textContent = "未保存"));
  });
}

function collectSuite() {
  const suite = {
    ...state.selectedSuite,
    name: document.querySelector("#suite-name").value,
    description: document.querySelector("#suite-description").value,
    knowledgeSourceIds: [...document.querySelectorAll("[data-suite-source]:checked")].map((input) => input.value),
    cases: []
  };
  document.querySelectorAll(".case-editor").forEach((card) => {
    const source = state.selectedSuite.cases[Number(card.dataset.caseIndex)];
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
    suite.cases.push(next);
  });
  return suite;
}

async function saveSuite({ silent = false } = {}) {
  try {
    const suite = collectSuite();
    const saved = await json(`/api/suites/${suite.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(suite) });
    state.selectedSuite = saved;
    state.suites = state.suites.map((item) => (item.id === saved.id ? saved : item));
    document.querySelector("#save-state").textContent = "保存済み";
    if (!silent) notify("テストスイートを保存しました。", "success");
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
    state.assistantMessages.push({ role: "assistant", text: `Vertex AIに接続できませんでした: ${error.message}` });
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
  renderEditor();
  await saveSuite();
}

async function runSuite(id) {
  const suite = state.suites.find((item) => item.id === id);
  if (!suite?.cases?.length) return notify("ケースを1件以上登録してください。");
  if (!confirm(`${suite.name} の ${suite.cases.length} ケースを実行します。BigQuery利用料金が発生する可能性があります。続けますか？`)) return;
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
      <div class="knowledge-stats"><span><b>${source.objectCount || 0}</b> ファイル</span><span><b>${source.chunkCount || 0}</b> チャンク</span><span><b>${fmtDate(source.lastSyncedAt)}</b> 同期</span></div>
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
      <div>${icon("scan-text", 21)}<span><b>2. 索引化</b><small>抽出・チャンク化</small></span></div><i>${icon("arrow-right", 15)}</i>
      <div>${icon("search-code", 21)}<span><b>3. 検索</b><small>関連箇所を検索</small></span></div><i>${icon("arrow-right", 15)}</i>
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
    <a class="detail-back" href="#/knowledge">${icon("arrow-left", 14)}バケット一覧へ</a>
    ${pageHead(source.name, `gs://${source.bucket}/${source.prefix || ""}`, `<div class="head-actions"><a class="button secondary" href="${esc(gcsConsoleUrl(source))}" target="_blank" rel="noreferrer">${icon("external-link", 14)}GCSを開く</a><button class="button primary" data-detail-sync="${source.id}">${icon("refresh-cw", 14)}同期する</button></div>`)}
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
      <div class="section-row"><div><h2>GCSファイル</h2><p>${objects.length}件を表示${detail.truncated ? "（先頭200件）" : ""}</p></div></div>
      ${objectRows ? `<div class="table-scroll"><table><thead><tr><th>オブジェクト</th><th>サイズ</th><th>更新日時</th><th></th></tr></thead><tbody>${objectRows}</tbody></table></div>` : empty("ファイルがありません", "上の「ファイルを選択」から追加すると、自動同期後にここへ表示されます。")}
    </section>
    <section class="bucket-usage-panel">
      <div><h2>このバケットを利用するテストスイート</h2><p>テスト実行時は、スイートまたはケースで選択した複数のナレッジバケットをまとめて検索します。</p></div>
      <div class="usage-suite-list">${usingSuites.map((suite) => `<a href="#/suites/${suite.id}/edit">${icon("layers-3", 14)}<span><strong>${esc(suite.name)}</strong><small>${suite.cases?.length || 0}ケース</small></span>${icon("arrow-right", 14)}</a>`).join("") || `<a href="#/suites">${icon("plus", 14)}テストスイートで接続先を選択する${icon("arrow-right", 14)}</a>`}</div>
    </section>
  `, "knowledge");
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
    notify(`${result.source.objectCount}ファイル、${result.source.chunkCount}チャンクを同期しました。`, "success");
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
  if (files.length > 20) return notify("一度に追加できるファイルは20件までです。");
  const progress = document.querySelector("#upload-progress");
  input.disabled = true;
  progress.hidden = false;
  let uploadedCount = 0;
  try {
    for (const [index, file] of files.entries()) {
      if (file.size > 4 * 1024 * 1024) throw new Error(`${file.name} は4MBを超えています。`);
      progress.textContent = `${index + 1} / ${files.length} · ${file.name} をアップロード中`;
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
    progress.textContent = "アップロード完了。検索インデックスを同期中…";
    const result = await json(`/api/knowledge-sources/${input.dataset.detailUpload}/sync`, { method: "POST" });
    updateKnowledgeSourceState(result.source);
    state.selectedKnowledgeDetail = {
      ...state.selectedKnowledgeDetail,
      source: result.source,
      objects: result.objects,
      index: result.index
    };
    notify(`${uploadedCount}ファイルを追加し、${result.source.chunkCount}チャンクへ同期しました。`, "success");
    renderKnowledgeDetail();
    refreshIcons();
  } catch (error) {
    const prefix = uploadedCount ? `${uploadedCount}ファイルのアップロード後、同期に失敗しました。` : "";
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
      <span class="selected-bucket">${icon("bucket", 13)}<span>${esc(name)}</span><button type="button" data-remove-bucket="${esc(name)}" aria-label="${esc(name)}を選択解除">${icon("x", 12)}</button></span>
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
      bucketStatus.textContent = `${names.length}件のバケットを選択中`;
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
      bucketStatus.textContent = `${filteredBuckets.length} / ${bucketOptions.length} バケットを表示 · ${selectedBucketNames.size}件選択`;
    } else {
      searchInput.removeAttribute("aria-activedescendant");
      optionsPanel.innerHTML = `<div class="bucket-empty">${icon("search-x", 18)}<span><strong>該当するバケットがありません</strong><small>名前、ロケーション、ストレージクラスで検索できます。</small></span></div>`;
      bucketStatus.className = "bucket-status";
      bucketStatus.textContent = `0 / ${bucketOptions.length} バケットを表示`;
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
        bucketStatus.textContent = "このプロジェクトで選択可能なバケットはありません。";
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
    bucketStatus.textContent = "プロジェクトIDを確認して「バケットを取得」を押してください。";
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
    bucketStatus.textContent = "プロジェクトを変更しました。バケットを再取得してください。";
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
      bucketStatus.textContent = "一覧から登録するバケットを1件以上選択してください。";
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
      const skippedText = result.skipped?.length ? `、${result.skipped.length}件は登録済みのためスキップ` : "";
      notify(`${result.sources.length}件のバケットを登録しました${skippedText}。`, "success");
      renderKnowledge();
      refreshIcons();
    } catch (error) { notify(error.message); }
  });
  document.querySelectorAll("[data-sync-source]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await json(`/api/knowledge-sources/${button.dataset.syncSource}/sync`, { method: "POST" });
      state.knowledgeSources = state.knowledgeSources.map((item) => item.id === result.source.id ? result.source : item);
      notify(`${result.source.objectCount}ファイル、${result.source.chunkCount}チャンクを同期しました。`, "success");
      renderKnowledge(); refreshIcons();
    } catch (error) { notify(error.message); button.disabled = false; }
  }));
  document.querySelectorAll("[data-upload-source]").forEach((input) => input.addEventListener("change", async () => {
    const files = [...input.files];
    if (!files.length) return;
    try {
      for (const file of files) {
        if (file.size > 4 * 1024 * 1024) throw new Error(`${file.name} は4MBを超えています。`);
        await json(`/api/knowledge-sources/${input.dataset.uploadSource}/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, contentType: file.type, contentBase64: bytesToBase64(await file.arrayBuffer()) })
        });
      }
      notify(`${files.length}ファイルをGCSへアップロードしました。同期すると検索対象になります。`, "success");
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
      notify("接続を確認しました。BigQueryクエリは実行していません。", "success");
      renderAgents();
    } catch (error) { notify(error.message); button.disabled = false; }
  }));
}

function renderSheets() {
  const suiteOptions = state.suites
    .map((suite) => `<option value="${suite.id}">${esc(suite.name)} · ${suite.cases?.length || 0}ケース</option>`)
    .join("");
  const reportOptions = state.suiteRuns
    .map((run) => `<option value="${run.id}">${esc(run.suiteName)} · ${fmtDate(run.createdAt)} · ${run.summary?.passRate || 0}%</option>`)
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
        <div><strong>固定タブと列定義</strong><p><code>${esc(state.sheetFormat?.suiteTab || "AgentEval_TestSuite")}</code> と <code>${esc(state.sheetFormat?.reportTab || "AgentEval_Report")}</code> のみをアプリが再作成します。ユーザー作成タブは変更しません。</p></div>
        <b>スキーマ v${state.sheetFormat?.schemaVersion || 1}</b>
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
      const connection = await json("/api/sheets/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))
      });
      updateSheetConnection(connection);
      notify(`${connection.title} に接続しました。`, "success");
      renderSheets(); refreshIcons();
    } catch (error) { notify(error.message); button.disabled = false; }
  });
  document.querySelectorAll("[data-check-sheet]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const connection = await json(`/api/sheets/connections/${button.dataset.checkSheet}/check`, { method: "POST" });
      updateSheetConnection(connection);
      notify("Google Sheets APIへの接続を確認しました。", "success");
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
      notify(`${result.tabName} に${result.rowCount}行を書き出しました。`, "success");
      renderSheets(); refreshIcons();
    } catch (error) { notify(error.message); button.disabled = false; }
  }));
  document.querySelectorAll("[data-import-suite]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("固定フォーマットを検証してテストスイートを取り込みます。続けますか？")) return;
    button.disabled = true;
    try {
      const result = await json(`/api/sheets/connections/${button.dataset.importSuite}/import-suite`, { method: "POST" });
      updateSheetConnection(result.connection);
      state.suites = [result.suite, ...state.suites.filter((item) => item.id !== result.suite.id)];
      notify(`テストスイートを${result.mode === "updated" ? "更新" : "新規作成"}しました。`, "success");
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
      notify(`${result.tabName} に評価結果を書き出しました。`, "success");
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
          <div><dt>保存データ</dt><dd>${Number(config.objectCount || 0).toLocaleString("ja-JP")}件 · ${fmtBytes(config.sizeBytes || 0)}</dd></div>
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
      notify("プライマリーストレージ設定を保存しました。", "success");
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
    notify(mode === "sync" ? "指定した保存先へデータを同期しました。" : `${copied == null ? "" : `${copied}件の`}データをコピーし、保存先を切り替えました。`, "success");
    renderSettings();
  } catch (error) {
    notify(error.message);
    button.disabled = false;
  }
}

function renderReports() {
  const rows = state.suiteRuns.map((run) => `<tr><td><a href="#/reports/${run.id}"><strong>${esc(run.suiteName)}</strong><small>${fmtDate(run.createdAt)}</small></a></td><td>${statusPill(run.status)}</td><td><strong>${run.summary?.passRate || 0}%</strong></td><td>${run.summary?.passed || 0} / ${run.summary?.total || 0}</td><td>${fmtDuration(run.summary?.totalDurationMs)}</td><td>${fmtBytes(run.summary?.totalBytesBilled)}</td></tr>`).join("");
  app.innerHTML = shell(`${pageHead("評価レポート", "スイートの品質、速度、BigQuery利用量をチーム共有向けにまとめます。")}<section class="table-panel"><table><thead><tr><th>テストスイート</th><th>結果</th><th>合格率</th><th>合格ケース</th><th>所要時間</th><th>課金量</th></tr></thead><tbody>${rows}</tbody></table>${rows ? "" : empty("レポートがありません", "テストスイートを実行するとここに表示されます。")}</section>`, "reports");
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
      return `<article class="report-case ${item.status}">
        <header><span>${statusPill(item.status)}</span><div><strong>${esc(item.title)}</strong><small>${esc(item.caseId)}</small></div>${gradeBadge(business)}</header>
        ${item.error ? `<p class="error-text">${esc(item.error)}</p>` : ""}
        <div class="evaluation-layers">
          <section><div class="layer-title"><strong>システム要件</strong><b>${system.passedCount || 0}/${system.checkCount || 0} 合格 · ${system.score ?? 0}点</b></div><div class="checks">${(system.checks || []).map((check) => `<span class="${check.passed ? "ok" : "ng"}">${icon(check.passed ? "check" : "x", 13)}${esc(check.label)}</span>`).join("")}</div></section>
          <section class="business-result"><div class="layer-title"><strong>ビジネス要件</strong></div>${business?.status === "not_configured" || !business ? `<p class="muted-copy">このケースには精度条件が設定されていません。</p>` : `<p><strong>${esc(business.summary || "判定理由はありません。")}</strong></p><details><summary>精度判定の詳細</summary><dl><dt>期待条件</dt><dd>${esc(business.expectedCriteria || "")}</dd><dt>差分</dt><dd>${esc((business.discrepancies || []).join(" / ") || "なし")}</dd><dt>判定モデル</dt><dd>${esc(business.judgeAudit?.model || "—")}</dd></dl></details>`}</section>
        </div>
        ${item.runId ? `<a href="#/runs/${item.runId}" class="text-link">実行トレースを見る ${icon("arrow-right", 14)}</a>` : ""}
      </article>`;
    }
    const active = report.currentCase?.caseId === testCase.id;
    const phaseLabel = {
      running: "Data Agentを実行中",
      evaluating_system: "システム要件を確認中",
      evaluating_business: "Geminiで回答精度を判定中"
    }[report.currentCase?.phase] || "実行待ち";
    return `<article class="report-case ${active ? "case-running" : "case-pending"}">
      <header>
        <span class="${active ? "live-spinner" : "case-index"}">${active ? "" : String(index + 1).padStart(2, "0")}</span>
        <div><strong>${esc(testCase.title)}</strong><small>${active ? phaseLabel : "実行待ち"}</small></div>
        <b>${active ? "実行中" : "—"}</b>
      </header>
      <div class="skeleton-layer"><strong>システム要件</strong><div class="skeleton-checks"><i></i><i></i><i></i></div></div>
      <div class="skeleton-layer"><strong>ビジネス要件</strong><div class="skeleton-grade"></div></div>
    </article>`;
  }).join("");
  const sheetExport = report.sheetExport || { status: "pending" };
  const sheetPanel = sheetExport.status === "succeeded"
    ? `<section class="sheet-export-status succeeded">${icon("sheet", 20)}<div><strong>評価レポートをGoogle Sheetsへ自動出力しました</strong><p>${esc(sheetExport.spreadsheetTitle)} · ${esc(sheetExport.tabName)} · ${sheetExport.rowCount || 0}行</p></div><a class="button accent" href="${esc(sheetExport.spreadsheetUrl)}" target="_blank" rel="noreferrer">シートを開く ${icon("external-link", 14)}</a></section>`
    : sheetExport.status === "exporting"
      ? `<section class="sheet-export-status exporting"><span class="live-spinner"></span><div><strong>Google Sheetsへ評価レポートを書き戻しています</strong><p>レポートは完成しています。このまま自動出力の完了を待ちます。</p></div></section>`
      : sheetExport.status === "failed"
        ? `<section class="sheet-export-status failed">${icon("triangle-alert", 20)}<div><strong>Google Sheetsへの自動出力に失敗しました</strong><p>${esc(sheetExport.message)}</p></div><a class="button secondary" href="#/sheets">Sheets連携を確認</a></section>`
        : sheetExport.status === "skipped"
          ? `<section class="sheet-export-status skipped">${icon("info", 20)}<div><strong>Google Sheetsへの自動出力は行われませんでした</strong><p>${esc(sheetExport.message)}</p></div><a class="button secondary" href="#/sheets">Sheets連携を設定</a></section>`
          : "";
  const actions = `<div class="head-actions">${sheetExport.status === "succeeded" ? `<a class="button accent" href="${esc(sheetExport.spreadsheetUrl)}" target="_blank" rel="noreferrer">${icon("sheet", 15)}シートを開く</a>` : ""}<button onclick="window.print()" class="button secondary" ${isRunning ? "disabled" : ""}>${icon("printer", 15)}印刷</button></div>`;
  app.innerHTML = shell(`
    ${pageHead(report.suiteName, `${fmtDate(report.createdAt)} · ${report.id}`, actions)}
    <section class="report-hero ${report.status}">
      <div class="overall-score"><span>${isRunning ? "実行進捗" : "総合スコア"}</span><strong>${isRunning ? completed : overallScore ?? "—"}<small>/${isRunning ? total : 100}</small></strong>${!isRunning && businessConfigured > 0 ? `<em>システム 40% + ビジネス 60%</em>` : !isRunning ? `<em>ビジネス要件未評価のためシステムスコアを採用</em>` : ""}</div>
      <div class="ring score-ring system-ring" style="--progress:${systemScore};--ring-color:#65a0ff"><b>${scoreText(systemScore)}</b><span>システム要件</span></div>
      <div class="ring score-ring business-ring ${businessScore === null ? "unscored" : ""}" style="--progress:${businessScore ?? 0};--ring-color:#c084fc"><b>${scoreText(businessScore)}</b><span>ビジネス要件</span></div>
      <div class="hero-copy">${statusPill(report.status)}<h2>${isRunning ? `${report.currentCase?.title || "実行準備中"}を処理しています` : report.status === "passed" ? "すべてのケースが基準を満たしました" : "改善が必要なケースがあります"}</h2><p>${isRunning ? "ケースが完了するたびに、この評価レポートへ結果が追加されます。" : `${report.summary?.passed || 0}件合格 / ${report.summary?.failed || 0}件不合格`}</p></div>
      ${isRunning ? `<div class="live-progress"><span style="width:${progress}%"></span></div>` : ""}
    </section>
    <section class="report-metrics"><div><span>システム要件 正解率</span><strong>${scoreText(systemScore)}</strong><small>${report.summary?.systemPassed ?? report.summary?.passed ?? 0} / ${completed} ケース合格</small></div><div><span>ビジネス要件 正解率</span><strong>${scoreText(businessScore)}</strong><small>${businessConfigured ? `${report.summary?.businessEvaluated || 0} / ${businessConfigured} ケース採点済み` : "精度条件未設定"}</small></div><div><span>精度 A / B / C / D</span><strong>${report.summary?.accuracyGrades?.A || 0} / ${report.summary?.accuracyGrades?.B || 0} / ${report.summary?.accuracyGrades?.C || 0} / ${report.summary?.accuracyGrades?.D || 0}</strong></div><div><span>所要時間</span><strong>${fmtDuration(report.summary?.totalDurationMs)}</strong><small>${completed} / ${total} ケース完了</small></div></section>
    ${report.evaluationCorrection?.applied ? `<section class="evaluation-correction">${icon("shield-check", 18)}<div><strong>SQL実行証跡を再評価しました</strong><p>${esc(report.evaluationCorrection.reason)}</p></div></section>` : ""}
    ${sheetPanel}
    <div class="section-row"><div><h2>ケース別評価</h2><p>${isRunning ? "完了したケースから評価内容を表示します。" : "失敗した条件から改善ポイントを特定できます。"}</p></div><b class="live-updated">${isRunning ? `${completed}/${total} 完了 · 自動更新中` : `完了 ${fmtDate(report.completedAt)}`}</b></div>
    <section class="report-cases">${cases}</section>
  `, "reports");
  if (isRunning || sheetExport.status === "exporting") {
    state.reportPollTimer = setTimeout(async () => {
      if (location.hash !== `#/reports/${report.id}`) return;
      try {
        const updated = await json(`/api/suite-runs/${report.id}`);
        state.suiteRuns = [updated, ...state.suiteRuns.filter((item) => item.id !== updated.id)];
        renderReport(updated);
        refreshIcons();
      } catch (error) {
        notify(`進捗の更新に失敗しました: ${error.message}`);
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
    if (!confirm("BigQuery利用料金が発生する可能性があります。実行しますか？")) return;
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
    return `<article class="trace-event"><span class="trace-dot ${event.severity}"></span><div><header><strong>${esc(event.label)}</strong><code>${esc(event.kind)} · #${index + 1}</code></header>${body}</div></article>`;
  }).join("");
  const breadcrumbs = context
    ? `<nav class="breadcrumbs" aria-label="パンくず"><a href="#/suites">テストスイート</a>${icon("chevron-right", 12)}<a href="#/suites/${context.suiteId}/edit">${esc(context.suiteName)}</a>${icon("chevron-right", 12)}<a href="#/reports/${context.suiteRunId}">評価レポート</a>${icon("chevron-right", 12)}<span>${esc(context.caseTitle)}</span></nav>`
    : `<nav class="breadcrumbs" aria-label="パンくず"><a href="#/run">テスト実行</a>${icon("chevron-right", 12)}<span>実行詳細</span></nav>`;
  const title = context?.suiteName || run.agentLabel || "単一テスト実行";
  const subtitle = context?.caseTitle || "単一プロンプトの実行";
  const actions = `<div class="head-actions">${context ? `<a class="button secondary" href="#/reports/${context.suiteRunId}">${icon("arrow-left", 15)}評価レポートへ戻る</a>` : `<a class="button secondary" href="#/run">${icon("arrow-left", 15)}テスト実行へ戻る</a>`}<button onclick="window.print()" class="button secondary">${icon("printer", 15)}印刷</button></div>`;
  app.innerHTML = shell(`
    ${breadcrumbs}
    ${pageHead(title, subtitle, actions)}
    <section class="run-context"><div><span>選択中のケース</span><strong>${esc(subtitle)}</strong></div><div><span>検証プロンプト</span><p>${esc(run.question)}</p></div><code>${esc(run.id)}</code></section>
    <section class="report-metrics"><div><span>結果</span><strong>${esc(run.summary.status)}</strong></div><div><span>所要時間</span><strong>${fmtDuration(run.summary.durationMs)}</strong></div><div><span>課金対象</span><strong>${fmtBytes(run.summary.totalBytesBilled)}</strong></div><div><span>SQL / ジョブ</span><strong>${run.summary.sqlCount} / ${run.summary.jobCount}</strong></div></section>
    ${caseRun ? `<section class="run-evaluation-summary">
      <article><div class="layer-title"><strong>システム要件</strong><b>${systemEvaluation?.score ?? 0}点</b></div><div class="checks">${(systemEvaluation?.checks || []).map((check) => `<span class="${check.passed ? "ok" : "ng"}">${icon(check.passed ? "check" : "x", 13)}${esc(check.label)}</span>`).join("")}</div></article>
      <article><div class="layer-title"><strong>ビジネス要件</strong>${gradeBadge(businessEvaluation)}</div><p>${esc(businessEvaluation?.summary || "精度条件は設定されていません。")}</p>${businessEvaluation?.expectedCriteria ? `<dl><dt>期待した内容</dt><dd>${esc(businessEvaluation.expectedCriteria)}</dd><dt>回答との差分</dt><dd>${esc((businessEvaluation.discrepancies || []).join(" / ") || "なし")}</dd></dl>` : ""}</article>
    </section>` : ""}
    <section class="trace-panel"><div class="section-row"><div><h2>レスポンストレース</h2><p>${run.events.length}件のイベント · ${esc(run.agentLabel)}</p></div></div>${events}</section>
  `, "run");
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
      }
      state.selectedSuite = await json(`/api/suites/${parts[1]}`);
      state.assistantMessages = [];
      state.assistantPatch = null;
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
    app.innerHTML = empty("起動できませんでした", error.message);
  }
}

window.addEventListener("hashchange", route);
app.addEventListener("click", (event) => {
  const toggle = event.target.closest("#sidebar-toggle");
  if (!toggle) return;
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem("prismtrail-sidebar-collapsed", String(state.sidebarCollapsed));
  route();
});
initialize();
