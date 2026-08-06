import {
  formatLocaleDate,
  formatLocaleNumber,
  getLocale,
  localizeDocument,
  setLocale,
  tr,
  translateApiMessage
} from "./i18n.js";
import Fuse from "/vendor/fuse.min.mjs";

const QUICK_SEARCH_RECENT_KEY = "prismtrail-quick-search-recent";
const QUICK_SEARCH_RECENT_LIMIT = 8;
const MCP_CLIENTS = Object.freeze({
  codex: {
    label: "Codex CLI / Desktop",
    description: "OpenAI CodexでPrismTrailのMCPツールを使う",
    envName: "PRISMTRAIL_MCP_TOKEN"
  },
  claude: {
    label: "Claude Code",
    description: "Claude CodeのHTTP MCPサーバーとして登録する",
    envName: "PRISMTRAIL_MCP_TOKEN"
  },
  cursor: {
    label: "Cursor",
    description: "Cursorのプロジェクト／グローバルMCPサーバーとして登録する",
    envName: "PRISMTRAIL_MCP_TOKEN"
  },
  generic: {
    label: "汎用MCPクライアント",
    description: "URLとBearer Tokenを個別に設定する",
    envName: "PRISMTRAIL_MCP_TOKEN"
  }
});

const state = {
  config: null,
  authReadiness: null,
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
  mcpConfig: null,
  mcpNewToken: null,
  mcpClient: "codex",
  settingsTab: ["auth", "sheets", "storage", "mcp"].includes(localStorage.getItem("prismtrail-settings-tab"))
    ? localStorage.getItem("prismtrail-settings-tab")
    : "auth",
  selectedSuite: null,
  selectedCaseIndex: 0,
  editorTab: "cases",
  selectedRun: null,
  activeReport: null,
  selectedReportCaseId: null,
  reportCaseFilter: "all",
  runDetailTab: "summary",
  suiteVersions: [],
  selectedSuiteVersionId: null,
  selectedSuiteVersion: null,
  suiteVersionsBusy: false,
  knowledgePlan: null,
  selectedKnowledgeDetail: null,
  reportPollTimer: null,
  quickSearchOpen: false,
  quickSearchQuery: "",
  quickSearchIndex: 0,
  quickSearchResults: [],
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

function relatedUrlLinks(urls = []) {
  return (Array.isArray(urls) ? urls : [])
    .map((value) => {
      const raw = String(value || "").trim();
      try {
        const parsed = new URL(raw);
        if (!["http:", "https:"].includes(parsed.protocol)) return "";
        return `<a href="${esc(raw)}" target="_blank" rel="noopener noreferrer">${icon("external-link", 12)}<span>${esc(raw)}</span></a>`;
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("");
}

function fmtDate(value) {
  return value ? formatLocaleDate(value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : tr("未実行", "Never");
}

/** Display name for a suite evaluation run: 実行時刻_テストスイート名 */
function suiteRunLabel(run) {
  const when = fmtDate(run?.createdAt || run?.completedAt);
  const name = String(run?.suiteName || "").trim() || tr("無題のテストスイート", "Untitled suite");
  return `${when}_${name}`;
}

function suiteAgentIds(suite = {}) {
  const fallback = String(suite.defaultAgentId || "").trim();
  const ids = new Set(fallback ? [fallback] : []);
  for (const testCase of suite.cases || []) {
    const agentId = String(testCase.agentId || fallback).trim();
    if (agentId) ids.add(agentId);
  }
  return [...ids];
}

function suiteAgentId(suite = {}) {
  const ids = suiteAgentIds(suite);
  return ids.length === 1 ? ids[0] : null;
}

function suiteRunAgentId(run = {}) {
  return suiteAgentId(run.suiteSnapshot || state.suites.find((suite) => suite.id === run.suiteId) || {});
}

function sheetConnectionForAgent(agentId, { readyOnly = false } = {}) {
  return state.sheetConnections.find((connection) =>
    connection.agentId === agentId &&
    connection.spreadsheetUrl &&
    (!readyOnly || connection.status === "ready")
  ) || null;
}

function agentLabel(agentId) {
  return state.agents.find((agent) => agent.id === agentId)?.displayName || agentId || tr("未割当", "Unassigned");
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

const routeProgress = document.querySelector("#route-progress");
const busyOverlay = document.querySelector("#busy-overlay");
const busyOverlayLabel = document.querySelector("#busy-overlay-label");
let routeProgressDepth = 0;
let busyOverlayDepth = 0;

function setRouteProgress(active) {
  if (!routeProgress) return;
  routeProgressDepth = Math.max(0, routeProgressDepth + (active ? 1 : -1));
  const on = routeProgressDepth > 0;
  routeProgress.hidden = !on;
  routeProgress.setAttribute("aria-hidden", on ? "false" : "true");
  routeProgress.classList.toggle("is-active", on);
  document.body.classList.toggle("is-routing", on);
}

function setBusyOverlay(active, label = "") {
  if (!busyOverlay) return;
  busyOverlayDepth = Math.max(0, busyOverlayDepth + (active ? 1 : -1));
  const on = busyOverlayDepth > 0;
  if (active && label && busyOverlayLabel) busyOverlayLabel.textContent = label;
  busyOverlay.hidden = !on;
  document.body.classList.toggle("is-app-busy", on);
}

async function withRouteProgress(task) {
  setRouteProgress(true);
  try {
    return await task();
  } finally {
    setRouteProgress(false);
  }
}

async function withButtonBusy(button, busyLabel, task, { overlay = false } = {}) {
  if (!button) return task();
  if (button.dataset.busy === "1") return undefined;
  const originalHtml = button.innerHTML;
  button.dataset.busy = "1";
  button.disabled = true;
  button.classList.add("is-busy");
  button.setAttribute("aria-busy", "true");
  button.innerHTML = `${icon("loader-circle", 15)}${esc(busyLabel)}`;
  refreshIcons();
  if (overlay) setBusyOverlay(true, busyLabel);
  try {
    return await task();
  } finally {
    if (overlay) setBusyOverlay(false);
    button.dataset.busy = "0";
    button.disabled = false;
    button.classList.remove("is-busy");
    button.setAttribute("aria-busy", "false");
    button.innerHTML = originalHtml;
    refreshIcons();
  }
}

/** In-app confirm — native window.confirm can be silently blocked by the browser. */
function askConfirm(message, { confirmLabel = tr("続ける", "Continue"), cancelLabel = tr("キャンセル", "Cancel") } = {}) {
  return new Promise((resolve) => {
    const existing = document.querySelector("#app-confirm-dialog");
    existing?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "app-confirm-dialog";
    dialog.className = "app-confirm-dialog";
    dialog.innerHTML = `
      <form method="dialog" class="app-confirm-shell">
        <header><h2>${tr("確認", "Confirm")}</h2></header>
        <p>${esc(message)}</p>
        <footer>
          <button value="cancel" class="button secondary" type="submit">${esc(cancelLabel)}</button>
          <button value="confirm" class="button primary" type="submit">${esc(confirmLabel)}</button>
        </footer>
      </form>`;
    document.body.appendChild(dialog);
    const finish = (result) => {
      dialog.removeEventListener("close", onClose);
      dialog.remove();
      resolve(result);
    };
    const onClose = () => finish(dialog.returnValue === "confirm");
    dialog.addEventListener("close", onClose);
    dialog.showModal();
    dialog.querySelector('button[value="confirm"]')?.focus();
  });
}

async function json(url, options) {
  const requiredFeature = googleAuthFeatureForRequest(url, options);
  const readiness = requiredFeature
    ? state.authReadiness?.features?.find((feature) => feature.id === requiredFeature)
    : null;
  if (readiness && ["missing", "unavailable"].includes(readiness.status)) {
    throw new Error(tr(
      "Google認証の準備が完了していません。設定 → Google認証でADCと必要scopeを確認してください。",
      "Google authentication is not ready. Open Settings → Google authentication and verify ADC scopes."
    ));
  }
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(translateApiMessage(body.error?.message || body.error || `HTTP ${response.status}`));
  return body;
}

function googleAuthFeatureForRequest(rawUrl, options = {}) {
  const method = String(options?.method || "GET").toUpperCase();
  const path = String(rawUrl || "").split("?")[0];
  if (path.startsWith("/api/sheets/") && method !== "GET") return "sheets";
  if (method === "POST" && (/^\/api\/runs$/.test(path) || /^\/api\/suites\/[^/]+\/run$/.test(path))) return "cloud";
  if (method === "POST" && /^\/api\/agents\/[^/]+\/check$/.test(path)) return "cloud";
  if (path.startsWith("/api/gcs/")) return "cloud";
  if (/^\/api\/knowledge-sources\/[^/]+(?:\/(?:sync|upload))?$/.test(path)) return "cloud";
  if (method === "POST" && (path === "/api/knowledge/plan" || /\/assistant$/.test(path))) return "cloud";
  if (method !== "GET" && path.startsWith("/api/storage/")) {
    try {
      const body = JSON.parse(options?.body || "{}");
      if (body.driver === "gcs" || body.destination?.driver === "gcs") return "cloud";
    } catch {
      return null;
    }
  }
  return null;
}

function googleAuthStatus() {
  const status = state.authReadiness?.status || "checking";
  return {
    status,
    ready: status === "ready",
    label: ({ ready: tr("認証準備OK", "Auth ready"), limited: tr("scope不足", "Missing scopes"), unavailable: tr("ADC未設定", "ADC unavailable"), unknown: tr("確認できません", "Unable to verify"), checking: tr("確認中", "Checking") })[status],
    detail: status === "ready"
      ? tr("必要scopeを確認済み", "Required scopes verified")
      : state.authReadiness?.message || tr("Google認証を確認しています", "Checking Google authentication")
  };
}

function googleAuthBanner() {
  const auth = googleAuthStatus();
  if (auth.ready || auth.status === "checking") return "";
  const iconName = auth.status === "unavailable" ? "circle-x" : auth.status === "unknown" ? "circle-help" : "triangle-alert";
  return `<section class="global-auth-alert ${esc(auth.status)}" role="status">
    ${icon(iconName, 18)}
    <div><strong>${esc(auth.label)}</strong><p>${esc(auth.detail)}</p></div>
    <button id="recheck-google-auth-banner" class="button secondary small" type="button">${icon("refresh-cw", 13)}${tr("認証状態を再確認", "Recheck authentication")}</button>
  </section>`;
}

function isApplePlatform() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || "") || navigator.userAgentData?.platform === "macOS";
}

function quickSearchShortcutLabel() {
  return isApplePlatform() ? "⌘K" : "Ctrl K";
}

function readQuickSearchRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(QUICK_SEARCH_RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((item) => item?.id && item?.title).slice(0, QUICK_SEARCH_RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function pushQuickSearchRecent(entry) {
  if (!entry?.id) return;
  const next = [
    { id: entry.id, title: entry.title, subtitle: entry.subtitle || "", group: entry.group || "", icon: entry.icon || "search" },
    ...readQuickSearchRecent().filter((item) => item.id !== entry.id)
  ].slice(0, QUICK_SEARCH_RECENT_LIMIT);
  localStorage.setItem(QUICK_SEARCH_RECENT_KEY, JSON.stringify(next));
}

function quickSearchScope() {
  const parts = location.hash.replace(/^#\//, "").split("/").filter(Boolean);
  if (parts[0] === "suites" && parts[1]) {
    const suite = state.selectedSuite?.id === parts[1]
      ? state.selectedSuite
      : state.suites.find((item) => item.id === parts[1]);
    return suite ? { type: "suite", suiteId: suite.id, suite, report: null } : null;
  }
  if (parts[0] === "reports" && parts[1]) {
    const report = state.activeReport?.id === parts[1]
      ? state.activeReport
      : state.suiteRuns.find((item) => item.id === parts[1]);
    if (!report) return null;
    const suite = state.suites.find((item) => item.id === report.suiteId) || null;
    return { type: "report", suiteId: report.suiteId, suite, report };
  }
  if (parts[0] === "runs" && parts[1]) {
    const run = state.selectedRun?.id === parts[1]
      ? state.selectedRun
      : state.runs.find((item) => item.id === parts[1]);
    const reportId = run?.context?.suiteRunId;
    const report = state.activeReport?.id === reportId
      ? state.activeReport
      : state.suiteRuns.find((item) => item.id === reportId);
    if (!report) return null;
    const suite = state.suites.find((item) => item.id === report.suiteId) || null;
    return { type: "run", suiteId: report.suiteId, suite, report, run };
  }
  return null;
}

function buildScopedQuickSearchCatalog(scope) {
  const report = scope.report;
  const suite = scope.suite;
  const suiteId = scope.suiteId || report?.suiteId || suite?.id;
  const sourceCases = report?.suiteSnapshot?.cases || suite?.cases || [];
  const caseRuns = new Map((report?.caseRuns || []).map((item) => [item.caseId, item]));
  const reportId = report?.id;
  const cases = sourceCases.map((item, index) => {
    const caseId = item.id || item.caseId || `case-${index + 1}`;
    const href = reportId
      ? `#/reports/${reportId}/cases/${encodeURIComponent(caseId)}`
      : `#/suites/${suiteId}/edit/${encodeURIComponent(caseId)}`;
    return {
      id: `scope-case:${suiteId}:${caseId}`,
      group: "cases",
      groupLabel: tr("このテストスイートのケース", "Cases in this test suite"),
      title: String(item.title || "").trim() || tr("無題のケース", "Untitled case"),
      subtitle: `${String(index + 1).padStart(2, "0")} · ${caseId}`,
      keywords: `${caseId} ${item.prompt || ""} ${item.memo || ""}`,
      icon: "list-checks",
      href,
      suiteId,
      caseId,
      scoped: true
    };
  });
  const runs = sourceCases.flatMap((item, index) => {
    const caseId = item.id || item.caseId || `case-${index + 1}`;
    const caseRun = caseRuns.get(caseId);
    if (!caseRun?.runId) return [];
    return [{
      id: `scope-run:${caseRun.runId}`,
      group: "runs",
      groupLabel: tr("このテストスイートの実行詳細", "Run details in this test suite"),
      title: tr("{title}の実行詳細", "Run details for {title}", { title: item.title || caseId }),
      subtitle: `${caseId} · ${caseRun.runId}`,
      keywords: `${caseId} ${caseRun.runId} ${item.title || ""}`,
      icon: "list-tree",
      href: `#/runs/${caseRun.runId}`,
      suiteId,
      caseId,
      scoped: true
    }];
  });
  const contextItems = [];
  if (reportId) {
    contextItems.push({
      id: `scope-report:${reportId}`,
      group: "context",
      groupLabel: tr("このテストスイート", "This test suite"),
      title: tr("テスト実行結果の全体サマリー", "Test run result summary"),
      subtitle: suiteRunLabel(report),
      keywords: `${reportId} ${report.suiteName || ""}`,
      icon: "chart-no-axes-combined",
      href: `#/reports/${reportId}`,
      scoped: true
    });
  }
  if (suiteId) {
    contextItems.push({
      id: `scope-suite:${suiteId}`,
      group: "context",
      groupLabel: tr("このテストスイート", "This test suite"),
      title: tr("テストスイートを開く", "Open test suite"),
      subtitle: suite?.name || report?.suiteName || suiteId,
      keywords: `${suiteId} ${suite?.description || ""}`,
      icon: "layers-3",
      href: `#/suites/${suiteId}/edit`,
      scoped: true
    });
  }
  return [...cases, ...runs, ...contextItems];
}

function highlightFuseValue(text, indices = []) {
  const value = String(text || "");
  if (!value || !indices.length) return esc(value);
  const marks = Array.from({ length: value.length }, () => false);
  for (const pair of indices) {
    const start = Number(pair?.[0]);
    const end = Number(pair?.[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    for (let i = Math.max(0, start); i <= Math.min(value.length - 1, end); i += 1) marks[i] = true;
  }
  let html = "";
  let i = 0;
  while (i < value.length) {
    const marked = marks[i];
    let j = i + 1;
    while (j < value.length && marks[j] === marked) j += 1;
    const chunk = esc(value.slice(i, j));
    html += marked ? `<mark>${chunk}</mark>` : chunk;
    i = j;
  }
  return html;
}

function buildQuickSearchCatalog() {
  const scope = quickSearchScope();
  if (scope) return buildScopedQuickSearchCatalog(scope);
  const pages = [
    {
      id: "page:suites",
      group: "pages",
      groupLabel: tr("ページ", "Pages"),
      title: tr("テストスイート", "Test suites"),
      subtitle: tr("スイート一覧を開く", "Open suite list"),
      keywords: "suites list home",
      icon: "layers-3",
      href: "#/suites"
    },
    {
      id: "page:reports",
      group: "pages",
      groupLabel: tr("ページ", "Pages"),
      title: tr("テスト実行結果", "Test run results"),
      subtitle: tr("スイート実行結果", "Suite run results"),
      keywords: "reports evaluation",
      icon: "chart-no-axes-combined",
      href: "#/reports"
    },
    {
      id: "page:agents",
      group: "pages",
      groupLabel: tr("ページ", "Pages"),
      title: tr("データエージェント", "Data agents"),
      subtitle: tr("接続先Agent一覧", "Connected agents"),
      keywords: "agents data",
      icon: "bot",
      href: "#/agents"
    },
    {
      id: "page:sheets",
      group: "pages",
      groupLabel: tr("ページ", "Pages"),
      title: "Google Sheets",
      subtitle: tr("シート連携", "Sheets integration"),
      keywords: "sheets google spreadsheet",
      icon: "sheet",
      href: "#/settings/sheets"
    },
    {
      id: "page:settings",
      group: "pages",
      groupLabel: tr("ページ", "Pages"),
      title: tr("設定", "Settings"),
      subtitle: tr("認証・Sheets・ストレージ・MCP", "Authentication, Sheets, storage, and MCP"),
      keywords: "settings auth sheets storage mcp",
      icon: "settings-2",
      href: "#/settings"
    }
  ];

  const suites = (state.suites || []).map((suite) => ({
    id: `suite:${suite.id}`,
    group: "suites",
    groupLabel: tr("テストスイート", "Test suites"),
    title: suite.name || suite.id,
    subtitle: tr("{count} ケース · {id}", "{count} cases · {id}", {
      count: formatLocaleNumber(suite.cases?.length || 0),
      id: suite.id
    }),
    keywords: `${suite.id} ${suite.description || ""}`,
    icon: "layers-3",
    href: `#/suites/${suite.id}/edit`,
    suiteId: suite.id
  }));

  const reports = (state.suiteRuns || []).slice(0, 40).map((run) => ({
    id: `report:${run.id}`,
    group: "reports",
    groupLabel: tr("テスト実行結果", "Test run results"),
    title: suiteRunLabel(run),
    subtitle: `${run.status || "—"} · ${run.id}`,
    keywords: `${run.id} ${run.suiteName || ""} ${run.suiteId || ""}`,
    icon: "chart-no-axes-combined",
    href: `#/reports/${run.id}`
  }));

  const agents = (state.agents || []).map((agent) => ({
    id: `agent:${agent.id}`,
    group: "agents",
    groupLabel: tr("データエージェント", "Data agents"),
    title: agent.displayName || agent.id,
    subtitle: agent.resourceName || agent.id,
    keywords: `${agent.id} ${agent.resourceName || ""}`,
    icon: "bot",
    href: `#/agents/${agent.id}`
  }));

  const cases = [];
  const suiteList = [];
  const seenSuiteIds = new Set();
  for (const suite of state.suites || []) {
    const live = state.selectedSuite?.id === suite.id ? state.selectedSuite : suite;
    suiteList.push(live);
    seenSuiteIds.add(live.id);
  }
  if (state.selectedSuite?.id && !seenSuiteIds.has(state.selectedSuite.id)) {
    suiteList.unshift(state.selectedSuite);
  }
  for (const suite of suiteList) {
    (suite.cases || []).forEach((item, index) => {
      const agent =
        state.agents.find((entry) => entry.id === item.agentId)?.displayName ||
        item.agentId ||
        "";
      const inCurrent = state.selectedSuite?.id === suite.id;
      cases.push({
        id: `case:${suite.id}:${item.id || index}`,
        group: "cases",
        groupLabel: inCurrent
          ? tr("このスイートのケース", "Cases in this suite")
          : tr("テストケース", "Test cases"),
        title: String(item.title || "").trim() || tr("無題のケース", "Untitled case"),
        subtitle: `${suite.name || suite.id} · ${String(index + 1).padStart(2, "0")} · ${item.id || "—"}`,
        keywords: `${item.id || ""} ${item.prompt || ""} ${item.memo || ""} ${agent} ${item.thinkingMode || ""} ${suite.name || ""}`,
        icon: "list-checks",
        href: `#/suites/${suite.id}/edit/${encodeURIComponent(item.id || "")}`,
        suiteId: suite.id,
        caseId: item.id,
        caseIndex: index,
        boost: inCurrent ? 1 : 0
      });
    });
  }
  // Prefer the open suite's cases, then other suites.
  cases.sort((left, right) => (right.boost || 0) - (left.boost || 0));

  return [...cases, ...suites, ...reports, ...agents, ...pages];
}

function searchQuickCatalog(query, catalog) {
  const q = String(query || "").trim();
  if (!q) {
    const recent = readQuickSearchRecent()
      .map((recentItem) => catalog.find((item) => item.id === recentItem.id))
      .filter(Boolean)
      .map((item) => ({ ...item, recent: true }));
    const preferred = catalog.filter((item) => item.group === "cases").slice(0, 8);
    const pages = catalog.filter((item) => item.group === "pages");
    const merged = [];
    const seen = new Set();
    for (const item of [...recent, ...preferred, ...pages]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
      if (merged.length >= 12) break;
    }
    return merged.map((item) => ({ item, matches: [] }));
  }
  const fuse = new Fuse(catalog, {
    keys: [
      { name: "title", weight: 0.55 },
      { name: "subtitle", weight: 0.2 },
      { name: "keywords", weight: 0.25 }
    ],
    threshold: 0.38,
    ignoreLocation: true,
    includeMatches: true,
    minMatchCharLength: 1,
    shouldSort: true
  });
  return fuse.search(q).slice(0, 40);
}

function matchIndicesForKey(matches, key) {
  const hit = (matches || []).find((entry) => entry.key === key);
  return hit?.indices || [];
}

function quickSearchResultsHtml(results) {
  if (!results.length) {
    return `<div class="quick-search-empty">${icon("search-x", 22)}<strong>${tr("一致する項目がありません", "No matching items")}</strong><p>${tr("ケース名・ID・プロンプト・スイート名で探せます。", "Search by case title, ID, prompt, or suite name.")}</p></div>`;
  }
  const groups = {};
  const order = [];
  for (const result of results) {
    const group = result.item.groupLabel || result.item.group || "other";
    if (!groups[group]) {
      groups[group] = [];
      order.push(group);
    }
    groups[group].push(result);
  }
  let flatIndex = 0;
  return order
    .map((group) => {
      const items = groups[group];
      return `<section class="quick-search-group">
        <header>${esc(group)}</header>
        ${items
          .map((result) => {
            const item = result.item;
            const active = flatIndex === state.quickSearchIndex;
            const index = flatIndex;
            flatIndex += 1;
            const titleHtml = highlightFuseValue(item.title, matchIndicesForKey(result.matches, "title"));
            const subtitleHtml = highlightFuseValue(item.subtitle, matchIndicesForKey(result.matches, "subtitle"));
            return `<button type="button" class="quick-search-item${active ? " active" : ""}" data-quick-index="${index}" data-quick-id="${esc(item.id)}" role="option" aria-selected="${active ? "true" : "false"}">
              <span class="quick-search-icon">${icon(item.icon || "search", 16)}</span>
              <span class="quick-search-copy"><strong>${titleHtml}</strong><small>${subtitleHtml}</small></span>
              ${item.recent ? `<em>${tr("最近", "Recent")}</em>` : `<kbd>↵</kbd>`}
            </button>`;
          })
          .join("")}
      </section>`;
    })
    .join("");
}

function closeQuickSearch() {
  state.quickSearchOpen = false;
  state.quickSearchQuery = "";
  state.quickSearchIndex = 0;
  state.quickSearchResults = [];
  document.querySelector("#quick-search-dialog")?.remove();
}

function activateQuickSearchItem(item) {
  if (!item) return;
  pushQuickSearchRecent(item);
  closeQuickSearch();
  if (item.scoped && item.href) {
    location.hash = item.href;
    return;
  }
  if (item.group === "cases" && item.suiteId && item.caseId) {
    const onEditor =
      state.selectedSuite?.id === item.suiteId &&
      location.hash.startsWith(`#/suites/${item.suiteId}/edit`);
    if (onEditor) {
      if (document.querySelector("#suite-name")) {
        try {
          state.selectedSuite = collectSuite();
        } catch {
          /* ignore mid-render */
        }
      }
      const index = state.selectedSuite.cases.findIndex((entry) => entry.id === item.caseId);
      if (index >= 0) {
        state.selectedCaseIndex = index;
        state.editorTab = "cases";
        renderEditor();
        return;
      }
    }
    location.hash = `#/suites/${item.suiteId}/edit/${encodeURIComponent(item.caseId)}`;
    return;
  }
  if (item.href) location.hash = item.href;
}

function bindQuickSearchResultEvents(results) {
  const resultsEl = document.querySelector("#quick-search-results");
  resultsEl?.querySelectorAll("[data-quick-index]").forEach((button) => {
    button.addEventListener("mouseenter", () => {
      state.quickSearchIndex = Number(button.dataset.quickIndex);
      resultsEl.querySelectorAll(".quick-search-item").forEach((item, index) => {
        item.classList.toggle("active", index === state.quickSearchIndex);
        item.setAttribute("aria-selected", index === state.quickSearchIndex ? "true" : "false");
      });
    });
    button.addEventListener("click", () => {
      const item = results[Number(button.dataset.quickIndex)]?.item;
      activateQuickSearchItem(item);
    });
  });
  resultsEl?.querySelector(".quick-search-item.active")?.scrollIntoView({ block: "nearest" });
}

function refreshQuickSearchResults() {
  const catalog = buildQuickSearchCatalog();
  const results = searchQuickCatalog(state.quickSearchQuery, catalog);
  if (state.quickSearchIndex >= results.length) state.quickSearchIndex = Math.max(0, results.length - 1);
  state.quickSearchResults = results;
  const resultsEl = document.querySelector("#quick-search-results");
  if (!resultsEl) return results;
  resultsEl.innerHTML = quickSearchResultsHtml(results);
  bindQuickSearchResultEvents(results);
  refreshIcons();
  return results;
}

function mountQuickSearchDialog() {
  const existing = document.querySelector("#quick-search-dialog");
  if (existing) return existing;
  const shortcut = quickSearchShortcutLabel();
  const scoped = Boolean(quickSearchScope());
  const dialog = document.createElement("dialog");
  dialog.id = "quick-search-dialog";
  dialog.className = "quick-search-dialog";
  dialog.innerHTML = `
    <div class="quick-search-shell">
      <label class="quick-search-input-row">
        <span>${icon("search", 18)}</span>
        <input id="quick-search-input" type="text" inputmode="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${scoped ? tr("このテストスイート内を検索…", "Search within this test suite…") : tr("ケース・スイート・レポートを検索…", "Search cases, suites, reports…")}" aria-controls="quick-search-results">
        <kbd>${esc(shortcut)}</kbd>
      </label>
      <div id="quick-search-results" class="quick-search-results" role="listbox" aria-label="${tr("検索結果", "Search results")}"></div>
      <footer class="quick-search-foot">
        ${scoped ? `<span class="quick-search-scope">${icon("focus", 12)}${tr("現在のテストスイート内", "Current test suite only")}</span>` : ""}
        <span><kbd>↑</kbd><kbd>↓</kbd> ${tr("移動", "Navigate")}</span>
        <span><kbd>↵</kbd> ${tr("開く", "Open")}</span>
        <span><kbd>Esc</kbd> ${tr("閉じる", "Close")}</span>
      </footer>
    </div>`;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeQuickSearch();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeQuickSearch();
  });
  const input = dialog.querySelector("#quick-search-input");
  // Keep the input node stable so IME composition is not destroyed on each keystroke.
  input.addEventListener("input", () => {
    state.quickSearchQuery = input.value;
    state.quickSearchIndex = 0;
    refreshQuickSearchResults();
  });
  input.addEventListener("compositionend", () => {
    state.quickSearchQuery = input.value;
    state.quickSearchIndex = 0;
    refreshQuickSearchResults();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  refreshIcons();
  return dialog;
}

function openQuickSearch({ query = "" } = {}) {
  state.quickSearchOpen = true;
  state.quickSearchQuery = query;
  state.quickSearchIndex = 0;
  mountQuickSearchDialog();
  const input = document.querySelector("#quick-search-input");
  if (input) {
    input.value = query;
    input.focus();
    if (query) input.setSelectionRange(query.length, query.length);
  }
  refreshQuickSearchResults();
}

function isImeComposing(event) {
  return Boolean(event.isComposing || event.keyCode === 229);
}

function handleQuickSearchKeydown(event) {
  const isShortcut = (event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey) && !isImeComposing(event);
  if (isShortcut) {
    event.preventDefault();
    if (state.quickSearchOpen) closeQuickSearch();
    else openQuickSearch();
    return;
  }
  if (!state.quickSearchOpen) return;
  if (isImeComposing(event)) return;
  const results = state.quickSearchResults?.length
    ? state.quickSearchResults
    : searchQuickCatalog(state.quickSearchQuery, buildQuickSearchCatalog());
  if (event.key === "Escape") {
    event.preventDefault();
    closeQuickSearch();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!results.length) return;
    state.quickSearchIndex = (state.quickSearchIndex + 1) % results.length;
    refreshQuickSearchResults();
    document.querySelector("#quick-search-input")?.focus();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (!results.length) return;
    state.quickSearchIndex = (state.quickSearchIndex - 1 + results.length) % results.length;
    refreshQuickSearchResults();
    document.querySelector("#quick-search-input")?.focus();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    activateQuickSearchItem(results[state.quickSearchIndex]?.item);
  }
}

document.addEventListener("keydown", handleQuickSearchKeydown);

async function downloadPdf(url, fallbackName = "prismtrail.pdf") {
  const response = await fetch(url);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body.error?.message || body.error || message;
    } catch {
      /* ignore non-JSON errors */
    }
    throw new Error(translateApiMessage(message));
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const matched = disposition.match(/filename=\"([^\"]+)\"/i);
  const filename = matched?.[1] || fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  return filename;
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
    cancelled: tr("中止", "Cancelled"),
    cancelling: tr("中止中", "Cancelling"),
    warning: tr("注意", "Warning"),
    ready: tr("接続済み", "Connected"),
    setup_required: tr("GCS設定が必要", "GCS setup required"),
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

function scoreGrade(score) {
  if (score === null || score === undefined || score === "") return null;
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  if (value >= 100) return "A";
  if (value >= 90) return "B";
  if (value >= 50) return "C";
  return "D";
}

function scoreGradeBadge(score, { label = tr("総合等級", "Overall grade") } = {}) {
  const grade = scoreGrade(score);
  if (!grade) return `<span class="score-grade grade-none"><small>${esc(label)}</small><b>—</b><em>${tr("未評価", "Not evaluated")}</em></span>`;
  const gradeLabel = { A: tr("優", "Excellent"), B: tr("良", "Good"), C: tr("可", "Fair"), D: tr("不可", "Poor") }[grade];
  return `<span class="score-grade grade-${grade.toLowerCase()}"><small>${esc(label)}</small><b>${grade}</b><em>${gradeLabel} · ${formatLocaleNumber(score)}${tr("点", " pts")}</em></span>`;
}

function systemGradeCounts(report = {}) {
  const initial = { A: 0, B: 0, C: 0, D: 0 };
  const summaryCounts = report.summary?.systemGrades;
  if (summaryCounts && Object.values(summaryCounts).some((value) => Number(value) > 0)) {
    return Object.fromEntries(Object.keys(initial).map((grade) => [grade, Number(summaryCounts[grade] || 0)]));
  }
  return (report.caseRuns || []).reduce((counts, item) => {
    if (!["passed", "failed", "review_required"].includes(item.status)) return counts;
    const grade = scoreGrade(item.evaluation?.system?.score ?? item.evaluation?.score);
    if (grade) counts[grade] += 1;
    return counts;
  }, initial);
}

function updateMethodLabel(method) {
  return {
    ui_create: tr("新規作成", "Created"),
    ui_edit: tr("UI編集", "UI edit"),
    sheet_paste: tr("シート貼り付け", "Sheet paste"),
    sheet_import: tr("シート取り込み", "Sheet import"),
    restore: tr("復元", "Restore")
  }[method] || method;
}

function localeSelector(compact = false) {
  const locale = getLocale();
  return `<div class="locale-switch ${compact ? "compact" : ""}" role="group" aria-label="${tr("表示言語", "Display language")}">
    <button type="button" data-set-locale="ja" class="${locale === "ja" ? "active" : ""}" aria-pressed="${locale === "ja"}" title="${tr("日本語に切り替える", "Switch to Japanese")}">JA</button>
    <button type="button" data-set-locale="en" class="${locale === "en" ? "active" : ""}" aria-pressed="${locale === "en"}" title="${tr("英語に切り替える", "Switch to English")}">EN</button>
  </div>`;
}

function storageModeSummary(config = state.storageConfig) {
  const driver = config?.driver || (config?.status === "setup_required" ? "local" : null);
  const isLocal = driver === "local" || config?.status === "setup_required";
  if (!config && !driver) {
    return {
      mode: "unknown",
      isLocal: false,
      label: tr("保存先確認中", "Checking storage"),
      detail: tr("読み込み中", "Loading"),
      title: tr("プライマリーストレージの状態を確認しています", "Checking primary storage status")
    };
  }
  if (isLocal) {
    const temporary = config?.status === "setup_required" || config?.configured === false;
    const detail = temporary
      ? tr("一時ローカル", "Temporary local")
      : String(config?.localPath || "").replace(/^\/app\//, "/") || tr("ローカルファイル", "Local files");
    return {
      mode: "local",
      isLocal: true,
      label: tr("Localモード", "Local mode"),
      detail,
      title: temporary
        ? tr("プライマリーストレージ: Localモード（GCS未接続のため一時ローカル）", "Primary storage: Local mode (temporary local; GCS not connected)")
        : tr("プライマリーストレージ: Localモード（{path}）", "Primary storage: Local mode ({path})", {
          path: config?.localPath || detail
        })
    };
  }
  const bucket = config?.bucket ? `gs://${config.bucket}/${config.prefix || ""}`.replace(/\/+$/, "/") : "";
  return {
    mode: "storage",
    isLocal: false,
    label: tr("Storageモード", "Storage mode"),
    detail: bucket || config?.projectId || "Google Cloud Storage",
    title: tr("プライマリーストレージ: Storageモード（{destination}）", "Primary storage: Storage mode ({destination})", {
      destination: bucket || config?.projectId || "GCS"
    })
  };
}

function shell(content, active = "suites", mode = false) {
  if (mode === true || mode === "editor") return content;
  const collapsed = state.sidebarCollapsed;
  const mainClass = mode === "detail" ? "main detail-mode" : "main";
  const storage = storageModeSummary();
  const auth = googleAuthStatus();
  return `
    <div class="app-shell ${collapsed ? "sidebar-collapsed" : ""}">
      <aside class="sidebar ${collapsed ? "collapsed" : ""}">
        <div class="sidebar-head">
          <button id="sidebar-toggle" class="sidebar-head-trigger" type="button" aria-label="${collapsed ? tr("サイドバーを展開", "Expand sidebar") : tr("サイドバーを折りたたむ", "Collapse sidebar")}" aria-controls="primary-sidebar-navigation" aria-expanded="${!collapsed}" title="${collapsed ? tr("サイドバーを展開", "Expand sidebar") : tr("サイドバーを折りたたむ", "Collapse sidebar")}">
            <span class="brand">
              <span class="brand-icon"><img src="/assets/prismtrail-mark.png" alt="" width="32" height="32"></span>
              <span class="brand-copy"><strong>PrismTrail</strong><small>${tr("データエージェント評価", "Data agent evaluation")}</small></span>
            </span>
            <span class="sidebar-toggle" aria-hidden="true">${icon(collapsed ? "panel-left-open" : "panel-left-close", 16)}</span>
          </button>
        </div>
        <nav id="primary-sidebar-navigation" aria-label="${tr("メインナビゲーション", "Main navigation")}">
          <section class="nav-group ${["suites", "reports"].includes(active) ? "active-group" : ""}" aria-labelledby="nav-evaluation">
            <h2 id="nav-evaluation" class="nav-group-label">${tr("評価ワークフロー", "Evaluation")}</h2>
            <a class="${active === "suites" ? "active" : ""}" href="#/suites" title="${tr("テストスイート", "Test suites")}">${icon("layers-3")}<span class="nav-label">${tr("テストスイート", "Test suites")}</span></a>
            <a class="${active === "reports" ? "active" : ""}" href="#/reports" title="${tr("テスト実行結果", "Test run results")}">${icon("chart-no-axes-combined")}<span class="nav-label">${tr("テスト実行結果", "Test run results")}</span></a>
          </section>
          <section class="nav-group ${active === "agents" ? "active-group" : ""}" aria-labelledby="nav-resources">
            <h2 id="nav-resources" class="nav-group-label">${tr("データ", "Data")}</h2>
            <a class="${active === "agents" ? "active" : ""}" href="#/agents" title="${tr("データエージェント", "Data agents")}">${icon("bot")}<span class="nav-label">${tr("データエージェント", "Data agents")}</span></a>
          </section>
          <section class="nav-group ${active === "settings" ? "active-group" : ""}" aria-labelledby="nav-system">
            <h2 id="nav-system" class="nav-group-label">${tr("システム管理", "System")}</h2>
            <a class="${active === "settings" ? "active" : ""}" href="#/settings" title="${tr("設定", "Settings")}">${icon("settings-2")}<span class="nav-label">${tr("設定", "Settings")}</span></a>
          </section>
        </nav>
        <div class="sidebar-foot">
          <a class="sidebar-status storage-mode ${storage.mode}" href="#/settings" title="${esc(storage.title)}" aria-label="${esc(storage.title)}">
            <span class="live-dot" aria-hidden="true"></span>
            <span class="auth-copy"><strong>${esc(storage.label)}</strong><small>${esc(storage.detail)}</small></span>
          </a>
          ${!auth.ready && auth.status !== "checking" ? `<a class="sidebar-status sidebar-auth auth-${esc(auth.status)}" href="#/settings/auth" title="${esc(auth.detail)}">
            <span class="live-dot" aria-hidden="true"></span>
            <span class="auth-copy"><strong>Google Cloud ADC</strong><small>${esc(auth.label)}</small></span>
          </a>` : ""}
          ${localeSelector(collapsed)}
        </div>
      </aside>
      <main class="${mainClass}">${googleAuthBanner()}${content}</main>
    </div>`;
}

function pageHead(title, text, action = "") {
  return `<header class="page-head"><div><h1>${esc(title)}</h1><p>${esc(text)}</p></div><div class="head-actions">${quickSearchTriggerHtml({ tone: "light" })}${action}</div></header>`;
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
      ${quickSearchTriggerHtml({ tone: "dark" })}
      ${actions ? `<div class="toolbar-actions">${actions}</div>` : ""}
    </header>`;
}

function reportToolbarActions(report, { jsonButtonId = "open-report-json", pdfButtonId = "export-report-pdf" } = {}) {
  if (!report) return "";
  const isLive = ["running", "cancelling"].includes(report.status);
  const sheet = report.sheetExport?.status === "succeeded" && report.sheetExport?.spreadsheetUrl
    ? `<a class="button report-action-sheet" href="${esc(report.sheetExport.spreadsheetUrl)}" target="_blank" rel="noopener noreferrer">${icon("sheet", 15)}${tr("シートを開く", "Open sheet")}</a>`
    : "";
  return `${sheet}<button id="${esc(jsonButtonId)}" class="button secondary report-action-json" type="button">${icon("braces", 15)}JSON</button><button id="${esc(pdfButtonId)}" class="button report-action-pdf" type="button" ${isLive ? "disabled" : ""}>${icon("file-down", 15)}${tr("PDF出力", "Export PDF")}</button>`;
}

function openJsonViewer({ title, data }) {
  document.querySelector("#json-viewer-dialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "json-viewer-dialog";
  dialog.className = "json-viewer-dialog";
  const raw = JSON.stringify(data, null, 2);
  dialog.innerHTML = `<div class="json-viewer-shell">
    <header><div>${icon("braces", 18)}<span><small>${tr("生データ", "Raw data")}</small><strong>${esc(title)}</strong></span></div><button type="button" class="json-viewer-close" aria-label="${tr("閉じる", "Close")}" title="${tr("閉じる", "Close")}">${icon("x", 18)}</button></header>
    <p>${tr("この画面を構成している保存済みJSONを読み取り専用で表示しています。", "Read-only view of the persisted JSON used to render this screen.")}</p>
    <pre tabindex="0"><code>${esc(raw)}</code></pre>
    <footer><button type="button" class="button secondary json-viewer-copy">${icon("copy", 15)}${tr("JSONをコピー", "Copy JSON")}</button><button type="button" class="button json-viewer-done">${tr("閉じる", "Close")}</button></footer>
  </div>`;
  const close = () => dialog.close();
  dialog.querySelector(".json-viewer-close")?.addEventListener("click", close);
  dialog.querySelector(".json-viewer-done")?.addEventListener("click", close);
  dialog.querySelector(".json-viewer-copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(raw);
      notify(tr("JSONをコピーしました。", "Copied JSON."), "success");
    } catch {
      notify(tr("JSONをコピーできませんでした。", "Could not copy JSON."));
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
  refreshIcons();
}

function quickSearchTriggerHtml({ tone = "dark" } = {}) {
  const shortcut = quickSearchShortcutLabel();
  const scoped = Boolean(quickSearchScope());
  return `<button id="open-quick-search" class="toolbar-search tone-${tone}" type="button" title="${tr("クイック検索 ({shortcut})", "Quick search ({shortcut})", { shortcut })}" aria-label="${tr("クイック検索", "Quick search")}">
    ${icon("search", 15)}
    <span>${scoped ? tr("このテストスイート内を検索…", "Search this test suite…") : tr("ケースやスイートを検索…", "Search cases and suites…")}</span>
    <kbd>${esc(shortcut)}</kbd>
  </button>`;
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
      const activeRun = state.suiteRuns.find(
        (run) => run.suiteId === suite.id && (run.status === "running" || run.status === "cancelling")
      );
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
        ${last ? `<div class="last-result"><span>${last.status === "running" || last.status === "cancelling" ? tr("現在の実行", "Current run") : tr("直近の評価", "Latest evaluation")}</span><strong>${last.status === "running" || last.status === "cancelling" ? `${last.summary?.completed || 0}/${last.summary?.total || suite.cases?.length || 0}` : `${last.summary?.passRate || 0}%`}</strong>${statusPill(last.status)}</div>` : ""}
        <div class="card-actions"><a class="button secondary" href="#/suites/${suite.id}/edit">${tr("編集する", "Edit")}</a>${activeRun ? `<a class="button primary" href="#/reports/${activeRun.id}">${icon("activity", 15)}${tr("進捗を見る", "View progress")}</a>` : `<button class="button primary" data-run-suite="${suite.id}">${icon("play", 15)}${tr("一括実行", "Run suite")}</button>`}</div>
      </article>`;
    })
    .join("");
  app.innerHTML = shell(`
    ${pageHead(tr("テストスイート", "Test suites"), tr("実業務プロンプトをまとめて実行し、品質とコストを継続評価します。", "Run real-world prompts together and continuously evaluate quality and cost."), `<a href="#/settings/sheets" class="button secondary">${icon("sheet", 16)}${tr("Sheets連携", "Sheets integration")}</a><button id="new-suite" class="button primary">${icon("plus", 16)}${tr("新しいスイート", "New suite")}</button>`)}
    <section class="summary-strip">
      <div><span>${tr("スイート", "Suites")}</span><strong>${formatLocaleNumber(state.suites.length)}</strong></div>
      <div><span>${tr("登録ケース", "Test cases")}</span><strong>${formatLocaleNumber(state.suites.reduce((n, s) => n + (s.cases?.length || 0), 0))}</strong></div>
      <div><span>${tr("実行レポート", "Run reports")}</span><strong>${formatLocaleNumber(state.suiteRuns.length)}</strong></div>
      <div><span>Data Agent</span><strong>${state.agents.length}</strong></div>
    </section>
    <section class="card-grid">${cards || empty(tr("まだスイートがありません", "No suites yet"), tr("最初のテストスイートを作成してください。", "Create your first test suite."))}</section>
  `, "suites");

  document.querySelector("#new-suite")?.addEventListener("click", createSuite);
  document.querySelectorAll("[data-delete-suite]").forEach((button) => button.addEventListener("click", () => deleteSuite(button.dataset.deleteSuite)));
}

async function deleteSuite(id) {
  const suite = state.suites.find((item) => item.id === id);
  if (!suite) return;
  if (state.suiteRuns.some((run) => run.suiteId === id && (run.status === "running" || run.status === "cancelling"))) {
    notify(tr("実行中のスイートは削除できません。", "A running suite cannot be deleted."));
    return;
  }
  if (
    !(await askConfirm(
      tr(
        "「{name}」を削除しますか？この操作は取り消せません。",
        "Delete “{name}”? This cannot be undone.",
        { name: suite.name }
      ),
      { confirmLabel: tr("削除する", "Delete") }
    ))
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

function syncCaseNavScroll() {
  const list = document.querySelector(".case-nav-list");
  const active = list?.querySelector(".case-nav-item.active");
  if (!list || !active) return;
  requestAnimationFrame(() => {
    const listRect = list.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    list.scrollTop += itemRect.top - listRect.top;
    list.scrollLeft += itemRect.left - listRect.left;
  });
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
          const accuracy = item.expectations?.accuracyValidation || {};
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
            accuracy.enabled && accuracy.sources?.length
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
  const accuracy = item.expectations?.accuracyValidation || {};
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
      <label>${tr("ステータス", "Status")}<select data-field="status"><option value="active" ${item.status !== "draft" ? "selected" : ""}>${tr("実行可", "Runnable")}</option><option value="draft" ${item.status === "draft" ? "selected" : ""}>${tr("下書き", "Draft")}</option></select><small class="field-help">${tr("下書きのケースはスイート実行時にスキップされます。", "Draft cases are skipped when the suite runs.")}</small></label>
      <label class="span-2">${tr("関連URL", "Related URLs")}<textarea data-related-urls rows="3" maxlength="40979" placeholder="https://...">${esc((item.relatedUrls || []).join("\n"))}</textarea><small class="field-help">${tr("このケースを追加・更新した根拠へのリンクを1行に1件、最大20件まで登録できます。", "Add up to 20 provenance links for this case, one HTTP(S) URL per line.")}</small><div class="related-url-list">${relatedUrlLinks(item.relatedUrls)}</div></label>
      <label class="span-2">${tr("メモ", "Memo")}<textarea data-field="memo" rows="5" maxlength="20000" placeholder="${tr("自由記述。モデル定義・指標レイヤー・参照メモなど。評価には使いません。", "Free-form notes. Model definitions, metrics layer, references, etc. Not used in evaluation.")}">${esc(item.memo || "")}</textarea><small class="field-help">${tr("評価判定には使わない、ケース単位の参照メモです。", "Case-level reference notes; not used for scoring.")}</small></label>
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
          <label class="span-2">${tr("SQLで参照すべきテーブル（カンマ区切り）", "Required SQL tables (comma-separated)")}<input data-system-expect="requiredSqlTables" value="${esc((system.requiredSqlTables || []).join(", "))}"><small class="field-help">${tr("生成SQL・照合クエリにテーブル名が含まれるかを判定します（回答文は見ません）。", "Checks generated/matched SQL for table identifiers (not the answer text).")}</small></label>
        </div>
      </fieldset>
      <fieldset class="requirement-section business-requirements">
        <legend>${tr("ビジネス要件", "Business requirements")} <small>${tr("受入条件", "Acceptance criteria")}</small></legend>
        <p>${tr("回答が満たすべき定性・定量条件を1項目ずつ定義します。正解の根拠は次の「精度検証」で別に設定します。", "Define qualitative and quantitative acceptance conditions. Configure the source of truth separately under Accuracy validation.")}</p>
        <div class="business-toggle-row">
          <label>${tr("合格ライン", "Passing grade")}<select data-business-passing-grade><option value="B" ${business.passingGrade !== "C" ? "selected" : ""}>${tr("B以上（推奨）", "B or higher (recommended)")}</option><option value="C" ${business.passingGrade === "C" ? "selected" : ""}>${tr("C以上", "C or higher")}</option></select></label>
        </div>
        ${businessCriteriaEditorHtml(business)}
        <div class="grade-legend">${gradeBadge({ grade: "A", status: "passed" })}${gradeBadge({ grade: "B", status: "passed" })}${gradeBadge({ grade: "C", status: "review" })}${gradeBadge({ grade: "D", status: "failed" })} <span class="muted-copy">☀️=OK · ☁️=部分 · ☔️=NG</span></div>
      </fieldset>
      <fieldset class="requirement-section accuracy-validation">
        <legend>${tr("精度検証", "Accuracy validation")} <small>${tr("正解根拠", "Ground truth")}</small></legend>
        <p>${tr("Geminiが参照する正解根拠を登録します。URLは安全な公開ページだけを取得し、BigQuery SQLは読み取り専用・課金上限付きで実行します。", "Register ground-truth evidence for Gemini. URLs are fetched only from safe public pages; BigQuery SQL is read-only and cost-capped.")}</p>
        <label class="check"><input type="checkbox" data-accuracy-enabled ${accuracy.enabled && accuracy.sources?.length ? "checked" : ""}> ${tr("このケースで精度検証を実行", "Run accuracy validation for this case")}</label>
        ${accuracySourcesEditorHtml(accuracy.sources || [])}
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
  if (!["basics", "cases", "runs", "history"].includes(state.editorTab)) state.editorTab = "cases";
  const selectedCase = suite.cases[state.selectedCaseIndex];
  const onCasesTab = state.editorTab === "cases";
  const editorAgentId = suiteAgentId(suite);
  const connectedSheet = editorAgentId
    ? sheetConnectionForAgent(editorAgentId, { readyOnly: true }) || sheetConnectionForAgent(editorAgentId)
    : null;
  const sheetShortcut = !editorAgentId
    ? `<button class="button secondary" type="button" disabled title="${esc(tr("Data Agentを1つに統一してください。", "Use exactly one Data Agent in this suite."))}">${icon("triangle-alert", 15)}${tr("複数Agentのため連携不可", "Mixed-agent suite")}</button>`
    : connectedSheet
    ? `<button id="open-linked-sheet" class="button sheet-link" type="button">${icon("sheet", 15)}${tr("Gシートで編集", "Edit in Sheets")}${icon("external-link", 13)}</button>`
    : `<a class="button secondary" href="#/settings/sheets">${icon("sheet", 15)}${tr("Google Sheetsを連携", "Connect Google Sheets")}</a>`;
  const showCaseNav = onCasesTab && suite.cases.length > 0;
  const columnClass = [
    "editor-columns",
    showCaseNav ? "has-cases" : "no-cases"
  ]
    .filter(Boolean)
    .join(" ");
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
          </section>`;
  const casesPanel = `
          ${suite.cases.length ? "" : `<section class="suite-start-panel">
            <div><span class="eyebrow">作成方法を選択</span><h2>最初のテストケースを追加しましょう</h2><p>複数ケースをまとめて扱える「表で入力する」方法がおすすめです。</p></div>
            <div class="suite-start-options">
              <button id="start-with-paste" class="start-option primary" type="button"><span>${icon("clipboard-paste", 19)}</span><strong>表で入力する <em>おすすめ</em></strong><small>Sheets・Excelの複数ケースを一括追加</small>${icon("arrow-right", 15)}</button>
              <button id="start-manually" class="start-option" type="button"><span>${icon("square-pen", 19)}</span><strong>1件ずつ追加</strong><small>フォームでプロンプトと条件を設定</small>${icon("arrow-right", 15)}</button>
            </div>
            <div class="sheet-direct-row">
              <span class="sheet-direct-icon">${icon("sheet", 18)}</span>
              <div><strong>${connectedSheet ? esc(connectedSheet.title || "連携済みGoogle Sheets") : "Google Sheetsと連携"}</strong><small>${connectedSheet ? "シート上でケースを編集し、アプリへ取り込めます。" : "連携すると、ここから編集用シートを直接開けます。"}</small></div>
              ${connectedSheet
                ? `<button id="open-linked-sheet-inline" class="button sheet-link" type="button">${icon("sheet", 15)}${tr("Gシートで編集", "Edit in Sheets")}${icon("external-link", 13)}</button>`
                : `<a class="button secondary" href="#/settings/sheets">${icon("sheet", 15)}${tr("Google Sheetsを連携", "Connect Google Sheets")}</a>`}
            </div>
          </section>`}
          <div class="case-workspace-toolbar">
            <div class="selected-case-heading">
              <span>${icon("mouse-pointer-2", 14)}${tr("現在選択中", "Currently selected")}</span>
              <h2>${esc(selectedCase?.title || tr("テストケース未選択", "No test case selected"))}</h2>
            </div>
            <div class="case-action-groups">
              <div class="case-action-group primary-actions"><button id="run-selected-case" class="button primary" type="button" ${selectedCase && selectedCase.status !== "draft" ? "" : "disabled"}>${icon("play", 15)}${tr("選択ケースを実行", "Run selected case")}</button><button id="add-case" class="button secondary">${icon("plus", 15)}${tr("ケースを追加", "Add case")}</button></div>
              <div class="case-action-group edit-actions">${sheetShortcut}<button id="paste-cases" class="button secondary">${icon("clipboard-paste", 15)}${tr("表で一括編集", "Bulk edit table")}</button></div>
              <details class="case-export-menu"><summary class="button report-action-pdf">${icon("file-down", 15)}${tr("PDF出力", "Export PDF")}${icon("chevron-down", 13)}</summary><div><button id="export-case-pdf" class="button secondary" type="button" ${selectedCase ? "" : "disabled"}>${icon("file-down", 15)}${tr("選択ケース", "Selected case")}</button><button id="export-cases-pdf" class="button secondary" type="button" ${suite.cases.length ? "" : "disabled"}>${icon("files", 15)}${tr("全ケース", "All cases")}</button></div></details>
            </div>
          </div>
          <div id="case-detail">${selectedCase ? caseForm(selectedCase, state.selectedCaseIndex) : empty(tr("ケースがありません", "No test cases"), tr("上の作成方法から、最初のケースを追加してください。", "Choose a method above to add your first case."))}</div>`;
  const suiteRunHistory = state.suiteRuns.filter((run) => run.suiteId === suite.id);
  const runsPanel = `<section class="suite-run-history">
    <div class="suite-run-history-head"><div><span class="eyebrow">${tr("TEST RUN HISTORY", "TEST RUN HISTORY")}</span><h2>${tr("このスイートの実行履歴", "Run history for this suite")}</h2><p>${tr("スイート横断ではなく、この定義から実行した結果だけを表示します。", "Shows only runs created from this suite definition.")}</p></div><a class="button secondary" href="#/reports">${icon("chart-no-axes-combined", 15)}${tr("すべての実行結果", "All run results")}</a></div>
    <div class="table-panel"><table><thead><tr><th>${tr("実行日時", "Executed at")}</th><th>${tr("結果", "Result")}</th><th>${tr("合格ケース", "Passed cases")}</th><th>${tr("所要時間", "Duration")}</th><th></th></tr></thead><tbody>${suiteRunHistory.map((run) => `<tr><td><strong>${esc(suiteRunLabel(run))}</strong><small>${esc(run.id)}</small></td><td>${statusPill(run.status)}</td><td><strong>${formatLocaleNumber(run.summary?.passed || 0)} / ${formatLocaleNumber(run.summary?.total || 0)}</strong><small>${formatLocaleNumber(run.summary?.passRate || 0)}%</small></td><td>${fmtDuration(run.summary?.totalDurationMs)}</td><td><a class="button primary small" href="#/reports/${run.id}">${tr("結果を開く", "Open result")}${icon("arrow-right", 13)}</a></td></tr>`).join("")}</tbody></table>${suiteRunHistory.length ? "" : empty(tr("実行履歴はありません", "No run history"), tr("このスイートを実行すると、結果がここに並びます。", "Run this suite to see its results here."))}</div>
  </section>`;
  const selectedVersion = state.selectedSuiteVersion;
  const selectedSnapshot = selectedVersion?.snapshot;
  const historyList = state.suiteVersions.length
    ? state.suiteVersions
        .map((version) => {
          const active = version.id === state.selectedSuiteVersionId;
          return `<button type="button" class="history-item${active ? " active" : ""}" data-select-version="${esc(version.id)}">
            <span class="history-method method-${esc(version.updateMethod)}">${esc(updateMethodLabel(version.updateMethod))}</span>
            <strong>${esc(fmtDate(version.createdAt))}</strong>
            <small>${esc(version.updatedBy || "local")} · ${tr("{count} ケース", "{count} cases", { count: formatLocaleNumber(version.caseCount || 0) })}</small>
          </button>`;
        })
        .join("")
    : empty(
        tr("履歴はまだありません", "No history yet"),
        tr("保存や貼り付けのたびに、ここに定義のスナップショットが残ります。", "Each save or paste keeps a full definition snapshot here.")
      );
  const historyDetail = selectedVersion
    ? `<article class="history-detail">
        <header>
          <div>
            <span class="history-method method-${esc(selectedVersion.updateMethod)}">${esc(updateMethodLabel(selectedVersion.updateMethod))}</span>
            <h2>${esc(selectedSnapshot?.name || suite.name)}</h2>
            <p>${esc(fmtDate(selectedVersion.createdAt))} · ${esc(selectedVersion.updatedBy || "local")}</p>
          </div>
          <button type="button" class="button primary" data-restore-version="${esc(selectedVersion.id)}">${icon("rotate-ccw", 15)}${tr("復元する", "Restore")}</button>
        </header>
        <section class="history-meta">
          <div><span>${tr("説明", "Description")}</span><p>${esc(selectedSnapshot?.description || tr("（なし）", "(none)"))}</p></div>
          <div><span>${tr("ケース数", "Cases")}</span><strong>${formatLocaleNumber(selectedSnapshot?.cases?.length || 0)}</strong></div>
          <div><span>${tr("バージョンID", "Version ID")}</span><code>${esc(selectedVersion.id)}</code></div>
        </section>
        <section class="history-cases">
          <h3>${tr("ケース一覧", "Case list")}</h3>
          ${(selectedSnapshot?.cases || [])
            .map(
              (item, index) =>
                `<div><code>${String(index + 1).padStart(2, "0")}</code><strong>${esc(item.title || item.id)}</strong><small>${esc((item.prompt || "").slice(0, 120))}</small></div>`
            )
            .join("") || `<p>${tr("ケースなし", "No cases")}</p>`}
        </section>
        <details class="history-json">
          <summary>${tr("定義JSONを表示", "Show definition JSON")}</summary>
          <pre>${esc(JSON.stringify(selectedSnapshot, null, 2))}</pre>
        </details>
      </article>`
    : empty(
        tr("履歴を選択してください", "Select a history entry"),
        tr("左の一覧からバージョンを選ぶと内容を確認できます。", "Choose a version on the left to inspect its contents.")
      );
  const historyPanel = `<section class="history-panel${state.suiteVersionsBusy ? " is-busy" : ""}">
    <aside class="history-list" aria-label="${tr("定義履歴", "Definition history")}">${historyList}</aside>
    <div class="history-main">${historyDetail}</div>
  </section>`;
  app.innerHTML = shell(`
    <div class="editor-shell">
      ${navHeader({
        title: suite.name,
        subtitleHtml: `<em id="save-state">${tr("保存済み", "Saved")}</em> · ${tr("テストスイート", "Test suites")}`,
        backHref: "#/suites",
        backLabel: tr("テストスイート一覧に戻る", "Back to test suites"),
        actions: `${localeSelector(true)}<button id="save-suite" class="button secondary" type="button">${icon("save", 15)}${tr("保存", "Save")}</button><button id="run-current-suite" class="button bright" type="button">${icon("play", 15)}${tr("スイートを実行", "Run suite")}</button>`
      })}
      <div class="${columnClass}">
        ${showCaseNav ? caseNav(suite) : ""}
        <main class="suite-workspace">
          <div class="editor-tabs" role="tablist" aria-label="${tr("編集モード", "Edit mode")}">
            <button type="button" class="editor-tab${state.editorTab === "basics" ? " active" : ""}" role="tab" aria-selected="${state.editorTab === "basics" ? "true" : "false"}" data-editor-tab="basics">${icon("sliders-horizontal", 15)}${tr("基本情報", "Basics")}</button>
            <button type="button" class="editor-tab${state.editorTab === "cases" ? " active" : ""}" role="tab" aria-selected="${state.editorTab === "cases" ? "true" : "false"}" data-editor-tab="cases">${icon("list-checks", 15)}${tr("テストケース", "Test cases")}<em>${formatLocaleNumber(suite.cases.length)}</em></button>
            <button type="button" class="editor-tab${state.editorTab === "runs" ? " active" : ""}" role="tab" aria-selected="${state.editorTab === "runs" ? "true" : "false"}" data-editor-tab="runs">${icon("activity", 15)}${tr("実行履歴", "Run history")}<em>${formatLocaleNumber(suiteRunHistory.length)}</em></button>
            <button type="button" class="editor-tab${state.editorTab === "history" ? " active" : ""}" role="tab" aria-selected="${state.editorTab === "history" ? "true" : "false"}" data-editor-tab="history">${icon("history", 15)}${tr("バージョン履歴", "Version history")}</button>
          </div>
          <div class="editor-tab-panel" data-tab-panel="basics" ${state.editorTab === "basics" ? "" : "hidden"}>${basicsPanel}</div>
          <div class="editor-tab-panel" data-tab-panel="cases" ${state.editorTab === "cases" ? "" : "hidden"}>${casesPanel}</div>
          <div class="editor-tab-panel" data-tab-panel="runs" ${state.editorTab === "runs" ? "" : "hidden"}>${runsPanel}</div>
          <div class="editor-tab-panel" data-tab-panel="history" ${state.editorTab === "history" ? "" : "hidden"}>${historyPanel}</div>
        </main>
      </div>
      ${suitePasteDialog(suite)}
    </div>`, "suites", "editor");
  refreshIcons();
  bindEditor();
  syncCaseNavScroll();
  if (state.suitePasteOpen) document.querySelector("#suite-paste-dialog")?.showModal();
}

function businessCriteriaItems(business = {}) {
  if (Array.isArray(business.criteriaItems) && business.criteriaItems.length) {
    return business.criteriaItems.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(business.accuracyCriteria || "")
    .split(/;+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function businessCriteriaEditorHtml(business = {}) {
  const items = businessCriteriaItems(business);
  const rows = items.length ? items : [""];
  return `<div class="criteria-editor" data-criteria-editor>
    <div class="criteria-editor-head">
      <strong>${tr("受入条件", "Acceptance criteria")}</strong>
      <button type="button" class="button secondary compact" data-add-criteria>${icon("plus", 14)}${tr("項目を追加", "Add item")}</button>
    </div>
    <ol class="criteria-rows">
      ${rows
        .map(
          (item, index) => `<li class="criteria-row">
        <span class="criteria-index" aria-hidden="true">${index + 1}</span>
        <input type="text" data-criteria-item maxlength="500" value="${esc(item)}" placeholder="${tr("例: 応募数が数値で示されている", "Example: Application count is numeric")}">
        <button type="button" class="icon-button danger" data-remove-criteria aria-label="${tr("項目を削除", "Remove item")}">${icon("trash-2", 14)}</button>
      </li>`
        )
        .join("")}
    </ol>
    <small class="field-help">${tr("1行が1つの受入条件です（最大20件）。Sheets連携時は ; 区切りで入出力します。", "Each row is one acceptance condition (max 20). Sheets import/export uses semicolon separators.")} Vertex AI · ${esc(state.config.vertexJudgeModel || "gemini-2.5-flash-lite")}</small>
  </div>`;
}

function accuracySourceRowHtml(source = {}, index = 0) {
  const type = ["text", "url", "bigquery_sql"].includes(source.type) ? source.type : "text";
  return `<li class="accuracy-source-row" data-accuracy-source data-source-id="${esc(source.id || `source_${index + 1}`)}">
    <div class="accuracy-source-head">
      <select data-source-type aria-label="${tr("ソースタイプ", "Source type")}">
        <option value="text" ${type === "text" ? "selected" : ""}>${tr("テキスト", "Text")}</option>
        <option value="url" ${type === "url" ? "selected" : ""}>URL</option>
        <option value="bigquery_sql" ${type === "bigquery_sql" ? "selected" : ""}>BigQuery SQL</option>
      </select>
      <input data-source-description maxlength="500" value="${esc(source.description || "")}" placeholder="${tr("説明（任意）", "Description (optional)")}">
      <button type="button" class="icon-button danger" data-remove-accuracy-source aria-label="${tr("ソースを削除", "Remove source")}">${icon("trash-2", 14)}</button>
    </div>
    <textarea data-source-content rows="${type === "bigquery_sql" ? 6 : 3}" maxlength="20000" placeholder="${type === "url" ? "https://..." : type === "bigquery_sql" ? "SELECT ..." : tr("正解となる事実・数値・定義", "Ground-truth facts, values, or definitions")}">${esc(source.content || source.value || "")}</textarea>
  </li>`;
}

function accuracySourcesEditorHtml(sources = []) {
  const rows = sources.length ? sources : [{}];
  return `<div class="accuracy-sources-editor">
    <div class="criteria-editor-head"><strong>${tr("検証ソース", "Validation sources")}</strong><button type="button" class="button secondary compact" data-add-accuracy-source>${icon("plus", 14)}${tr("ソースを追加", "Add source")}</button></div>
    <ol class="accuracy-source-rows">${rows.map(accuracySourceRowHtml).join("")}</ol>
    <small class="field-help">${tr("最大20件。BigQuery SQLはSELECT / WITHのみ、既定100MB・100行・30秒までです。", "Up to 20 sources. BigQuery SQL is limited to SELECT/WITH, 100 MB, 100 rows, and 30 seconds by default.")}</small>
  </div>`;
}

function collectAccuracySourcesFromCard(card) {
  return [...card.querySelectorAll("[data-accuracy-source]")].map((row, index) => ({
    id: row.dataset.sourceId || `source_${index + 1}`,
    type: row.querySelector("[data-source-type]")?.value || "text",
    description: row.querySelector("[data-source-description]")?.value.trim().slice(0, 500) || "",
    content: row.querySelector("[data-source-content]")?.value.trim().slice(0, 20000) || ""
  })).filter((source) => source.content).slice(0, 20);
}

function collectBusinessCriteriaFromCard(card) {
  return [...card.querySelectorAll("[data-criteria-item]")]
    .map((input) => input.value.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((item) => item.slice(0, 500));
}

function renumberCriteriaRows(list) {
  if (!list) return;
  [...list.querySelectorAll(".criteria-index")].forEach((el, index) => {
    el.textContent = String(index + 1);
  });
}

function appendCriteriaRow(list, value = "") {
  if (!list || list.children.length >= 20) return null;
  const li = document.createElement("li");
  li.className = "criteria-row";
  li.innerHTML = `
    <span class="criteria-index" aria-hidden="true">${list.children.length + 1}</span>
    <input type="text" data-criteria-item maxlength="500" value="${esc(value)}" placeholder="${tr("例: 応募数が数値で示されている", "Example: Application count is numeric")}">
    <button type="button" class="icon-button danger" data-remove-criteria aria-label="${tr("項目を削除", "Remove item")}">${icon("trash-2", 14)}</button>`;
  list.appendChild(li);
  renumberCriteriaRows(list);
  refreshIcons();
  const input = li.querySelector("[data-criteria-item]");
  input?.focus();
  return li;
}

function weatherMarkLabel(mark) {
  if (mark === "sun") return tr("満たす", "Met");
  if (mark === "cloud") return tr("一部満たす", "Partially met");
  if (mark === "rain") return tr("未達", "Not met");
  return tr("未判定", "Not scored");
}

function clipPreviewText(value, max = 360) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function extractRunEvidenceClient(run = {}) {
  const sql = [...new Set((run.events || [])
    .flatMap((event) => {
      if (event.kind === "data.generated_sql") {
        const payload = event.payload;
        return [typeof payload === "string" ? payload : payload?.query || payload?.sql || payload?.sqlQuery || ""];
      }
      if (event.kind === "data.matched_query") {
        return [event.payload?.sqlQuery || event.payload?.exampleQuery?.sqlQuery || ""];
      }
      return [];
    })
    .concat((run.jobs || []).map((job) => job?.configuration?.query?.query || ""))
    .map((value) => String(value || "").trim())
    .filter(Boolean))].join("\n\n-- 次の実行SQL --\n\n");
  const answer = clipPreviewText(
    (run.events || [])
      .filter((event) => event.kind === "text.final_response")
      .flatMap((event) => event.payload?.parts || [])
      .join("\n"),
    420
  );
  const resultEvent = (run.events || []).find((event) => event.kind === "data.result");
  const payload = resultEvent?.payload || {};
  const rowsSource = Array.isArray(payload.formattedData)
    ? payload.formattedData
    : Array.isArray(payload.data)
      ? payload.data
      : [];
  let table = null;
  if (rowsSource.length) {
    const first = rowsSource[0];
    let headers = [];
    let rows = [];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      headers = Object.keys(first).slice(0, 5);
      rows = rowsSource.slice(0, 5).map((row) => headers.map((key) => clipPreviewText(row?.[key], 28)));
    } else if (Array.isArray(first)) {
      const width = Math.min(5, first.length || 5);
      headers = Array.from({ length: width }, (_, i) => `c${i + 1}`);
      rows = rowsSource.slice(0, 5).map((row) =>
        Array.from({ length: width }, (_, i) => clipPreviewText(row?.[i], 28))
      );
    }
    table = {
      headers,
      rows,
      truncated: rowsSource.length > 5
    };
  }
  const chartEvents = (run.events || []).filter(
    (event) => event.kind === "chart.result" || event.kind === "analysis.result_vega_chart_json"
  );
  const chartCount = Math.max(chartEvents.length, Number(run.summary?.chartCount || 0));
  const marks = [];
  const specs = [];
  for (const event of chartEvents) {
    let spec = event.payload;
    for (let depth = 0; depth < 5; depth += 1) {
      if (typeof spec === "string") {
        try {
          spec = JSON.parse(spec);
        } catch {
          spec = null;
        }
      }
      if (!spec || typeof spec !== "object") break;
      const nested = spec.vegaConfig || spec.spec || spec.vegaChartJson || spec.resultVegaChartJson;
      if (!nested || nested === spec) break;
      spec = nested;
    }
    if (spec && typeof spec === "object") specs.push(spec);
    const mark = typeof spec?.mark === "string" ? spec.mark : spec?.mark?.type;
    if (mark) marks.push(mark);
  }
  return {
    sql,
    answer,
    table,
    chart: chartCount ? { count: chartCount, marks: [...new Set(marks)], specs } : null
  };
}

function renderEvidenceChartSvg(spec) {
  const values = Array.isArray(spec?.data?.values) ? spec.data.values : [];
  const encoding = spec?.encoding || {};
  const mark = typeof spec?.mark === "string" ? spec.mark : spec?.mark?.type;
  const xField = encoding.x?.field;
  const yField = encoding.y?.field;
  if (!values.length || !xField || !yField || !["line", "area", "bar", "point", "circle"].includes(mark)) return "";

  const width = 760;
  const height = 320;
  const margin = { top: 28, right: 24, bottom: 58, left: 72 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const xType = encoding.x?.type || "nominal";
  const title = typeof spec.title === "string" ? spec.title : tr("Agentレスポンスのチャート", "Agent response chart");
  const xTitle = encoding.x?.title || xField;
  const yTitle = encoding.y?.title || yField;
  const normalized = values
    .map((row, index) => {
      const rawX = row?.[xField];
      return { rawX, x: index, y: Number(row?.[yField]) };
    })
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
  if (!normalized.length) return "";

  const yValues = normalized.map((item) => item.y);
  const yMin = Math.min(0, ...yValues);
  const yMax = Math.max(...yValues);
  const ySpan = yMax - yMin || 1;
  const yScale = (value) => margin.top + innerHeight - ((value - yMin) / ySpan) * innerHeight;
  const band = innerWidth / normalized.length;
  const xScale = (_item, index) => margin.left + band * index + band / 2;
  const points = normalized.map((item, index) => ({ ...item, px: xScale(item, index), py: yScale(item.y) }));
  const compactNumber = (value) => new Intl.NumberFormat(state.locale === "ja" ? "ja-JP" : "en-US", {
    notation: Math.abs(value) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
  const xLabel = (item) => {
    if (xType === "temporal") return new Intl.DateTimeFormat(state.locale === "ja" ? "ja-JP" : "en-US", { year: "2-digit", month: "short" }).format(new Date(item.rawX));
    return clipPreviewText(item.rawX, 14);
  };
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + (ySpan * index) / 4);
  const xTickStep = Math.max(1, Math.ceil(points.length / 7));
  const grid = yTicks.map((value) => {
    const y = yScale(value);
    return `<g><line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#e4ebf2"/><text x="${margin.left - 12}" y="${y + 4}" text-anchor="end" fill="#66778b" font-size="11">${esc(compactNumber(value))}</text></g>`;
  }).join("");
  const xTicks = points.filter((_, index) => index % xTickStep === 0 || index === points.length - 1).map((point) =>
    `<text x="${point.px}" y="${height - margin.bottom + 24}" text-anchor="middle" fill="#66778b" font-size="11">${esc(xLabel(point))}</text>`
  ).join("");
  let marks = "";
  if (mark === "bar") {
    const barWidth = Math.max(4, Math.min(38, band * 0.68));
    marks = points.map((point) => {
      const baseline = yScale(0);
      return `<rect x="${point.px - barWidth / 2}" y="${Math.min(point.py, baseline)}" width="${barWidth}" height="${Math.max(1, Math.abs(baseline - point.py))}" rx="3" fill="#2f6fb3"><title>${esc(`${xLabel(point)}: ${compactNumber(point.y)}`)}</title></rect>`;
    }).join("");
  } else {
    const path = points.map((point, index) => `${index ? "L" : "M"}${point.px},${point.py}`).join(" ");
    if (mark === "area") {
      marks += `<path d="${path} L${points.at(-1).px},${yScale(0)} L${points[0].px},${yScale(0)} Z" fill="#dbeafe" stroke="none"/>`;
    }
    if (mark !== "point" && mark !== "circle") marks += `<path d="${path}" fill="none" stroke="#2f6fb3" stroke-width="3" stroke-linejoin="round"/>`;
    marks += points.map((point) => `<circle cx="${point.px}" cy="${point.py}" r="4" fill="#ffffff" stroke="#2f6fb3" stroke-width="2"><title>${esc(`${xLabel(point)}: ${compactNumber(point.y)}`)}</title></circle>`).join("");
  }
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet">
    <title>${esc(title)}</title>
    <text x="${margin.left}" y="18" fill="#173b5e" font-size="15" font-weight="700">${esc(title)}</text>
    ${grid}${marks}${xTicks}
    <line x1="${margin.left}" y1="${margin.top + innerHeight}" x2="${width - margin.right}" y2="${margin.top + innerHeight}" stroke="#9badbf"/>
    <text x="${margin.left + innerWidth / 2}" y="${height - 8}" text-anchor="middle" fill="#53647a" font-size="12" font-weight="600">${esc(xTitle)}</text>
    <text transform="translate(16 ${margin.top + innerHeight / 2}) rotate(-90)" text-anchor="middle" fill="#53647a" font-size="12" font-weight="600">${esc(yTitle)}</text>
  </svg>`;
}

function renderEvidenceCharts(root = document) {
  root.querySelectorAll("[data-chart-spec]").forEach((element) => {
    let spec;
    try {
      spec = JSON.parse(decodeURIComponent(element.dataset.chartSpec || ""));
    } catch {
      return;
    }
    if (!spec || typeof spec !== "object") return;
    const chartValues = Array.isArray(spec.data?.values) ? spec.data.values : [];
    const chartXField = spec.encoding?.x?.field;
    const chartYField = spec.encoding?.y?.field;
    const chartRows = chartValues
      .map((row) => ({ label: row?.[chartXField], value: Number(row?.[chartYField]) }))
      .filter((row) => Number.isFinite(row.value))
      .slice(0, 24);
    if (chartRows.length) {
      const chartMax = Math.max(...chartRows.map((row) => Math.abs(row.value)), 1);
      const chartTitle = typeof spec.title === "string" ? spec.title : tr("Agentレスポンスのチャート", "Agent response chart");
      const chartBars = chartRows.map((row) => `<div class="agent-chart-column"><span class="agent-chart-value">${esc(new Intl.NumberFormat(state.locale === "ja" ? "ja-JP" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(row.value))}</span><i style="height:${Math.max(4, (Math.abs(row.value) / chartMax) * 156)}px"></i><small>${esc(clipPreviewText(row.label, 10))}</small></div>`).join("");
      element.innerHTML = `<div class="agent-inline-chart" role="img" aria-label="${esc(chartTitle)}"><strong>${esc(chartTitle)}</strong><div class="agent-chart-plot">${chartBars}</div></div>`;
      return;
    }
    let safeSvg = "";
    try {
      safeSvg = renderEvidenceChartSvg(spec);
    } catch {}
    if (safeSvg) {
      element.innerHTML = safeSvg;
      return;
    }
    if (typeof window.vegaEmbed !== "function") return;
    window.vegaEmbed(element, spec, {
      actions: false,
      renderer: "svg",
      mode: String(spec.$schema || "").includes("vega/") && !String(spec.$schema || "").includes("vega-lite") ? "vega" : "vega-lite",
      config: {
        axis: { labelColor: "#53647a", titleColor: "#173b5e", gridColor: "#e6ecf2" },
        legend: { labelColor: "#53647a", titleColor: "#173b5e" },
        view: { stroke: "transparent" }
      }
    }).catch(() => {
      element.innerHTML = `<p class="muted-copy">${tr("チャートを描画できませんでした。", "The chart could not be rendered.")}</p>`;
    });
  });
}

async function loadReportCaseEvidence(report, { limit = 8 } = {}) {
  const targets = (report.caseRuns || []).filter((item) => item.runId).slice(0, limit);
  const entries = await Promise.all(
    targets.map(async (item) => {
      try {
        const run = await json(`/api/runs/${item.runId}`);
        return [item.caseId, extractRunEvidenceClient(run)];
      } catch {
        return [item.caseId, null];
      }
    })
  );
  return Object.fromEntries(entries.filter(([, value]) => value));
}

function reportSectionHeading(iconName, label, meta = "") {
  return `<div class="report-section-heading">${icon(iconName, 20)}<div><h3>${esc(label)}</h3>${meta ? `<small>${esc(meta)}</small>` : ""}</div></div>`;
}

function reportCaseCardHtml(item, { evidence = null, showRunLink = true } = {}) {
  if (!item) return "";
  if (item.status === "skipped" || item.status === "cancelled") {
    return `<article class="report-case ${item.status}">
      <header><span>${statusPill(item.status)}</span><div><strong>${esc(item.title)}</strong><small>${esc(item.caseId)}</small></div></header>
      <p class="muted-copy">${esc(translateApiMessage(item.skipReason || (item.status === "cancelled" ? "実行が中止されたためスキップしました。" : "ケースのステータスが実行可ではないためスキップしました。")))}</p>
    </article>`;
  }
  const system = item.evaluation?.system || item.evaluation || {};
  const business = item.evaluation?.business;
  const businessConfigured = business && business.status !== "not_configured";
  const chartSpec = evidence?.chart?.specs?.[0];
  const evidenceHtml = evidence
    ? `<div class="case-evidence-sections">
        <section>${reportSectionHeading("message-square-more", tr("回答", "Answer"))}<div class="evidence-surface answer-surface"><p>${esc(evidence.answer || tr("（最終回答なし）", "(no final answer)"))}</p></div></section>
        <section>${reportSectionHeading("table-2", tr("結果データ", "Result data"))}${
          evidence.table?.rows?.length
            ? `<div class="mini-table-wrap"><table class="mini-table"><thead><tr>${evidence.table.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${evidence.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>${evidence.table.truncated ? `<small>${tr("先頭行の抜粋です", "Showing a sample of leading rows")}</small>` : ""}</div>`
            : `<p class="muted-copy">${tr("テーブル結果なし", "No table result")}</p>`
        }</section>
        <section>${reportSectionHeading("chart-no-axes-combined", tr("チャート", "Chart"))}${chartSpec
          ? `<div class="report-chart" data-chart-spec="${esc(encodeURIComponent(JSON.stringify(chartSpec)))}"></div>`
          : `<p class="muted-copy">${evidence.chart?.count ? tr("チャート仕様を確認できませんでした。", "Chart specification was unavailable.") : tr("チャートなし", "No chart")}</p>`
        }</section>
      </div>`
    : "";
  return `<article class="report-case report-case-detail ${item.status}" data-case-id="${esc(item.caseId || "")}">
    <header class="case-detail-header"><div><span>${statusPill(item.status)}</span><small>${esc(item.caseId)}</small><h2 tabindex="-1">${esc(item.title)}</h2></div>${showRunLink && item.runId ? `<a class="case-detail-link" href="#/runs/${item.runId}">${icon("list-tree", 17)}<span>${tr("実行詳細を見る", "View run details")}</span>${icon("arrow-up-right", 15)}</a>` : ""}</header>
    ${item.error ? `<p class="error-text">${esc(translateApiMessage(item.error))}</p>` : ""}
    <div class="case-scoreboard">
      ${scoreGradeBadge(item.evaluation?.score)}
      ${scoreGradeBadge(system.score, { label: tr("システム等級", "System grade") })}
      ${businessConfigured ? `<span class="score-grade grade-${esc((business.grade || "d").toLowerCase())}"><small>${tr("ビジネス等級", "Business grade")}</small><b>${esc(business.grade || "—")}</b><em>${formatLocaleNumber(business.score ?? 0)}${tr("点", " pts")}</em></span>` : ""}
      <span class="case-stat"><small>${tr("実行時間", "Duration")}</small><b>${fmtDuration(item.runSummary?.durationMs || 0)}</b></span>
      <span class="case-stat"><small>${tr("実行証跡", "Evidence")}</small><b>${formatLocaleNumber(item.runSummary?.sqlCount || 0)} / ${formatLocaleNumber(item.runSummary?.chartCount || 0)}</b><em>SQL / ${tr("チャート", "charts")}</em></span>
    </div>
    <section class="case-requirement-section">${reportSectionHeading("shield-check", tr("システム要件の評価項目別結果", "System requirement results"), tr("{passed}/{total}項目を満たしています", "{passed}/{total} checks passed", { passed: formatLocaleNumber(system.passedCount || 0), total: formatLocaleNumber(system.checkCount || 0) }))}<div class="checks">${(system.checks || []).map((check) => `<span class="${check.passed ? "ok" : "ng"}">${icon(check.passed ? "check" : "x", 13)}${esc(translateApiMessage(check.label))}</span>`).join("")}</div></section>
    ${businessConfigured ? `<section class="case-requirement-section business-result">${reportSectionHeading("briefcase-business", tr("ビジネス要件の評価項目別結果", "Business requirement results"))}${business.summary ? `<p class="business-summary"><strong>${esc(business.summary)}</strong></p>` : ""}${accuracySourceStatusHtml(business.accuracySources)}${weatherItemList(business, { showEmpty: true })}</section>` : ""}
    <section class="case-input-section">${reportSectionHeading("message-square", tr("ユーザープロンプト", "User prompt"))}<div class="evidence-surface prompt-surface"><p>${esc(item.prompt || tr("プロンプトを取得できませんでした。", "Prompt unavailable."))}</p></div></section>
    ${evidence?.sql ? `<section class="case-sql-section">${reportSectionHeading("database", tr("実行SQL本文", "Executed SQL"))}<pre>${esc(evidence.sql)}</pre></section>` : ""}
    ${evidenceHtml}
  </article>`;
}

function reportCasePendingHtml(testCase, index, { active = null, isCancelling = false } = {}) {
  const phaseLabel = {
    running: tr("Data Agentを実行中", "Running Data Agent"),
    evaluating_system: tr("システム要件を確認中", "Checking system requirements"),
    evaluating_business: tr("Geminiで回答精度を判定中", "Evaluating answer accuracy with Gemini")
  }[active?.phase] || (isCancelling ? tr("中止待ち", "Waiting to stop") : tr("実行待ち", "Waiting"));
  return `<article class="report-case ${active ? "case-running" : "case-pending"}">
    <header>
      <span class="${active ? "live-spinner" : "case-index"}">${active ? "" : String(index + 1).padStart(2, "0")}</span>
      <div><strong>${esc(testCase.title)}</strong><small>${active ? phaseLabel : (isCancelling ? tr("中止待ち", "Waiting to stop") : tr("実行待ち", "Waiting"))}</small></div>
      <b>${active ? (isCancelling ? tr("中止中", "Cancelling") : tr("実行中", "Running")) : "—"}</b>
    </header>
    <div class="skeleton-layer"><strong>システム要件</strong><div class="skeleton-checks"><i></i><i></i><i></i></div></div>
    <div class="skeleton-layer"><strong>ビジネス要件</strong><div class="skeleton-grade"></div></div>
  </article>`;
}

async function runSelectedCase() {
  const suite = state.selectedSuite;
  if (!suite?.id) return notify(tr("スイートが見つかりません。", "Suite not found."));
  try {
    state.selectedSuite = collectSuite();
  } catch {
    // Keep the last in-memory suite if the editor form is mid-render.
  }
  const testCase = state.selectedSuite?.cases?.[state.selectedCaseIndex];
  if (!testCase?.id) return notify(tr("ケースを選択してください。", "Select a test case."));
  if (testCase.status === "draft") {
    return notify(tr("下書きのケースは実行できません。ステータスを「実行可」にしてください。", "Draft cases cannot run. Set the status to Runnable."));
  }
  if (
    !(await askConfirm(
      tr(
        "「{title}」を個別実行します。BigQuery利用料金が発生する可能性があります。続けますか？",
        "Run “{title}” alone? BigQuery usage charges may apply. Continue?",
        { title: testCase.title || testCase.id }
      ),
      { confirmLabel: tr("このケースを実行", "Run this case") }
    ))
  ) {
    return;
  }
  const button = document.querySelector("#run-selected-case");
  try {
    state.busy = true;
    if (button) {
      button.disabled = true;
      button.innerHTML = `${icon("loader-circle", 15)}${tr("実行画面へ…", "Opening run…")}`;
      refreshIcons();
    }
    await saveSuite({ silent: true });
    const run = await json(`/api/suites/${suite.id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseIds: [testCase.id] })
    });
    state.suiteRuns = [run, ...state.suiteRuns.filter((item) => item.id !== run.id)];
    notify(
      tr("個別実行を開始しました。結果画面で完了を待ちます。", "Started single-case run. Waiting for completion on the result screen."),
      "success"
    );
    location.hash = `#/reports/${run.id}`;
  } catch (error) {
    notify(error.message);
    if (button) {
      button.disabled = false;
      button.innerHTML = `${icon("play", 15)}${tr("このケースを実行", "Run this case")}`;
      refreshIcons();
    }
  } finally {
    state.busy = false;
  }
}

function weatherItemList(business, { showEmpty = false } = {}) {
  const scored = Array.isArray(business?.itemResults) ? business.itemResults : [];
  const items = scored.length
    ? scored
    : (business?.criteriaItems || []).map((criterion, index) => ({
        id: index + 1,
        criterion,
        mark: null,
        symbol: "—",
        reason: ""
      }));
  if (!items.length) return showEmpty ? `<p class="muted-copy">${tr("チェック項目はありません。", "No checklist items.")}</p>` : "";
  return `<ol class="weather-checklist">${items
    .map((item, index) => {
      const mark = item.mark || "";
      const markClass = mark === "sun" || mark === "cloud" || mark === "rain" ? ` mark-${mark}` : "";
      const reason = String(item.reason || "").trim();
      return `<li class="weather-item${markClass}">
        <span class="weather-mark" title="${esc(weatherMarkLabel(mark))}">${esc(item.symbol || "—")}</span>
        <div class="weather-body">
          <div class="weather-rule-head">
            <span class="weather-rule-id">${tr("ルール {n}", "Rule {n}", { n: formatLocaleNumber(item.id || index + 1) })}</span>
            <span class="weather-rule-mark">${esc(weatherMarkLabel(mark))}</span>
          </div>
          <strong>${esc(item.criterion || "")}</strong>
          ${reason ? `<p class="weather-reason">${esc(reason)}</p>` : `<p class="weather-reason muted">${tr("根拠はまだありません。", "No rationale yet.")}</p>`}
        </div>
      </li>`;
    })
    .join("")}</ol>`;
}

function accuracySourceStatusHtml(sources = []) {
  if (!Array.isArray(sources) || !sources.length) return "";
  return `<div class="accuracy-source-status"><strong>${tr("精度検証ソース", "Accuracy sources")}</strong><ul>${sources.map((source) => `<li><span class="status-dot ${source.status === "resolved" ? "ok" : "error"}"></span><code>${esc(source.type || "source")}</code> ${esc(source.description || source.id || "")}${source.error ? `<small>${esc(source.error)}</small>` : ""}</li>`).join("")}</ul></div>`;
}

function wireCriteriaRowControls(row) {
  if (!row || row.dataset.wired === "1") return;
  row.dataset.wired = "1";
  row.querySelector("[data-remove-criteria]")?.addEventListener("click", () => {
    const list = row.closest(".criteria-rows");
    row.remove();
    if (list && !list.children.length) appendCriteriaRow(list);
    else renumberCriteriaRows(list);
    document.querySelector("#save-state").textContent = tr("未保存", "Unsaved");
  });
  row.querySelector("[data-criteria-item]")?.addEventListener("input", () => {
    document.querySelector("#save-state").textContent = tr("未保存", "Unsaved");
  });
  row.querySelector("[data-criteria-item]")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const list = row.closest(".criteria-rows");
    if (!list || list.children.length >= 20) return;
    const next = appendCriteriaRow(list);
    wireCriteriaRowControls(next);
    document.querySelector("#save-state").textContent = tr("未保存", "Unsaved");
  });
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
    relatedUrls: [],
    memo: "",
    expectations: {
      systemRequirements: { requireSql: true, requireChart: false, maxDurationMs: 120000, maxBytesBilled: 0, requiredPhrases: [], requiredSqlTables: [] },
      businessRequirements: { enabled: false, criteriaItems: [], accuracyCriteria: "", passingGrade: "B" },
      accuracyValidation: { enabled: false, sources: [] }
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
  document.querySelector("#add-case")?.addEventListener("click", addCaseToSuite);
  document.querySelector("#run-selected-case")?.addEventListener("click", () => runSelectedCase());
  document.querySelector("#export-case-pdf")?.addEventListener("click", async () => {
    const suiteId = state.selectedSuite?.id;
    const testCase = state.selectedSuite?.cases?.[state.selectedCaseIndex];
    if (!suiteId || !testCase?.id) return;
    const button = document.querySelector("#export-case-pdf");
    await withButtonBusy(button, tr("PDF生成中…", "Generating PDF…"), async () => {
      try {
        await saveSuite({ silent: true });
        const filename = await downloadPdf(
          `/api/suites/${suiteId}/export/case-pdf?caseId=${encodeURIComponent(testCase.id)}`,
          `prismtrail-case-${testCase.id}.pdf`
        );
        notify(tr("PDFをダウンロードしました: {name}", "Downloaded PDF: {name}", { name: filename }), "success");
      } catch (error) {
        notify(error.message);
      }
    }, { overlay: true });
  });
  document.querySelector("#export-cases-pdf")?.addEventListener("click", async () => {
    const suiteId = state.selectedSuite?.id;
    if (!suiteId || !(state.selectedSuite?.cases || []).length) return;
    const button = document.querySelector("#export-cases-pdf");
    await withButtonBusy(button, tr("PDF生成中…", "Generating PDF…"), async () => {
      try {
        await saveSuite({ silent: true });
        const filename = await downloadPdf(
          `/api/suites/${suiteId}/export/cases-pdf`,
          `prismtrail-suite-${suiteId}-cases.pdf`
        );
        notify(tr("全ケースのPDFをダウンロードしました: {name}", "Downloaded all-cases PDF: {name}", { name: filename }), "success");
      } catch (error) {
        notify(error.message);
      }
    }, { overlay: true });
  });
  document.querySelector("#start-manually")?.addEventListener("click", addCaseToSuite);
  document.querySelector("#paste-cases")?.addEventListener("click", openSuitePaste);
  document.querySelector("#start-with-paste")?.addEventListener("click", openSuitePaste);
  document.querySelectorAll("[data-editor-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      const next = button.dataset.editorTab;
      if (!["basics", "cases", "runs", "history"].includes(next)) return;
      if (next === state.editorTab) return;
      if (document.querySelector("#suite-name")) state.selectedSuite = collectSuite();
      state.editorTab = next;
      if (next === "history") await loadSuiteVersions(state.selectedSuite.id);
      renderEditor();
    });
  });
  document.querySelectorAll("[data-select-version]").forEach((button) => {
    button.addEventListener("click", () => selectSuiteVersion(button.dataset.selectVersion));
  });
  document.querySelectorAll("[data-restore-version]").forEach((button) => {
    button.addEventListener("click", () => restoreSuiteVersion(button.dataset.restoreVersion));
  });
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
    const agentId = suiteAgentId(state.selectedSuite);
    const connection = agentId
      ? sheetConnectionForAgent(agentId, { readyOnly: true }) || sheetConnectionForAgent(agentId)
      : null;
    if (!agentId) {
      notify(tr("スイート内のData Agentを1つに統一してください。", "Use exactly one Data Agent in the suite before linking Sheets."));
      return;
    }
    if (!connection) {
      location.hash = "#/settings/sheets";
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
    button.addEventListener("click", async () => {
      if (
        !(await askConfirm(tr("このテストケースを削除しますか？", "Delete this test case?"), {
          confirmLabel: tr("削除する", "Delete")
        }))
      ) {
        return;
      }
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
  document.querySelector("[data-add-criteria]")?.addEventListener("click", () => {
    const list = document.querySelector(".criteria-rows");
    if (!list) return;
    if (list.children.length >= 20) {
      notify(tr("チェック項目は最大20件です。", "Checklist items are limited to 20."));
      return;
    }
    appendCriteriaRow(list);
    document.querySelector("#save-state").textContent = tr("未保存", "Unsaved");
    wireCriteriaRowControls(list.lastElementChild);
  });
  document.querySelectorAll(".criteria-row").forEach((row) => wireCriteriaRowControls(row));
  document.querySelector("[data-add-accuracy-source]")?.addEventListener("click", () => {
    const list = document.querySelector(".accuracy-source-rows");
    if (!list || list.children.length >= 20) return notify(tr("精度検証ソースは最大20件です。", "Accuracy sources are limited to 20."));
    list.insertAdjacentHTML("beforeend", accuracySourceRowHtml({}, list.children.length));
    refreshIcons();
    document.querySelector("#save-state").textContent = tr("未保存", "Unsaved");
  });
  document.querySelector(".accuracy-source-rows")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-accuracy-source]");
    if (!button) return;
    const list = button.closest(".accuracy-source-rows");
    button.closest("[data-accuracy-source]")?.remove();
    if (list && !list.children.length) list.insertAdjacentHTML("beforeend", accuracySourceRowHtml({}, 0));
    refreshIcons();
    document.querySelector("#save-state").textContent = tr("未保存", "Unsaved");
  });
  document.querySelectorAll("input,textarea,select").forEach((input) => {
    if (input.closest("#suite-paste-dialog")) return;
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
      if (input.hasAttribute("data-related-urls")) {
        const list = input.parentElement?.querySelector(".related-url-list");
        if (list) list.innerHTML = relatedUrlLinks(input.value.split(/\r?\n/));
        refreshIcons();
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
      schemaVersion: 3,
      systemRequirements: { ...previousSystem },
      businessRequirements: { ...previousBusiness },
      accuracyValidation: { ...(source.expectations?.accuracyValidation || {}) }
    }
  };
  card.querySelectorAll("[data-field]").forEach((input) => (next[input.dataset.field] = input.value));
  if (!String(next.agentId || "").trim()) next.agentId = defaultAgentId;
  const knowledgeSelect = card.querySelector("[data-knowledge]");
  next.knowledgeSourceIds = knowledgeSelect
    ? [...knowledgeSelect.selectedOptions].map((option) => option.value)
    : [...(source.knowledgeSourceIds || [])];
  next.relatedUrls = (card.querySelector("[data-related-urls]")?.value || "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  card.querySelectorAll("[data-system-expect]").forEach((input) => {
    const key = input.dataset.systemExpect;
    if (input.type === "checkbox") next.expectations.systemRequirements[key] = input.checked;
    else if (key === "requiredPhrases" || key === "requiredSqlTables") {
      next.expectations.systemRequirements[key] = input.value.split(",").map((v) => v.trim()).filter(Boolean);
    }
    else next.expectations.systemRequirements[key] = Number(input.value || 0) * Number(input.dataset.scale || 1);
  });
  const criteriaItems = collectBusinessCriteriaFromCard(card);
  next.expectations.businessRequirements = {
    enabled: criteriaItems.length > 0,
    criteriaItems,
    accuracyCriteria: criteriaItems.join("; "),
    passingGrade: card.querySelector("[data-business-passing-grade]").value
  };
  const accuracySources = collectAccuracySourcesFromCard(card);
  next.expectations.accuracyValidation = {
    enabled: Boolean(card.querySelector("[data-accuracy-enabled]")?.checked) && accuracySources.length > 0,
    sources: accuracySources
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
    knowledgeSourceIds: document.querySelector("[data-suite-source]")
      ? [...document.querySelectorAll("[data-suite-source]:checked")].map((input) => input.value)
      : [...(state.selectedSuite.knowledgeSourceIds || [])],
    cases
  };
}

async function saveSuite({ silent = false, updateMethod = "ui_edit" } = {}) {
  try {
    const suite = collectSuite();
    const saved = await json(`/api/suites/${suite.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...suite, updateMethod })
    });
    state.selectedSuite = saved;
    state.suites = state.suites.map((item) => (item.id === saved.id ? saved : item));
    document.querySelector("#save-state").textContent = tr("保存済み", "Saved");
    if (!silent) notify(tr("テストスイートを保存しました。", "Test suite saved."), "success");
    if (state.editorTab === "history") await loadSuiteVersions(saved.id);
    return saved;
  } catch (error) {
    notify(error.message);
    throw error;
  }
}

async function loadSuiteVersions(suiteId, { selectId = state.selectedSuiteVersionId } = {}) {
  if (!suiteId) return;
  state.suiteVersionsBusy = true;
  try {
    const payload = await json(`/api/suites/${suiteId}/versions`);
    state.suiteVersions = payload.versions || [];
    const preferred =
      (selectId && state.suiteVersions.find((item) => item.id === selectId)?.id) ||
      state.suiteVersions[0]?.id ||
      null;
    state.selectedSuiteVersionId = preferred;
    state.selectedSuiteVersion = preferred
      ? await json(`/api/suites/${suiteId}/versions/${preferred}`)
      : null;
  } catch (error) {
    state.suiteVersions = [];
    state.selectedSuiteVersionId = null;
    state.selectedSuiteVersion = null;
    notify(error.message);
  } finally {
    state.suiteVersionsBusy = false;
  }
}

async function selectSuiteVersion(versionId) {
  if (!state.selectedSuite?.id || !versionId) return;
  if (versionId === state.selectedSuiteVersionId && state.selectedSuiteVersion) return;
  try {
    state.selectedSuiteVersionId = versionId;
    state.selectedSuiteVersion = await json(
      `/api/suites/${state.selectedSuite.id}/versions/${versionId}`
    );
    renderEditor();
  } catch (error) {
    notify(error.message);
  }
}

async function restoreSuiteVersion(versionId) {
  if (!state.selectedSuite?.id || !versionId) return;
  if (
    !(await askConfirm(
      tr(
        "この履歴の定義でスイートを上書きします。現在の内容は新しい履歴として残ります。",
        "Overwrite the suite with this historical definition. The current content will remain as a new history entry."
      ),
      { confirmLabel: tr("復元する", "Restore") }
    ))
  ) {
    return;
  }
  try {
    const result = await json(
      `/api/suites/${state.selectedSuite.id}/versions/${versionId}/restore`,
      { method: "POST" }
    );
    state.selectedSuite = result.suite;
    state.suites = state.suites.map((item) => (item.id === result.suite.id ? result.suite : item));
    await loadSuiteVersions(result.suite.id, { selectId: null });
    state.editorTab = "history";
    renderEditor();
    notify(tr("履歴から復元しました。", "Restored from history."), "success");
  } catch (error) {
    notify(error.message);
  }
}

async function runSuite(id) {
  if (!id) return notify(tr("スイートが見つかりません。", "Suite not found."));
  if (document.querySelector("#suite-name") && state.selectedSuite?.id === id) {
    try {
      state.selectedSuite = collectSuite();
    } catch {
      // Keep the last in-memory suite if the editor form is mid-render.
    }
  }
  const suite =
    (state.selectedSuite?.id === id ? state.selectedSuite : null) ||
    state.suites.find((item) => item.id === id) ||
    null;
  if (!suite?.cases?.length) return notify(tr("ケースを1件以上登録してください。", "Add at least one test case."));
  const runnable = suite.cases.filter((item) => item.status !== "draft");
  if (!runnable.length) {
    return notify(tr("実行可のテストケースがありません。", "There are no runnable test cases."));
  }
  const skipped = suite.cases.length - runnable.length;
  const message = skipped
    ? tr(
        "{name} の実行可 {runnable} ケースを実行します（下書き {skipped} 件はスキップ）。BigQuery利用料金が発生する可能性があります。続けますか？",
        "Run {runnable} runnable cases in {name} ({skipped} draft cases will be skipped)? BigQuery usage charges may apply. Continue?",
        { name: suite.name, runnable: formatLocaleNumber(runnable.length), skipped: formatLocaleNumber(skipped) }
      )
    : tr(
        "{name} の {count} ケースを実行します。BigQuery利用料金が発生する可能性があります。続けますか？",
        "Run {count} cases in {name}? BigQuery usage charges may apply. Continue?",
        { name: suite.name, count: formatLocaleNumber(suite.cases.length) }
      );
  if (!(await askConfirm(message, { confirmLabel: tr("スイートを実行", "Run suite") }))) return;
  try {
    state.busy = true;
    if (state.selectedSuite?.id === id) {
      await saveSuite({ silent: true });
    }
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
  const cards = state.agents.map((agent) => {
    const sheet = sheetConnectionForAgent(agent.id);
    const checked = agent.lastCheckedAt ? fmtDate(agent.lastCheckedAt) : tr("未確認", "Not checked");
    return `<a class="agent-card" href="#/agents/${agent.id}" aria-label="${esc(tr("{name}の設定情報を開く", "Open configuration for {name}", { name: agent.displayName }))}">
      <header>
        <span class="agent-card-icon">${icon("bot", 21)}</span>
        ${statusPill(agent.status)}
      </header>
      <div class="agent-card-copy">
        <h2>${esc(agent.displayName)}</h2>
        <p>${esc(agent.description || tr("Google Cloud Data Agentの設定と疎通状態を確認します。", "Review this Google Cloud Data Agent configuration and connectivity."))}</p>
        <code>${esc(agent.resourceName)}</code>
      </div>
      <dl>
        <div><dt>${tr("プロジェクト", "Project")}</dt><dd>${esc(agent.projectId)}</dd></div>
        <div><dt>${tr("ロケーション", "Location")}</dt><dd>${esc(agent.location)}</dd></div>
        <div><dt>Google Sheets</dt><dd>${sheet ? esc(sheet.sheetName || sheet.title) : tr("未連携", "Not connected")}</dd></div>
        <div><dt>${tr("最終確認", "Last checked")}</dt><dd>${esc(checked)}</dd></div>
      </dl>
      <footer><span>${tr("設定情報を開く", "Open configuration")}</span>${icon("arrow-right", 16)}</footer>
    </a>`;
  }).join("");
  app.innerHTML = shell(`
    ${pageHead("データエージェント", "Google Cloud上の既存Data Agentを、テスト対象として安全に登録します。", `<button id="register-agent" class="button primary">${icon("plus", 16)}Agentを登録</button>`)}
    <section class="agent-card-grid">${cards || empty(tr("Data Agentがありません", "No Data Agents"), tr("Google Cloud上のData Agentリソースを登録してください。", "Register an existing Google Cloud Data Agent resource."))}</section>
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
}

function agentRunMatches(run, agent) {
  return run?.agent === agent.resourceName || run?.agentLabel === agent.displayName;
}

function agentDetailTabs(agent, activeTab) {
  return `<nav class="agent-detail-tabs" aria-label="${tr("データエージェント詳細", "Data agent details")}">
    <a class="${activeTab === "overview" ? "active" : ""}" href="#/agents/${agent.id}">${icon("sliders-horizontal", 16)}<span>${tr("設定情報", "Configuration")}</span></a>
    <a class="${activeTab === "connectivity" ? "active" : ""}" href="#/agents/${agent.id}/connectivity">${icon("radio-tower", 16)}<span>${tr("疎通テスト", "Connectivity test")}</span></a>
  </nav>`;
}

function dataAgentConsoleUrl(agent) {
  return `https://console.cloud.google.com/bigquery/data-agents?project=${encodeURIComponent(agent.projectId || "")}`;
}

function configText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string") return value;
  if (["number", "boolean"].includes(typeof value)) return String(value);
  return JSON.stringify(value, null, 2);
}

function dataAgentContexts(agent) {
  const remote = agent.remoteConfiguration || {};
  const analytics = remote.dataAnalyticsAgent || remote.data_analytics_agent || {};
  return {
    remote,
    analytics,
    published: analytics.publishedContext || analytics.published_context || {},
    staging: analytics.stagingContext || analytics.staging_context || {},
    previous: analytics.lastPublishedContext || analytics.last_published_context || {}
  };
}

function contextArray(context, ...keys) {
  for (const key of keys) {
    if (Array.isArray(context?.[key])) return context[key];
  }
  return [];
}

function contextDatasourceEntries(context = {}) {
  const references = context.datasourceReferences || context.dataSourceReferences || context.datasource_references || {};
  const entries = [];
  for (const [kind, raw] of Object.entries(references || {})) {
    const values = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw).flatMap((value) => Array.isArray(value) ? value : [value]) : [];
    for (const value of values) entries.push({ kind, value });
  }
  return entries;
}

function datasourceLabel(entry, index) {
  const value = entry?.value || {};
  const table = value.bigQueryTableReference || value.bigqueryTableReference || value.tableReference || value;
  const parts = [table.projectId, table.datasetId, table.tableId].filter(Boolean);
  return parts.join(".") || value.lookerExplore || value.explore || value.studioDatasourceId || value.id || `${entry.kind} ${index + 1}`;
}

function dataSourceCards(context) {
  const entries = contextDatasourceEntries(context);
  if (!entries.length) return `<div class="config-empty">${icon("database-zap", 18)}<span>${tr("公開設定にデータソース参照はありません。", "No data source references are present in the published configuration.")}</span></div>`;
  return `<div class="agent-source-grid">${entries.map((entry, index) => {
    const value = entry.value || {};
    const schema = value.schema || value.bigQueryTableReference?.schema || value.tableReference?.schema;
    const fields = Array.isArray(schema?.fields) ? schema.fields.length : Array.isArray(value.fields) ? value.fields.length : null;
    return `<article class="agent-source-card"><span>${icon("database", 17)}</span><div><small>${esc(entry.kind)}</small><strong>${esc(datasourceLabel(entry, index))}</strong><p>${fields === null ? tr("スキーマ情報なし", "No schema metadata") : tr("{count}フィールド", "{count} fields", { count: formatLocaleNumber(fields) })}</p></div><details><summary>${tr("参照定義", "Reference definition")}</summary><pre><code>${esc(JSON.stringify(value, null, 2))}</code></pre></details></article>`;
  }).join("")}</div>`;
}

function contextOptionsCards(context = {}) {
  const options = context.options || {};
  const analysis = options.analysis || {};
  const datasource = options.datasource || options.dataSource || {};
  const maxBytes = datasource.bigQueryMaxBilledBytes ?? datasource.bigqueryMaxBilledBytes ?? datasource.big_query_max_billed_bytes;
  const pythonEnabled = analysis.python?.enabled ?? analysis.pythonEnabled ?? analysis.python_enabled;
  const model = options.model || context.model || "—";
  return `<div class="agent-config-stats">
    <article><span>${icon("sparkles", 16)}</span><small>${tr("モデル", "Model")}</small><strong>${esc(configText(model))}</strong></article>
    <article><span>${icon("terminal-square", 16)}</span><small>Python</small><strong>${pythonEnabled === undefined ? "—" : pythonEnabled ? tr("有効", "Enabled") : tr("無効", "Disabled")}</strong></article>
    <article><span>${icon("gauge", 16)}</span><small>BigQuery max billed bytes</small><strong>${maxBytes === undefined ? "—" : esc(fmtBytes(Number(maxBytes)))}</strong></article>
  </div>`;
}

function exampleQueryList(context = {}) {
  const examples = contextArray(context, "exampleQueries", "example_queries", "lookerGoldenQueries", "looker_golden_queries");
  if (!examples.length) return `<p class="config-muted">${tr("サンプルクエリは設定されていません。", "No example queries are configured.")}</p>`;
  return `<ol class="agent-example-list">${examples.map((example) => {
    const question = example.naturalLanguageQuestion || example.question || example.prompt || example.userQuery || tr("サンプルクエリ", "Example query");
    const sql = example.sqlQuery || example.sql || example.query;
    return `<li><strong>${esc(configText(question))}</strong>${sql ? `<pre><code>${esc(configText(sql))}</code></pre>` : `<details><summary>${tr("定義を表示", "Show definition")}</summary><pre><code>${esc(JSON.stringify(example, null, 2))}</code></pre></details>`}</li>`;
  }).join("")}</ol>`;
}

function agentOverviewHtml(agent) {
  const sheet = sheetConnectionForAgent(agent.id);
  const { remote, published, staging, previous } = dataAgentContexts(agent);
  const systemInstruction = published.systemInstruction || published.system_instruction;
  const labels = remote.labels || {};
  const glossaryCount = contextArray(published, "glossaryTerms", "glossary_terms").length;
  const relationshipCount = contextArray(published, "schemaRelationships", "schema_relationships").length;
  const functionCount = contextArray(published, "userFunctions", "user_functions").length;
  const exampleCount = contextArray(published, "exampleQueries", "example_queries", "lookerGoldenQueries", "looker_golden_queries").length;
  const sourceCount = contextDatasourceEntries(published).length;
  const fetched = agent.configurationFetchedAt ? fmtDate(agent.configurationFetchedAt) : tr("未取得", "Not fetched");
  const configurationError = agent.configurationError
    ? `<div class="agent-config-warning">${icon("triangle-alert", 18)}<div><strong>${tr("Google Cloudの設定を取得できませんでした", "Could not load Google Cloud configuration")}</strong><p>${esc(agent.configurationError)}</p></div><button class="button secondary small" type="button" data-check-agent="${agent.id}">${icon("refresh-cw", 14)}${tr("再取得", "Retry")}</button></div>`
    : "";
  return `<section class="agent-configuration">
    <article class="agent-config-hero">
      <div class="agent-overview-heading"><span>${icon("bot", 22)}</span><div><small>${tr("公開中のDATA AGENT", "PUBLISHED DATA AGENT")}</small><h2>${esc(agent.displayName)}</h2><p>${esc(agent.description || tr("説明は登録されていません。", "No description has been registered."))}</p></div></div>
      <div class="agent-config-hero-meta"><span>${statusPill(agent.status)}</span><span><small>${tr("設定取得", "Configuration fetched")}</small><strong>${esc(fetched)}</strong></span><span><small>${tr("更新日時", "Updated")}</small><strong>${esc(fmtDate(remote.updateTime || agent.updatedAt))}</strong></span></div>
    </article>
    ${configurationError}
    <section class="agent-config-section"><header><span>${icon("settings-2", 18)}</span><div><h2>${tr("リソースと実行設定", "Resource and runtime configuration")}</h2><p>${tr("Google Cloud上の公開済みData Agent設定です。", "Published Data Agent configuration loaded from Google Cloud.")}</p></div></header>
      <dl class="agent-resource-grid"><div><dt>${tr("リソース名", "Resource name")}</dt><dd><code>${esc(agent.resourceName)}</code></dd></div><div><dt>${tr("プロジェクト", "Project")}</dt><dd>${esc(agent.projectId)}</dd></div><div><dt>${tr("ロケーション", "Location")}</dt><dd>${esc(agent.location)}</dd></div><div><dt>${tr("暗号鍵", "KMS key")}</dt><dd>${esc(configText(remote.kmsKey || remote.kms_key))}</dd></div></dl>
      ${contextOptionsCards(published)}
    </section>
    <section class="agent-config-section"><header><span>${icon("message-square-text", 18)}</span><div><h2>${tr("システム指示", "System instruction")}</h2><p>${tr("Data Agentの役割、振る舞い、回答方針を定義します。", "Defines the agent persona, behavior, and response policy.")}</p></div></header><pre class="agent-instruction"><code>${esc(configText(systemInstruction, tr("システム指示は設定されていません。", "No system instruction is configured.")))}</code></pre></section>
    <section class="agent-config-section"><header><span>${icon("database", 18)}</span><div><h2>${tr("データソース", "Data sources")}</h2><p>${tr("公開設定から参照されるBigQuery、Looker、Studioリソースです。", "BigQuery, Looker, and Studio resources referenced by the published context.")}</p></div><strong>${formatLocaleNumber(sourceCount)}</strong></header>${dataSourceCards(published)}</section>
    <section class="agent-config-section agent-config-two-column"><div><header><span>${icon("list-checks", 18)}</span><div><h2>${tr("サンプルクエリ", "Example queries")}</h2><p>${tr("質問とSQLの代表例です。", "Representative questions and SQL examples.")}</p></div><strong>${formatLocaleNumber(exampleCount)}</strong></header>${exampleQueryList(published)}</div><aside><header><span>${icon("library", 18)}</span><div><h2>${tr("コンテキスト資産", "Context assets")}</h2><p>${tr("公開設定に含まれる補助定義です。", "Supporting definitions included in the published context.")}</p></div></header><dl class="agent-asset-counts"><div><dt>${tr("用語集", "Glossary terms")}</dt><dd>${formatLocaleNumber(glossaryCount)}</dd></div><div><dt>${tr("スキーマ関係", "Schema relationships")}</dt><dd>${formatLocaleNumber(relationshipCount)}</dd></div><div><dt>${tr("ユーザー関数", "User functions")}</dt><dd>${formatLocaleNumber(functionCount)}</dd></div></dl></aside></section>
    <section class="agent-config-section agent-integration-section"><header><span>${icon("link-2", 18)}</span><div><h2>${tr("連携とメタデータ", "Integrations and metadata")}</h2><p>${tr("PrismTrail側の接続先とGoogle Cloudリソース属性です。", "PrismTrail connections and Google Cloud resource metadata.")}</p></div></header><div class="agent-integration-grid"><article><small>Google Sheets</small>${sheet ? `<strong>${esc(sheet.sheetName || sheet.title)}</strong><span>${esc(sheet.spreadsheetId)}</span><a class="text-link" href="${esc(sheet.spreadsheetUrl)}" target="_blank" rel="noreferrer">${icon("external-link", 13)}${tr("シートを開く", "Open sheet")}</a>` : `<strong>${tr("未連携", "Not connected")}</strong><a class="text-link" href="#/settings/sheets">${icon("link", 13)}${tr("Sheets連携を設定", "Configure Sheets")}</a>`}</article><article><small>${tr("ラベル", "Labels")}</small><div class="agent-label-list">${Object.entries(labels).map(([key, value]) => `<span><b>${esc(key)}</b>${esc(value)}</span>`).join("") || `<span>${tr("ラベルなし", "No labels")}</span>`}</div></article><article><small>${tr("ライフサイクル", "Lifecycle")}</small><span>${tr("作成", "Created")}: ${esc(fmtDate(remote.createTime || agent.createdAt))}</span><span>${tr("更新", "Updated")}: ${esc(fmtDate(remote.updateTime || agent.updatedAt))}</span></article></div></section>
    <section class="agent-config-section agent-context-archive"><header><span>${icon("history", 18)}</span><div><h2>${tr("コンテキスト履歴と生データ", "Context history and raw data")}</h2><p>${tr("ステージング、前回公開、APIレスポンスを読み取り専用で確認できます。", "Inspect staging, previously published, and API response data read-only.")}</p></div></header><div><details><summary>${tr("ステージング設定", "Staging context")}</summary><pre><code>${esc(JSON.stringify(staging, null, 2))}</code></pre></details><details><summary>${tr("前回公開設定", "Last published context")}</summary><pre><code>${esc(JSON.stringify(previous, null, 2))}</code></pre></details><details><summary>${tr("Data Agent JSON", "Data Agent JSON")}</summary><pre><code>${esc(JSON.stringify(remote, null, 2))}</code></pre></details></div></section>
  </section>`;
}

function agentConnectivityHtml(agent) {
  const recent = state.runs.filter((run) => agentRunMatches(run, agent)).slice(0, 8);
  return `<section class="agent-connectivity-intro"><div>${icon("radio-tower", 21)}<div><span>${tr("DATA AGENT CONNECTIVITY", "DATA AGENT CONNECTIVITY")}</span><h2>${tr("プロンプトを送り、応答と実行トレースを確認", "Send a prompt and inspect the response trace")}</h2><p>${tr("登録済みのData Agentへ単発の問い合わせを行います。スイート評価や採点は行いません。", "Send a one-off request to this Data Agent without running suite evaluation or scoring.")}</p></div></div>${statusPill(agent.status)}</section>
  <section class="single-run-layout agent-connectivity-layout"><form id="single-run-form" class="form-panel"><label>${tr("対象Data Agent", "Target Data Agent")}<div class="fixed-agent-field">${icon("bot", 16)}<span><strong>${esc(agent.displayName)}</strong><small>${esc(agent.resourceName)}</small></span></div></label><label>${tr("検証プロンプト", "Verification prompt")}<textarea id="single-prompt" rows="7" required placeholder="${tr("分析したい内容を入力してください", "Enter what you want to analyze")}"></textarea></label><div class="form-row"><label>${tr("思考モード", "Thinking mode")}<select id="single-mode"><option>FAST</option><option>THINKING</option></select></label><button id="single-run-submit" class="button primary" type="submit">${icon("play", 15)}${tr("疎通テストを実行", "Run connectivity test")}</button></div></form><aside class="recent-panel"><h2>${tr("このAgentの最近の疎通テスト", "Recent connectivity tests")}</h2><div id="recent-runs-list">${recent.map((run) => `<a href="#/runs/${run.id}"><span class="run-dot ${run.summary?.status}"></span><span><strong>${esc(run.question)}</strong><small>${fmtDate(run.createdAt)}</small></span></a>`).join("") || empty(tr("履歴なし", "No history"), tr("疎通テストの結果がここに並びます。", "Connectivity test results will appear here."))}</div></aside></section>`;
}

function bindAgentCheckButtons() {
  document.querySelectorAll("[data-check-agent]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const updated = await json(`/api/agents/${button.dataset.checkAgent}/check`, { method: "POST" });
      state.agents = state.agents.map((item) => (item.id === updated.id ? updated : item));
      notify(tr("接続を確認しました。BigQueryクエリは実行していません。", "Connection verified. No BigQuery query was run."), "success");
      renderAgentDetail(updated, "overview");
      refreshIcons();
    } catch (error) { notify(error.message); button.disabled = false; }
  }));
}

function bindAgentConnectivity(agent) {
  document.querySelector("#single-run-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#single-run-submit");
    if (button) {
      button.disabled = true;
      button.innerHTML = `${icon("loader-circle", 15)}${tr("実行中…", "Running…")}`;
      refreshIcons();
    }
    try {
      const run = await json("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: document.querySelector("#single-prompt").value, agent: agent.resourceName, agentLabel: agent.displayName, thinkingMode: document.querySelector("#single-mode").value }) });
      state.runs.unshift(run);
      state.selectedRun = run;
      location.hash = `#/runs/${run.id}`;
    } catch (error) {
      notify(error.message);
      if (button) {
        button.disabled = false;
        button.innerHTML = `${icon("play", 15)}${tr("疎通テストを実行", "Run connectivity test")}`;
        refreshIcons();
      }
    }
  });
}

function renderAgentDetail(agent, activeTab = "overview") {
  const tab = activeTab === "connectivity" ? "connectivity" : "overview";
  app.innerHTML = shell(`
    ${navHeader({ title: agent.displayName, subtitle: agent.resourceName, backHref: "#/agents", backLabel: tr("データエージェント一覧に戻る", "Back to data agents"), actions: `<a class="button secondary" href="${esc(dataAgentConsoleUrl(agent))}" target="_blank" rel="noopener noreferrer">${icon("external-link", 15)}${tr("Google Cloudで開く", "Open in Google Cloud")}</a>` })}
    ${detailBody(`${agentDetailTabs(agent, tab)}${tab === "connectivity" ? agentConnectivityHtml(agent) : agentOverviewHtml(agent)}`)}
  `, "agents", "detail");
  bindAgentCheckButtons();
  if (tab === "connectivity") bindAgentConnectivity(agent);
}

function renderSheetsSettings() {
  const selectedAgentId = suiteAgentId(state.selectedSuite || {}) || "";
  const agentOptions = state.agents.map((agent) => {
    const connection = sheetConnectionForAgent(agent.id);
    const suffix = connection ? ` · ${tr("連携済み", "Connected")}` : "";
    return `<option value="${agent.id}" ${selectedAgentId === agent.id ? "selected" : ""}>${esc(agent.displayName)}${esc(suffix)}</option>`;
  }).join("");
  const connections = state.sheetConnections
    .map((connection) => {
      const linkedAgent = state.agents.find((agent) => agent.id === connection.agentId);
      const assigned = Boolean(linkedAgent);
      return `
      <article class="sheet-card" data-sheet-card="${connection.id}">
        <header>
          <span class="sheet-mark">${icon("sheet", 20)}</span>
          <div><h2>${esc(connection.sheetName || connection.title)}</h2><small>${tr("Google上の名前", "Google title")}: ${esc(connection.title)}</small><strong class="sheet-agent-name">${icon("bot", 13)}${esc(linkedAgent?.displayName || tr("Data Agent未割当", "Unassigned Data Agent"))}</strong><code>${esc(connection.spreadsheetId)}</code></div>
          ${statusPill(connection.status)}
        </header>
        <div class="sheet-meta">
          <span><b>認証</b>${esc(String(connection.authSource || "ADC").toUpperCase())}</span>
          <span><b>最終確認</b>${fmtDate(connection.lastCheckedAt)}</span>
          <span><b>最終入出力</b>${fmtDate(connection.lastImportedAt || connection.lastExportedAt)}</span>
        </div>
        <footer>
          <button class="text-button" data-check-sheet="${connection.id}" ${assigned ? "" : "disabled"}>${icon("refresh-cw", 13)}${assigned ? tr("接続を再確認", "Recheck connection") : tr("Agentを選んで再接続してください", "Reconnect with an agent")}</button>
          <a class="text-link" href="${esc(connection.spreadsheetUrl)}" target="_blank" rel="noreferrer">スプレッドシートを開く ${icon("external-link", 13)}</a>
        </footer>
      </article>`;
    })
    .join("");
  const authNotice = googleAuthStatus().ready || googleAuthStatus().status === "checking" ? "" : `
    <section class="sheets-auth">
      <div class="sheets-auth-copy">${icon("triangle-alert", 24)}<div><strong>${tr("Google認証を確認してください", "Review Google authentication")}</strong><p>${esc(googleAuthStatus().detail)}</p></div></div>
      <a class="button bright small" href="#/settings/auth">${icon("key-round", 13)}${tr("認証方式とscopeを確認", "Review authentication method and scopes")}</a>
    </section>`;
  return `
    <section class="settings-panel sheets-settings-head">
      <div class="settings-section-head">
        <div><h2>Google Sheets連携</h2><p>Googleスプレッドシートを登録し、その接続先としてData Agentを1つ選びます。Agent間のデータは混在しません。</p></div>
      </div>
    </section>
    ${authNotice}
    <section class="sheet-connect-panel">
      <form id="sheet-connect-form">
        <label>シート名
          <input name="sheetName" required maxlength="120" placeholder="例: 営業分析シート">
        </label>
        <label>GoogleスプレッドシートURL / Spreadsheet ID
          <input name="spreadsheetUrl" required placeholder="https://docs.google.com/spreadsheets/d/.../edit">
        </label>
        <label>紐付けるData Agent
          <select name="agentId" required ${state.agents.length ? "" : "disabled"}><option value="">${tr("選択してください", "Select an agent")}</option>${agentOptions}</select>
        </label>
        <button class="button primary" ${state.agents.length ? "" : "disabled"}>${icon("link", 15)}スプレッドシートを登録</button>
      </form>
      <div class="format-note">
        <span>${icon("lock-keyhole", 17)}</span>
        <div><strong>${tr("Agent専用の固定タブ", "Agent-scoped managed tabs")}</strong><p><code>${esc(state.sheetFormat?.suiteTab || "AgentEval_TestSuite")}</code> / <code>${esc(state.sheetFormat?.reportTab || "AgentEval_Report")}</code> ${tr("はテストスイート画面とテスト実行結果画面から更新します。", "are updated from the test suite and test result screens.")} <code>${esc(state.sheetFormat?.agentsTab || "AgentEval_DataAgents")}</code> / <code>${esc(state.sheetFormat?.suitesTab || "AgentEval_Suites")}</code> ${tr("には接続したAgentと、そのAgentだけを使うスイートのみを書き出します。", "contain only the linked agent and suites owned by that agent.")}</p></div>
        <b>${tr("スキーマ", "Schema")} v${state.sheetFormat?.schemaVersion || 1}</b>
      </div>
    </section>
    <section class="sheet-grid">${connections || empty("接続先がありません", "ADCアカウントへ共有済みのGoogleスプレッドシートを追加してください。")}</section>
  `;
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
      if (state.selectedSuite?.id && suiteAgentId(state.selectedSuite) === payload.agentId) {
        payload.suiteId = state.selectedSuite.id;
      }
      const connection = await json("/api/sheets/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      updateSheetConnection(connection);
      if (connection.bootstrap?.suiteBootstrapped || connection.bootstrap?.reportBootstrapped || connection.bootstrap?.catalogsBootstrapped) {
        notify(
          tr(
            "{title} をData Agent専用シートとして接続し、隔離された管理タブを同期しました。",
            "Connected {title} as the Data Agent's dedicated sheet and synced isolated managed tabs.",
            { title: connection.sheetName || connection.title }
          ),
          "success"
        );
      } else {
        notify(tr("{title} に接続しました。", "Connected to {title}.", { title: connection.sheetName || connection.title }), "success");
      }
      renderSettings(); refreshIcons();
    } catch (error) { notify(error.message); button.disabled = false; }
  });
  document.querySelectorAll("[data-check-sheet]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const connection = await json(`/api/sheets/connections/${button.dataset.checkSheet}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suiteId: state.selectedSuite?.id && suiteAgentId(state.selectedSuite) === state.sheetConnections.find((item) => item.id === button.dataset.checkSheet)?.agentId
            ? state.selectedSuite.id
            : undefined
        })
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
      renderSettings(); refreshIcons();
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

function renderStorageOverview(overview, { candidate = false, destination = "" } = {}) {
  if (!overview) return "";
  const populated = (overview.namespaces || []).filter((item) => item.count > 0);
  return `
    <section class="storage-preview-panel">
      <header>
        <div>
          <span>${candidate ? tr("接続先プレビュー", "Destination preview") : tr("保存データ概要", "Stored data overview")}</span>
          <h3>${tr("登録済みデータ", "Registered data")}</h3>
          ${destination ? `<code>${esc(destination)}</code>` : ""}
        </div>
        <strong>${tr("{count}件", "{count} items", { count: formatLocaleNumber(overview.objectCount || 0) })} · ${fmtBytes(overview.sizeBytes || 0)}</strong>
      </header>
      ${overview.isEmpty
        ? `<div class="storage-preview-empty">${icon("database-zap", 18)}<div><strong>${tr("まだデータは登録されていません", "No data is registered yet")}</strong><p>${tr("新しい共有保存先として利用できます。", "This destination is ready to use as new shared storage.")}</p></div></div>`
        : `<div class="storage-preview-grid">${populated.map((item) => `
            <article>
              <div><strong>${esc(item.label)}</strong><span>${tr("{count}件", "{count} items", { count: formatLocaleNumber(item.count) })}</span></div>
              <small>${item.latestUpdatedAt ? tr("最終更新 {date}", "Last updated {date}", { date: fmtDate(item.latestUpdatedAt) }) : tr("更新日時なし", "No update date")}</small>
              ${(item.samples || []).length ? `<ul>${item.samples.map((sample) => `<li title="${esc(sample.id)}">${esc(sample.label || sample.id)}</li>`).join("")}</ul>` : ""}
            </article>`).join("")}</div>`}
      ${candidate ? `<div class="storage-preview-impact">${icon("info", 15)}<p>${tr("「設定を保存」すると、この登録済みデータがアプリに反映されます。現在の保存先のデータも引き継ぐ場合は、下の「データをコピーして切り替え」を使用してください。", "Saving the settings makes this registered data available in the app. To carry over data from the current destination, use “Copy data and switch” below.")}</p></div>` : ""}
    </section>`;
}

function authFeatureStatusLabel(status) {
  return ({
    ready: tr("利用可能", "Available"),
    missing: tr("scope不足", "Missing scope"),
    unavailable: tr("ADC未設定", "ADC unavailable"),
    unknown: tr("未確認", "Unverified")
  })[status] || tr("確認中", "Checking");
}

function resolvedAuthCommand(option, command) {
  return command;
}

function authSetupOptionCopy(option) {
  if (option?.id === "user-adc") {
    return {
      title: tr("ユーザーADC（SA不要）", "User ADC (no service account)"),
      badge: tr("SA不要", "No service account"),
      description: tr("gcloudのDriveアクセス用ログインをADCへ反映し、Cloud・Sheets・GCS・Data Agentを現在のGoogleアカウント一本で利用します。", "Write gcloud's Drive-enabled user login to ADC and use one Google account for Cloud, Sheets, GCS, and Data Agent APIs."),
      caution: tr("Google Drive全体へのOAuth権限を含みます。対象シートの共有、Cloud IAM権限、API設定は別途必要です。", "This grants the OAuth scope for Google Drive access. Sheet sharing, Cloud IAM permissions, and API configuration are still required."),
      steps: [
        tr("Googleスプレッドシートを現在のGoogleアカウントへ共有する。", "Share the Google Sheet with your current Google account."),
        tr("1つ目のコマンドでDriveアクセスを許可し、同じユーザー認証をADCへ書き込む。", "Use the first command to grant Drive access and write the same user credential to ADC."),
        tr("2つ目のコマンドでCloud APIのquota projectをADCへ設定する。", "Use the second command to configure the Cloud API quota project in ADC."),
        tr("認証状態を再確認し、必要なAPIが利用可能になったことを確認する。", "Recheck authentication and confirm the required APIs are available.")
      ]
    };
  }
  return {
    title: tr("自組織のOAuthクライアントを使用", "Use your organization's OAuth client"),
    badge: tr("代替手段", "Alternative"),
    description: tr("Workspace管理ポリシーでgcloudアプリが遮断される場合も、管理者が許可したDesktop OAuthクライアントからユーザーADC一本を作成できます。", "If Workspace policy blocks the gcloud app, create one user ADC credential with a Desktop OAuth client approved by your administrator."),
    caution: tr("OAuthクライアントJSONは認証設定にだけ使用し、リポジトリへcommitしないでください。管理者によるクライアントIDの許可が必要な場合があります。", "Use the OAuth client JSON only for authentication and never commit it. An administrator might need to allow its client ID."),
    steps: [
      tr("Google CloudでDesktop appのOAuthクライアントを作成し、Workspace管理者に必要なら許可してもらう。", "Create a Desktop app OAuth client in Google Cloud and have a Workspace administrator allow it when required."),
      tr("OAUTH_CLIENT_FILEをダウンロードしたJSONの安全なローカルパスへ置き換え、1つ目のコマンドを実行する。", "Replace OAUTH_CLIENT_FILE with the secure local path to the downloaded JSON, then run the first command."),
      tr("2つ目のコマンドでquota projectを設定し、認証状態を再確認する。", "Set the quota project with the second command, then recheck authentication.")
    ]
  };
}

function renderGoogleAuthSettings() {
  const auth = state.authReadiness;
  if (!auth) {
    return `<section class="settings-panel auth-readiness-panel"><div class="auth-readiness-loading">${icon("loader-circle", 18)}${tr("Google認証を確認しています…", "Checking Google authentication…")}</div></section>`;
  }
  const status = googleAuthStatus();
  return `<section class="settings-panel auth-readiness-panel">
    <div class="settings-section-head">
      <div><h2>${tr("Google認証の事前診断", "Google authentication preflight")}</h2><p>${tr("外部APIを操作する前に、ADCと必要なOAuth scopeを確認します。アクセストークンは画面へ返しません。", "Verify ADC and required OAuth scopes before calling external APIs. Access tokens are never returned to the browser.")}</p></div>
      <span class="auth-overall-status ${esc(auth.status)}">${icon(status.ready ? "badge-check" : "triangle-alert", 14)}${esc(status.label)}</span>
    </div>
    <div class="auth-feature-grid">${(auth.features || []).map((feature) => `
      <article class="auth-feature-card ${esc(feature.status)}">
        <header><span>${icon(feature.id === "sheets" ? "sheet" : "cloud", 18)}</span><div><strong>${esc(feature.label)}</strong><small>${esc(authFeatureStatusLabel(feature.status))}</small></div></header>
        <code>${esc(feature.scope)}</code>
        <p>${(feature.features || []).map(esc).join(" / ")}</p>
      </article>`).join("")}</div>
    <div class="auth-readiness-meta">
      <span><b>${tr("認証元", "Auth source")}</b>${esc(auth.authSource || tr("未取得", "Unavailable"))}</span>
      <span><b>${tr("最終確認", "Last checked")}</b>${fmtDate(auth.checkedAt)}</span>
      <span><b>${tr("トークン期限", "Token expiry")}</b>${fmtDate(auth.expiresAt)}</span>
    </div>
    <div class="auth-setup-guide">
      <strong>${tr("認証方式を選択", "Choose an authentication method")}</strong>
      <p>${tr("SAは使わず、CloudとSheetsを同じユーザーADCで利用します。SheetsはDriveまたはspreadsheets scopeで認証できます。", "Use one user ADC credential for Cloud and Sheets without a service account. Sheets accepts either the Drive or spreadsheets scope.")}</p>
      <aside class="auth-key-warning">
        ${icon("shield-alert", 18)}
        <div><strong>${tr("spreadsheets scopeをgcloud既定ADCへ直接追加しない", "Do not add the spreadsheets scope directly to gcloud's default ADC client")}</strong><p>${tr("Googleがこの経路をブロックするため、推奨コマンドはgcloudのDriveアクセス用ログインをADCへ反映します。", "Google blocks that path, so the recommended command writes gcloud's Drive-enabled login to ADC instead.")}</p></div>
      </aside>
      <div class="auth-setup-options">${(auth.setupOptions || []).map((option) => {
        const copy = authSetupOptionCopy(option);
        return `<article class="auth-setup-option ${option.recommended ? "recommended" : ""}">
          <header><div><strong>${esc(copy.title)}</strong><span>${esc(copy.badge)}</span></div><div class="auth-doc-links"><a href="${esc(option.docsUrl)}" target="_blank" rel="noreferrer">${tr("公式手順", "Official guide")} ${icon("external-link", 12)}</a>${option.securityDocsUrl ? `<a href="${esc(option.securityDocsUrl)}" target="_blank" rel="noreferrer">${tr("鍵の安全指針", "Key security")} ${icon("external-link", 12)}</a>` : ""}</div></header>
          <p>${esc(copy.description)}</p>
          ${copy.steps?.length ? `<ol class="auth-manual-steps">${copy.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>` : ""}
          <small>${icon("info", 12)}${esc(copy.caution)}</small>
          ${(option.commands || []).map((command, index) => `<div class="auth-command" data-auth-command-option="${esc(option.id)}" data-auth-command-index="${index}"><code>${esc(resolvedAuthCommand(option, command))}</code><button class="button secondary small" type="button" data-copy-auth-command="${esc(option.id)}:${index}">${icon("copy", 13)}${tr("コピー", "Copy")}</button></div>`).join("")}
        </article>`;
      }).join("")}</div>
    </div>
    <div class="settings-actions">
      <button id="check-google-auth" class="button primary" type="button">${icon("refresh-cw", 15)}${tr("認証状態を再確認", "Recheck authentication")}</button>
    </div>
  </section>`;
}

function bindGoogleAuthSettings() {
  document.querySelector("#check-google-auth")?.addEventListener("click", async (event) => {
    await recheckGoogleAuth(event.currentTarget);
  });
  document.querySelectorAll("[data-copy-auth-command]").forEach((button) => button.addEventListener("click", async () => {
    const [optionId, rawIndex] = button.dataset.copyAuthCommand.split(":");
    const option = state.authReadiness?.setupOptions?.find((item) => item.id === optionId);
    const command = resolvedAuthCommand(option, option?.commands?.[Number(rawIndex)]);
    if (!command) return;
    await navigator.clipboard.writeText(command);
    notify(tr("コマンドをコピーしました。", "Command copied."), "success");
  }));
}

async function recheckGoogleAuth(button) {
  try {
    await withButtonBusy(button, tr("確認中…", "Checking…"), async () => {
      state.authReadiness = await json("/api/auth/readiness?refresh=1");
      await route();
    });
  } catch (error) {
    notify(error.message);
  }
}

function renderSettings() {
  const config = state.storageConfig || {
    driver: "gcs",
    projectId: state.config?.billingProject || "",
    bucket: "",
    prefix: "agent-eval/"
  };
  const draft = state.storageDraft || {
    driver: config.configured === false ? config.recommendedDriver || "gcs" : config.driver,
    projectId: config.projectId || state.config?.billingProject || "",
    bucket: config.bucket || "",
    prefix: config.prefix || "",
    localPath: config.localPath || "./data"
  };
  const isLocal = config.driver === "local";
  const draftIsLocal = draft.driver === "local";
  const test = state.storageTestResult;

  app.innerHTML = shell(`
    ${pageHead("設定", "Google認証、Google Sheets、ストレージ、MCP連携を整理して設定できます。")}
    <nav class="settings-tabs" role="tablist" aria-label="設定カテゴリ">
      <button class="settings-tab ${state.settingsTab === "auth" ? "active" : ""}" type="button" role="tab" aria-selected="${state.settingsTab === "auth"}" data-settings-tab="auth">${icon("shield-check", 15)}<span><strong>${tr("Google認証", "Google authentication")}</strong><small>ADC · OAuth scope</small></span></button>
      <button class="settings-tab ${state.settingsTab === "sheets" ? "active" : ""}" type="button" role="tab" aria-selected="${state.settingsTab === "sheets"}" data-settings-tab="sheets">${icon("sheet", 15)}<span><strong>Google Sheets</strong><small>${tr("接続・入出力", "Connections · import/export")}</small></span></button>
      <button class="settings-tab ${state.settingsTab === "storage" ? "active" : ""}" type="button" role="tab" aria-selected="${state.settingsTab === "storage"}" data-settings-tab="storage">${icon("database", 15)}<span><strong>ストレージ</strong><small>保存先・移行・同期</small></span></button>
      <button class="settings-tab ${state.settingsTab === "mcp" ? "active" : ""}" type="button" role="tab" aria-selected="${state.settingsTab === "mcp"}" data-settings-tab="mcp">${icon("plug-zap", 15)}<span><strong>MCP連携</strong><small>トークン・接続設定</small></span></button>
    </nav>
    <div class="settings-tab-panel ${state.settingsTab === "auth" ? "active" : ""}" role="tabpanel" ${state.settingsTab !== "auth" ? "hidden" : ""}>
    ${renderGoogleAuthSettings()}
    </div>
    <div class="settings-tab-panel ${state.settingsTab === "sheets" ? "active" : ""}" role="tabpanel" ${state.settingsTab !== "sheets" ? "hidden" : ""}>
    ${renderSheetsSettings()}
    </div>
    <div class="settings-tab-panel ${state.settingsTab === "storage" ? "active" : ""}" role="tabpanel" ${state.settingsTab !== "storage" ? "hidden" : ""}>
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
        ${test?.ok ? renderStorageOverview(test.overview, {
          candidate: true,
          destination: test.details?.provider === "gcs"
            ? `gs://${test.details.bucket}/${test.details.prefix || ""}`
            : test.details?.rootDirectory || ""
        }) : ""}
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
    </div>
    <div class="settings-tab-panel ${state.settingsTab === "mcp" ? "active" : ""}" role="tabpanel" ${state.settingsTab !== "mcp" ? "hidden" : ""}>
    ${renderMcpSettings()}
    </div>
  `, "settings");
  document.querySelectorAll("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => {
    state.settingsTab = button.dataset.settingsTab;
    localStorage.setItem("prismtrail-settings-tab", state.settingsTab);
    const target = `#/settings/${state.settingsTab}`;
    if (location.hash === target) renderSettings();
    else location.hash = target;
  }));
  bindStorageSettings();
  bindMcpSettings();
  bindGoogleAuthSettings();
  bindSheets();
}

function mcpScopeLabel(scope) {
  return ({
    "suites:read": tr("スイート・ケース参照", "Read suites and cases"),
    "suites:write": tr("スイート・ケース作成・更新", "Create and update suites and cases"),
    "runs:read": tr("実行状況参照", "Read run status"),
    "runs:execute": tr("テスト実行", "Execute tests"),
    "reports:read": tr("テスト実行結果参照・PDF取得", "Read test run results and download PDFs"),
    "agents:read": tr("Data Agent参照", "Read Data Agents"),
    "agents:write": tr("Data Agent登録", "Register Data Agents"),
    "knowledge:read": tr("GCSナレッジ参照・検索", "Read and search GCS knowledge"),
    "knowledge:write": tr("GCSナレッジ登録・同期・アップロード", "Register, sync, and upload GCS knowledge"),
    "sheets:read": tr("Google Sheets接続参照", "Read Google Sheets connections"),
    "sheets:write": tr("Google Sheets接続・入出力", "Connect, import, and export Google Sheets"),
    "assistant:write": tr("AIによるスイート編集", "Edit suites with AI"),
    "storage:read": tr("ストレージ設定参照・接続テスト", "Read and test storage"),
    "storage:switch": tr("ストレージ切替（高権限）", "Switch storage (elevated)")
  })[scope] || scope;
}

function mcpConnectionSetup(clientId, issued, endpoint) {
  const client = MCP_CLIENTS[clientId] || MCP_CLIENTS.codex;
  const envName = client.envName;
  if (clientId === "claude") {
    return {
      command: `claude mcp add --transport http prismtrail ${endpoint} --header "Authorization: Bearer $${envName}"`,
      config: JSON.stringify({ mcpServers: { prismtrail: { type: "http", url: endpoint, headers: { Authorization: `Bearer $${envName}` } } } }, null, 2),
      verify: "claude mcp list"
    };
  }
  if (clientId === "cursor") {
    return {
      command: "mkdir -p .cursor && $EDITOR .cursor/mcp.json",
      config: JSON.stringify({ mcpServers: { prismtrail: { url: endpoint, headers: { Authorization: `Bearer \${env:${envName}}` } } } }, null, 2),
      verify: "cursor-agent mcp list-tools prismtrail"
    };
  }
  if (clientId === "generic") {
    return {
      command: `MCP URL: ${endpoint}\nAuthorization: Bearer $${envName}`,
      config: JSON.stringify({ name: "prismtrail", transport: "streamable-http", url: endpoint, headers: { Authorization: `Bearer $${envName}` } }, null, 2),
      verify: "MCPクライアントの接続テストで prismtrail のツール一覧を確認"
    };
  }
  return {
    command: `codex mcp add prismtrail --url ${endpoint} --bearer-token-env-var ${envName}`,
    config: `[mcp_servers.prismtrail]\nurl = "${endpoint}"\nbearer_token_env_var = "${envName}"`,
    verify: "codex mcp list"
  };
}

function mcpSkillSetup(clientId) {
  if (clientId === "claude") {
    return {
      command: "npm run setup -- skill --install claude",
      note: tr("PrismTrailリポジトリのルートで実行すると、Claude Codeのプロジェクトスキルとして導入されます。", "Run this from the PrismTrail repository root to install the project skill for Claude Code.")
    };
  }
  if (clientId === "cursor") {
    return {
      command: "npm run setup -- skill",
      note: tr("表示されたSKILL.mdをCursorのプロジェクトルールやコンテキスト設定へ追加してください。", "Add the displayed SKILL.md to Cursor's project rules or context configuration.")
    };
  }
  if (clientId === "generic") {
    return {
      command: "npm run setup -- skill",
      note: tr("表示されたSKILL.mdを、利用するエージェントのスキル設定へ追加してください。", "Add the displayed SKILL.md to your coding agent's skill configuration.")
    };
  }
  return {
    command: "npm run setup -- skill --install codex",
    note: tr("PrismTrailリポジトリのルートで実行すると、~/.codex/skills/prismtrailへ導入されます。", "Run this from the PrismTrail repository root to install it under ~/.codex/skills/prismtrail.")
  };
}

function renderMcpConnectionSetup() {
  const issued = state.mcpNewToken;
  if (!issued?.token || !state.mcpConfig) return "";
  const endpoint = `${location.origin}${state.mcpConfig.endpointPath}`;
  const client = MCP_CLIENTS[state.mcpClient] || MCP_CLIENTS.codex;
  const setup = mcpConnectionSetup(state.mcpClient, issued, endpoint);
  const skill = mcpSkillSetup(state.mcpClient);
  const copyButton = (id, label) => `<button class="button secondary mcp-copy-setup" type="button" data-copy-mcp-setup="${id}">${icon("copy", 13)}${label}</button>`;
  const terminal = (id, command, label) => `<div class="mcp-command-terminal"><span class="mcp-terminal-prompt">$</span><code>${esc(command)}</code>${copyButton(id, label)}</div>`;
  return `<section class="mcp-connect-card">
    <div class="settings-section-head"><div><h3>${tr("接続先のコーディングエージェント", "Coding agent connection")}</h3><p>${tr("上から順番にコマンドをコピーして実行すると、スキル導入からMCP接続確認まで完了します。", "Copy and run the commands from top to bottom to install the skill and complete the MCP connection.")}</p></div><span class="mcp-connect-step">${tr("全4ステップ", "4 steps")}</span></div>
    <label class="mcp-client-select">${tr("接続先", "Client")}<select id="mcp-client-select">${Object.entries(MCP_CLIENTS).map(([id, item]) => `<option value="${id}" ${id === state.mcpClient ? "selected" : ""}>${item.label}</option>`).join("")}</select><small>${client.description}</small></label>
    <div class="mcp-setup-steps">
      <article><span class="mcp-step-number">1</span><div class="mcp-step-content"><strong>${tr("PrismTrailスキルを導入", "Install the PrismTrail skill")}</strong>${terminal("skill", skill.command, tr("導入コマンドをコピー", "Copy install command"))}<small>${esc(skill.note)}</small></div></article>
      <article><span class="mcp-step-number">2</span><div class="mcp-step-content"><strong>${tr("トークンを環境変数に設定", "Set the token as an environment variable")}</strong>${terminal("env", envCommandForDisplay(issued, client.envName), tr("設定コマンドをコピー", "Copy command"))}</div></article>
      <article><span class="mcp-step-number">3</span><div class="mcp-step-content"><strong>${tr("MCPサーバーを登録", "Register the MCP server")}</strong>${terminal("command", setup.command, tr("登録コマンドをコピー", "Copy command"))}</div></article>
      <article><span class="mcp-step-number">4</span><div class="mcp-step-content"><strong>${tr("接続を確認", "Verify the connection")}</strong>${terminal("verify", setup.verify, tr("確認コマンドをコピー", "Copy command"))}</div></article>
    </div>
    <details class="mcp-config-details"><summary>${tr("設定ファイルに貼り付ける場合", "If you prefer a config file")}</summary><pre id="mcp-config-snippet">${esc(setup.config)}</pre>${copyButton("config", tr("設定をコピー", "Copy config"))}<p>${state.mcpClient === "cursor" ? tr("Cursorはプロジェクトの .cursor/mcp.json または ~/.cursor/mcp.json に貼り付けます。設定後はCursorを再起動してください。", "For Cursor, paste this into .cursor/mcp.json or ~/.cursor/mcp.json, then restart Cursor.") : tr("Codexは ~/.codex/config.toml の [mcp_servers.prismtrail] に貼り付けます。設定後はCodexを再起動してください。", "For Codex, paste this under [mcp_servers.prismtrail] in ~/.codex/config.toml, then restart Codex.")}</p></details>
  </section>`;
}

function envCommandForDisplay(issued, envName) {
  return `export ${envName}='${issued.token}'`;
}

function renderMcpSettings() {
  const config = state.mcpConfig;
  if (!config) return `<section class="mcp-settings-panel settings-panel"><p>${tr("MCP設定を読み込んでいます…", "Loading MCP settings…")}</p></section>`;
  const endpoint = `${location.origin}${config.endpointPath}`;
  const issued = state.mcpNewToken;
  const rows = (config.tokens || []).map((token) => {
    const status = token.revokedAt ? "revoked" : token.expiresAt && Date.parse(token.expiresAt) <= Date.now() ? "expired" : "active";
    const label = { active: tr("有効", "Active"), expired: tr("期限切れ", "Expired"), revoked: tr("失効済み", "Revoked") }[status];
    return `<article class="mcp-token-row">
      <div><strong>${esc(token.name)}</strong><code>${esc(token.prefix)}•••• · ${esc(token.fingerprint)}</code><small>${(token.scopes || []).map(mcpScopeLabel).map(esc).join(" / ")}</small></div>
      <div><span class="mcp-token-status ${status}">${esc(label)}</span><small>${tr("最終利用", "Last used")}: ${esc(token.lastUsedAt ? fmtDate(token.lastUsedAt) : tr("未使用", "Never"))}<br>${tr("期限", "Expires")}: ${esc(token.expiresAt ? fmtDate(token.expiresAt) : tr("無期限", "Never"))}</small></div>
      ${status === "active" ? `<button class="button secondary" type="button" data-revoke-mcp="${esc(token.id)}">${icon("ban", 14)}${tr("失効", "Revoke")}</button>` : ""}
    </article>`;
  }).join("");
  return `<section class="mcp-settings-panel settings-panel">
    <div class="settings-section-head"><div><h2>${tr("MCP連携", "MCP integration")}</h2><p>${tr("外部コーディングエージェントから、削除を除くPrismTrail操作を安全な専用トークンで実行します。", "Connect external coding agents using a dedicated token. Delete operations are unavailable.")}</p></div><span class="adc-inline">${icon("shield-check", 13)}Streamable HTTP</span></div>
    <div class="mcp-security-note">${icon("lock-keyhole", 17)}<div><strong>${tr("localhost専用の安全境界", "Localhost security boundary")}</strong><p>${tr("外部ネットワークへ公開する場合は、MCPトークンに加えてTLSと既存REST API全体の認証が必要です。", "Remote exposure requires TLS and authentication for the complete REST API in addition to MCP tokens.")}</p></div></div>
    <label>${tr("MCPエンドポイント", "MCP endpoint")}<div class="mcp-endpoint"><code>${esc(endpoint)}</code><button class="text-button" id="copy-mcp-endpoint" type="button">${icon("copy", 13)}${tr("コピー", "Copy")}</button></div></label>
    ${issued ? `<div class="mcp-issued-token"><div>${icon("key-round", 18)}<div><strong>${tr("トークンを発行しました（再表示できません）", "Token issued (it cannot be shown again)")}</strong><p>${tr("今すぐコピーして、安全な場所に保存してください。画面にはマスク値だけを表示しています。", "Copy it now and store it securely. Only a masked value is rendered on screen.")}</p><code>${esc(issued.metadata.prefix)}••••••••••••••••••••</code></div></div><div><button id="copy-mcp-token" class="button primary" type="button">${icon("copy", 14)}${tr("トークンをコピー", "Copy token")}</button><button id="dismiss-mcp-token" class="button secondary" type="button">${tr("閉じる", "Close")}</button></div></div>${renderMcpConnectionSetup()}` : ""}
    <form id="mcp-token-form" class="mcp-token-form">
      <label>${tr("接続名", "Connection name")}<input name="name" maxlength="120" required placeholder="Codex / Claude Code"></label>
      <label>${tr("有効期間", "Expiration")}<select name="expiresInDays"><option value="7">7${tr("日", " days")}</option><option value="30">30${tr("日", " days")}</option><option value="90" selected>90${tr("日", " days")}</option><option value="365">365${tr("日", " days")}</option></select></label>
      <fieldset><legend>${tr("許可する操作", "Allowed operations")}</legend>${config.scopes.map((scope) => `<label class="mcp-scope ${scope === "storage:switch" ? "elevated" : ""}"><input type="checkbox" name="scopes" value="${esc(scope)}" ${config.defaultScopes.includes(scope) ? "checked" : ""}><span><strong>${esc(mcpScopeLabel(scope))}</strong><small>${esc(scope)}</small></span></label>`).join("")}</fieldset>
      <button class="button primary" type="submit">${icon("key-round", 15)}${tr("専用トークンを発行", "Issue token")}</button>
    </form>
    <div class="mcp-token-list"><header><strong>${tr("発行済みトークン", "Issued tokens")}</strong><span>${config.tokens.length}</span></header>${rows || `<p>${tr("まだMCPトークンはありません。", "No MCP tokens have been issued.")}</p>`}</div>
  </section>`;
}

function bindMcpSettings() {
  if (!state.mcpConfig) return;
  document.querySelector("#copy-mcp-endpoint")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(`${location.origin}${state.mcpConfig.endpointPath}`);
    notify(tr("MCPエンドポイントをコピーしました。", "MCP endpoint copied."), "success");
  });
  document.querySelector("#copy-mcp-token")?.addEventListener("click", async () => {
    if (!state.mcpNewToken?.token) return;
    await navigator.clipboard.writeText(state.mcpNewToken.token);
    notify(tr("トークンをコピーしました。", "Token copied."), "success");
  });
  document.querySelector("#dismiss-mcp-token")?.addEventListener("click", () => { state.mcpNewToken = null; renderSettings(); });
  document.querySelector("#mcp-client-select")?.addEventListener("change", (event) => { state.mcpClient = event.currentTarget.value; renderSettings(); });
  document.querySelectorAll("[data-copy-mcp-setup]").forEach((button) => button.addEventListener("click", async () => {
    const issued = state.mcpNewToken;
    const endpoint = `${location.origin}${state.mcpConfig.endpointPath}`;
    const setup = mcpConnectionSetup(state.mcpClient, issued, endpoint);
    const envName = MCP_CLIENTS[state.mcpClient]?.envName || MCP_CLIENTS.codex.envName;
    const values = { skill: mcpSkillSetup(state.mcpClient).command, env: envCommandForDisplay(issued, envName), command: setup.command, verify: setup.verify, config: setup.config };
    await navigator.clipboard.writeText(values[button.dataset.copyMcpSetup]);
    notify(tr("接続設定をコピーしました。", "Connection setup copied."), "success");
  }));
  document.querySelector("#mcp-token-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const scopes = [...form.querySelectorAll('input[name="scopes"]:checked')].map((input) => input.value);
    try {
      state.mcpNewToken = await json("/api/mcp/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.elements.name.value, expiresInDays: Number(form.elements.expiresInDays.value), scopes }) });
      state.mcpConfig = await json("/api/mcp/config");
      renderSettings();
    } catch (error) { notify(error.message); }
  });
  document.querySelectorAll("[data-revoke-mcp]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm(tr("このMCPトークンを失効しますか？接続中のエージェントは直ちに利用できなくなります。", "Revoke this token? Connected agents will immediately lose access."))) return;
    await json(`/api/mcp/tokens/${button.dataset.revokeMcp}/revoke`, { method: "POST" });
    state.mcpConfig = await json("/api/mcp/config");
    renderSettings();
  }));
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

  form.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => {
    state.storageTestResult = null;
    document.querySelectorAll(".storage-test-result,.storage-preview-panel").forEach((element) => element.remove());
    reflectStorageChoice();
  }));
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
  app.innerHTML = shell(`${pageHead("テスト実行結果", "スイートの品質、速度、BigQuery利用量を実行単位で確認します。")}<section class="table-panel"><table><thead><tr><th>実行ログ</th><th>結果</th><th>合格率</th><th>合格ケース</th><th>所要時間</th><th>課金量</th></tr></thead><tbody>${rows}</tbody></table>${rows ? "" : empty("実行結果がありません", "テストスイートを実行するとここに表示されます。")}</section>`, "reports");
}

function suiteAiSummaryHtml(report, { isLive = false } = {}) {
  const summary = report.aiSummary || { status: isLive ? "pending" : "missing" };
  if (summary.status === "succeeded") {
    const groups = [
      [tr("良かった点", "Strengths"), summary.strengths],
      [tr("確認ポイント", "Concerns"), summary.concerns],
      [tr("次のアクション", "Next actions"), summary.nextActions]
    ].filter(([, items]) => Array.isArray(items) && items.length);
    return `<section class="ai-summary-card succeeded">
      <div class="ai-summary-icon">${icon("sparkles", 22)}</div>
      <div class="ai-summary-content">
        <span class="ai-summary-eyebrow">${tr("サマリー", "Summary")}</span>
        <h2>${esc(summary.headline)}</h2>
        <p>${esc(summary.comment)}</p>
        ${groups.length ? `<div class="ai-summary-groups">${groups.map(([label, items]) => `<div><strong>${label}</strong><ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>`).join("")}</div>` : ""}
        <small>${tr("確定済み評価の要約です。合否・点数は変更しません。", "This summarizes finalized evaluations and does not change scores or pass/fail results.")} · ${esc(summary.model || "Gemini")}</small>
      </div>
      <button id="regenerate-ai-summary" class="button secondary" type="button">${icon("refresh-cw", 14)}${tr("再生成", "Regenerate")}</button>
    </section>`;
  }
  if (summary.status === "generating" || summary.status === "pending" || isLive) {
    return `<section class="ai-summary-card generating"><span class="live-spinner"></span><div class="ai-summary-content"><span class="ai-summary-eyebrow">${tr("サマリー", "Summary")}</span><h2>${tr("全ケースの結果を要約しています", "Summarizing all case results")}</h2><p>${tr("確定した評価結果だけを使って、全体傾向と次のアクションを整理します。", "Using only finalized evaluations to identify overall trends and next actions.")}</p></div></section>`;
  }
  return `<section class="ai-summary-card failed">${icon("triangle-alert", 22)}<div class="ai-summary-content"><span class="ai-summary-eyebrow">${tr("サマリー", "Summary")}</span><h2>${tr("サマリーを生成できませんでした", "Summary could not be generated")}</h2><p>${esc(translateApiMessage(summary.message || tr("まだ生成されていません。", "It has not been generated yet.")))}</p></div><button id="regenerate-ai-summary" class="button secondary" type="button">${icon("refresh-cw", 14)}${tr("再試行", "Retry")}</button></section>`;
}

function reportCaseNavItemHtml(entry, selectedCaseId) {
  const { testCase, item, index, active } = entry;
  const caseId = testCase.id || testCase.caseId;
  const status = item?.status || (active ? "running" : "pending");
  const score = item?.evaluation?.score;
  const grade = scoreGrade(score);
  return `<button type="button" class="report-case-nav-item ${status} ${caseId === selectedCaseId ? "selected" : ""}" data-report-case-id="${esc(caseId)}" aria-current="${caseId === selectedCaseId ? "true" : "false"}">
    <span class="case-nav-index">${String(index + 1).padStart(2, "0")}</span>
    <span class="case-nav-copy"><strong>${esc(item?.title || testCase.title || caseId)}</strong><small>${esc(caseId)}</small></span>
    <span class="case-nav-result"><b>${grade || "—"}</b><small>${item ? fmtDuration(item.runSummary?.durationMs || 0) : active ? tr("実行中", "Running") : tr("待機", "Pending")}</small></span>
  </button>`;
}

function systemGradeDistributionHtml(grades) {
  const total = Object.values(grades).reduce((sum, value) => sum + Number(value || 0), 0);
  const colors = { A: "#168464", B: "#315efb", C: "#d48723", D: "#c53b4d" };
  return `<div class="grade-distribution" aria-label="${tr("システム等級分布", "System grade distribution")}">
    <div class="grade-distribution-bar">${Object.entries(grades).map(([grade, count]) => Number(count) > 0 ? `<i style="width:${(Number(count) / Math.max(total, 1)) * 100}%;background:${colors[grade]}"></i>` : "").join("")}</div>
    <div class="grade-distribution-legend">${Object.entries(grades).map(([grade, count]) => `<span><i style="background:${colors[grade]}"></i><b>${grade}</b> ${formatLocaleNumber(count)}</span>`).join("")}</div>
  </div>`;
}

function renderReport(report, { evidenceByCaseId = null, selectedCaseId = null } = {}) {
  state.activeReport = report;
  const isRunning = report.status === "running";
  const isCancelling = report.status === "cancelling";
  const isLive = isRunning || isCancelling;
  const isCancelled = report.status === "cancelled";
  const isPartial = Boolean(report.partialRun || (report.selectedCaseIds || []).length);
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
  const focusCaseId = report.selectedCaseIds?.[0] || suiteCases[0]?.id || suiteCases[0]?.caseId || "";
  const focusCase =
    suiteCases.find((item) => (item.id || item.caseId) === focusCaseId) || suiteCases[0] || null;
  const activeCases = report.activeCases?.length
    ? report.activeCases
    : report.currentCase
      ? [report.currentCase]
      : [];
  const caseEntries = suiteCases.map((testCase, index) => ({
    testCase,
    index,
    item: completedCases.get(testCase.id || testCase.caseId) || null,
    active: activeCases.find((entry) => entry.caseId === (testCase.id || testCase.caseId)) || null
  }));
  const requestedCaseId = selectedCaseId || state.selectedReportCaseId;
  const fallbackEntry = caseEntries.find((entry) => ["failed", "review_required"].includes(entry.item?.status)) || caseEntries[0];
  const selectedEntry = caseEntries.find((entry) => (entry.testCase.id || entry.testCase.caseId) === requestedCaseId) || fallbackEntry;
  const selectedReportCaseId = selectedEntry ? selectedEntry.testCase.id || selectedEntry.testCase.caseId : null;
  state.selectedReportCaseId = selectedReportCaseId;
  const filteredEntries = state.reportCaseFilter === "issues"
    ? caseEntries.filter((entry) => ["failed", "review_required", "error"].includes(entry.item?.status))
    : caseEntries;
  const caseNav = filteredEntries.map((entry) => reportCaseNavItemHtml(entry, selectedReportCaseId)).join("");
  const selectedCaseDetail = selectedEntry?.item
    ? reportCaseCardHtml({ ...selectedEntry.item, prompt: selectedEntry.item.prompt || selectedEntry.testCase.prompt }, { evidence: evidenceByCaseId?.[selectedEntry.item.caseId] || null })
    : selectedEntry
      ? reportCasePendingHtml(selectedEntry.testCase, selectedEntry.index, { active: selectedEntry.active, isCancelling })
      : empty(tr("ケースがありません", "No cases"), tr("テストスイートにケースを追加してください。", "Add a case to the test suite."));
  const systemGrades = systemGradeCounts(report);
  const runningCount = report.summary?.running ?? (report.activeCases?.length || (report.currentCase ? 1 : 0));
  const concurrency = report.summary?.concurrency || 30;
  const runningHeadline = isCancelling
    ? tr("実行を中止しています", "Stopping the run")
    : isPartial
      ? tr("{title}を個別実行中", "Running {title} alone", {
        title: focusCase?.title || report.currentCase?.title || report.activeCases?.[0]?.title || tr("ケース", "case")
      })
    : runningCount > 1
      ? tr("{count}件を並列実行中（最大{limit}）", "Running {count} cases in parallel (max {limit})", {
        count: formatLocaleNumber(runningCount),
        limit: formatLocaleNumber(concurrency)
      })
      : tr("{title}を処理しています", "Processing {title}", {
        title: report.currentCase?.title || report.activeCases?.[0]?.title || tr("実行準備中", "Preparing run")
      });
  const finishedHeadline = isCancelled
    ? tr("実行を中止しました", "Run cancelled")
    : isPartial
      ? (report.status === "passed"
        ? tr("このケースは基準を満たしました", "This case met the criteria")
        : tr("このケースに改善が必要です", "This case needs improvement"))
    : report.status === "passed"
      ? tr("すべてのケースが基準を満たしました", "All cases met the criteria")
      : tr("改善が必要なケースがあります", "Some cases need improvement");
  const finishedCopy = isCancelled
    ? tr("完了済み {completed} 件の結果を保持し、未実行ケースは中止しました。", "Kept {completed} finished results and cancelled remaining cases.", {
      completed: formatLocaleNumber(report.summary?.evaluated || 0)
    })
    : isPartial
      ? tr("個別実行の評価結果です。ケース編集へ戻って条件を直せます。", "Single-case evaluation result. Return to the case editor to adjust criteria.")
    : tr("{passed}件合格 / {failed}件不合格", "{passed} passed / {failed} failed", {
      passed: formatLocaleNumber(report.summary?.passed || 0),
      failed: formatLocaleNumber(report.summary?.failed || 0)
    });
  const sheetExport = report.sheetExport || { status: "pending" };
  const sheetPanel = sheetExport.status === "succeeded"
    ? ""
    : sheetExport.status === "exporting"
      ? ""
      : sheetExport.status === "failed"
        ? `<section class="sheet-export-status failed">${icon("triangle-alert", 20)}<div><strong>${tr("Google Sheetsへの自動出力に失敗しました", "Automatic export to Google Sheets failed")}</strong><p>${esc(translateApiMessage(sheetExport.message))}</p></div><a class="button secondary" href="#/settings/sheets">${tr("Sheets連携を確認", "Check Sheets integration")}</a></section>`
        : sheetExport.status === "skipped"
          ? `<section class="sheet-export-status skipped">${icon("info", 20)}<div><strong>${tr("Google Sheetsへの自動出力は行われませんでした", "Automatic export to Google Sheets was skipped")}</strong><p>${esc(translateApiMessage(sheetExport.message))}</p></div><a class="button secondary" href="#/settings/sheets">${tr("Sheets連携を設定", "Configure Sheets integration")}</a></section>`
          : "";
  const cancelAction = isRunning
    ? `<button id="cancel-suite-run" class="button danger" type="button">${icon("square", 15)}${tr("実行を中止", "Stop run")}</button>`
    : isCancelling
      ? `<button class="button danger" type="button" disabled>${icon("square", 15)}${tr("中止中…", "Stopping…")}</button>`
      : "";
  const actions = `${cancelAction}${reportToolbarActions(report)}`;
  const backHref =
    isPartial && report.suiteId && focusCaseId
      ? `#/suites/${report.suiteId}/edit/${encodeURIComponent(focusCaseId)}`
      : "#/reports";
  const backLabel = isPartial
    ? tr("ケース編集に戻る", "Back to case editor")
    : tr("テスト実行結果一覧に戻る", "Back to test run results");
  const headerTitle = isPartial && focusCase ? focusCase.title || focusCaseId : suiteRunLabel(report);
  const headerSubtitle = isPartial
    ? tr("個別実行 · {id}", "Single-case run · {id}", { id: report.id })
    : report.id;
  app.innerHTML = shell(`
    ${navHeader({
      title: headerTitle,
      subtitle: headerSubtitle,
      backHref,
      backLabel,
      actions
    })}
    ${detailBody(`
      <section class="report-hero">
      <div class="overall-score"><span>${isLive ? tr("実行進捗", "Run progress") : tr("総合スコア", "Overall score")}</span><strong>${isLive ? completed : overallScore ?? "—"}<small>/${isLive ? total : 100}</small></strong>${!isLive && businessConfigured > 0 ? `<em>${tr("システム 40% + ビジネス 60%", "System 40% + business 60%")}</em>` : !isLive ? `<em>${tr("ビジネス要件未評価のためシステムスコアを採用", "System score used because business requirements were not evaluated")}</em>` : ""}</div>
      <div class="ring" style="--progress:${systemScore};--ring-color:#5d86ff"><b>${scoreText(systemScore)}</b><span>${tr("システム要件", "System requirements")}</span></div>
      <div class="ring ${businessConfigured ? "" : "unscored"}" style="--progress:${businessScore || 0};--ring-color:#55d3a2"><b>${scoreText(businessScore)}</b><span>${tr("ビジネス要件", "Business requirements")}</span></div>
      <div class="hero-copy">${statusPill(report.status)}${isPartial ? `<span class="partial-run-badge">${tr("個別実行", "Single-case")}</span>` : ""}<h2>${isLive ? runningHeadline : finishedHeadline}</h2><p>${isLive ? (isCancelling ? tr("進行中のケースを打ち切り、未着手のケースは中止として記録します。", "In-flight cases are aborted and remaining cases are marked cancelled.") : isPartial ? tr("完了するまでこの画面で待機します。システム要件とビジネス要件の判定が順に表示されます。", "Stay on this screen until the run finishes. System and business checks appear as they complete.") : tr("ケースが完了するたびに、このテスト実行結果へ結果が追加されます。最大{limit}件まで同時実行します。", "Results appear here as each case completes. Up to {limit} cases run at once.", { limit: formatLocaleNumber(concurrency) })) : finishedCopy}</p></div>
      ${isLive ? `<div class="live-progress"><span style="width:${progress}%"></span></div>` : ""}
    </section>
    <section class="report-metrics"><div><span>${tr("システム要件 正解率", "System requirement pass rate")}</span><strong>${scoreText(systemScore)}</strong><small>${tr("{passed} / {total} ケース合格", "{passed} / {total} cases passed", { passed: formatLocaleNumber(report.summary?.systemPassed ?? report.summary?.passed ?? 0), total: formatLocaleNumber(completed) })}</small></div><div><span>${tr("ビジネス要件 正解率", "Business requirement accuracy")}</span><strong>${scoreText(businessScore)}</strong><small>${businessConfigured ? tr("{evaluated} / {total} ケース採点済み", "{evaluated} / {total} cases evaluated", { evaluated: formatLocaleNumber(report.summary?.businessEvaluated || 0), total: formatLocaleNumber(businessConfigured) }) : tr("精度条件未設定", "No accuracy criteria")}</small></div><div class="grade-metric"><span>${tr("システム等級分布", "System grade distribution")}</span>${systemGradeDistributionHtml(systemGrades)}<small>${tr("評価済み {count} ケース", "{count} evaluated cases", { count: formatLocaleNumber(Object.values(systemGrades).reduce((sum, value) => sum + value, 0)) })}</small></div><div><span>${tr("所要時間", "Duration")}</span><strong>${fmtDuration(report.summary?.totalDurationMs)}</strong><small>${tr("{completed} / {total} ケース完了", "{completed} / {total} cases completed", { completed: formatLocaleNumber(completed), total: formatLocaleNumber(total) })}</small></div></section>
    ${suiteAiSummaryHtml(report, { isLive })}
    ${report.evaluationCorrection?.applied ? `<section class="evaluation-correction">${icon("shield-check", 18)}<div><strong>${tr("SQL実行証跡を再評価しました", "Re-evaluated SQL execution evidence")}</strong><p>${esc(translateApiMessage(report.evaluationCorrection.reason))}</p></div></section>` : ""}
    ${sheetPanel}
    <div class="section-row report-workbench-title"><div><h2>${isPartial ? tr("ケース評価", "Case evaluation") : tr("ケース別評価", "Case evaluations")}</h2><p>${tr("左の一覧からケースを選択すると、評価・入力・実行結果を同じ順序で確認できます。", "Select a case to review its evaluation, input, and result in a consistent order.")}</p></div><b class="live-updated">${isLive ? tr("{completed}/{total} 完了 · 自動更新中", "{completed}/{total} complete · auto-refreshing", { completed: formatLocaleNumber(completed), total: formatLocaleNumber(total) }) : tr("完了 {date}", "Completed {date}", { date: fmtDate(report.completedAt) })}</b></div>
    <section class="report-workbench">
      <aside class="report-case-nav" aria-label="${tr("テストケース一覧", "Test case list")}">
        <div class="report-case-nav-head"><div><strong>${tr("テストケース", "Test cases")}</strong><small>${formatLocaleNumber(caseEntries.length)} ${tr("件", "cases")}</small></div><div class="case-filter" role="group" aria-label="${tr("ケース絞り込み", "Case filter")}"><button type="button" data-report-filter="all" class="${state.reportCaseFilter === "all" ? "active" : ""}">${tr("すべて", "All")}</button><button type="button" data-report-filter="issues" class="${state.reportCaseFilter === "issues" ? "active" : ""}">${tr("要対応", "Issues")}</button></div></div>
        <div class="report-case-nav-list">${caseNav || `<p class="muted-copy">${tr("該当ケースはありません。", "No matching cases.")}</p>`}</div>
      </aside>
      <div class="report-case-detail-pane" tabindex="-1">${selectedCaseDetail}</div>
    </section>
    `)}
  `, "reports", "detail");
  renderEvidenceCharts();
  document.querySelectorAll("[data-report-case-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const nav = document.querySelector(".report-case-nav-list");
      const scrollTop = nav?.scrollTop || 0;
      state.selectedReportCaseId = button.dataset.reportCaseId;
      history.replaceState(null, "", `#/reports/${report.id}/cases/${encodeURIComponent(state.selectedReportCaseId)}`);
      renderReport(report, { evidenceByCaseId, selectedCaseId: state.selectedReportCaseId });
      refreshIcons();
      const nextNav = document.querySelector(".report-case-nav-list");
      if (nextNav) nextNav.scrollTop = scrollTop;
      document.querySelector(".report-case-detail-pane h2")?.focus({ preventScroll: true });
      document.querySelector(".report-case-detail-pane")?.scrollTo({ top: 0, behavior: "instant" });
    });
  });
  document.querySelectorAll("[data-report-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reportCaseFilter = button.dataset.reportFilter;
      renderReport(report, { evidenceByCaseId, selectedCaseId: state.selectedReportCaseId });
      refreshIcons();
    });
  });
  document.querySelector("#regenerate-ai-summary")?.addEventListener("click", async () => {
    const button = document.querySelector("#regenerate-ai-summary");
    await withButtonBusy(button, tr("生成中…", "Generating…"), async () => {
      try {
        const updated = await json(`/api/suite-runs/${report.id}/ai-summary`, { method: "POST" });
        state.suiteRuns = [updated, ...state.suiteRuns.filter((item) => item.id !== updated.id)];
        renderReport(updated);
        refreshIcons();
        notify(tr("AIコメントを更新しました。", "Updated the AI comment."), "success");
      } catch (error) {
        notify(error.message);
      }
    });
  });
  document.querySelector("#open-report-json")?.addEventListener("click", () => {
    openJsonViewer({ title: suiteRunLabel(report), data: report });
  });
  document.querySelector("#export-report-pdf")?.addEventListener("click", async () => {
    const button = document.querySelector("#export-report-pdf");
    await withButtonBusy(button, tr("PDF生成中…", "Generating PDF…"), async () => {
      try {
        const pdfPath =
          isPartial && focusCaseId
            ? `/api/suite-runs/${report.id}/export/pdf?caseId=${encodeURIComponent(focusCaseId)}`
            : `/api/suite-runs/${report.id}/export/pdf`;
        const filename = await downloadPdf(
          pdfPath,
          isPartial && focusCaseId
            ? `prismtrail-run-case-${focusCaseId}.pdf`
            : `prismtrail-run-${report.id}.pdf`
        );
        notify(tr("テスト実行結果PDFをダウンロードしました: {name}", "Downloaded test run result PDF: {name}", { name: filename }), "success");
      } catch (error) {
        notify(error.message);
      }
    }, { overlay: true });
  });
  document.querySelectorAll("[data-export-case-run-pdf]").forEach((button) =>
    button.addEventListener("click", async () => {
      const caseId = button.dataset.exportCaseRunPdf;
      if (!caseId) return;
      await withButtonBusy(button, tr("PDF生成中…", "Generating PDF…"), async () => {
        try {
          const filename = await downloadPdf(
            `/api/suite-runs/${report.id}/export/pdf?caseId=${encodeURIComponent(caseId)}`,
            `prismtrail-run-case-${caseId}.pdf`
          );
          notify(tr("ケースPDFをダウンロードしました: {name}", "Downloaded case PDF: {name}", { name: filename }), "success");
        } catch (error) {
          notify(error.message);
        }
      }, { overlay: true });
    })
  );
  if (!isLive && evidenceByCaseId == null && (report.caseRuns || []).some((item) => item.runId)) {
    const limit = isPartial ? 2 : 50;
    loadReportCaseEvidence(report, { limit }).then((map) => {
      if (!location.hash.startsWith(`#/reports/${report.id}`)) return;
      renderReport(report, { evidenceByCaseId: map, selectedCaseId: state.selectedReportCaseId });
      refreshIcons();
    });
  }
  document.querySelector("#cancel-suite-run")?.addEventListener("click", async () => {
    if (
      !(await askConfirm(
        tr(
          "実行中のスイート評価を中止しますか？進行中のケースは打ち切られ、未着手のケースは中止として記録されます。",
          "Stop this suite evaluation? In-flight cases will be aborted and remaining cases will be marked cancelled."
        ),
        { confirmLabel: tr("実行を中止", "Stop run") }
      ))
    ) {
      return;
    }
    const button = document.querySelector("#cancel-suite-run");
    if (button) button.disabled = true;
    try {
      const updated = await json(`/api/suite-runs/${report.id}/cancel`, { method: "POST" });
      state.suiteRuns = [updated, ...state.suiteRuns.filter((item) => item.id !== updated.id)];
      notify(tr("実行の中止を開始しました。", "Started cancelling the run."), "success");
      renderReport(updated);
      refreshIcons();
    } catch (error) {
      notify(error.message);
      if (button) button.disabled = false;
    }
  });
  if (isLive || sheetExport.status === "exporting" || report.aiSummary?.status === "generating") {
    state.reportPollTimer = setTimeout(async () => {
      if (!location.hash.startsWith(`#/reports/${report.id}`)) return;
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

function standaloneRunSummaryHtml(run, evidence) {
  const chartSpec = evidence?.chart?.specs?.[0];
  return `<article class="report-case report-case-detail run-summary-card">
    <section class="case-input-section">${reportSectionHeading("message-square", tr("ユーザープロンプト", "User prompt"))}<div class="evidence-surface prompt-surface"><p>${esc(run.question)}</p></div></section>
    ${evidence?.sql ? `<section class="case-sql-section">${reportSectionHeading("database", tr("実行SQL本文", "Executed SQL"))}<pre>${esc(evidence.sql)}</pre></section>` : ""}
    <div class="case-evidence-sections">
      <section>${reportSectionHeading("message-square-more", tr("回答", "Answer"))}<div class="evidence-surface answer-surface"><p>${esc(evidence?.answer || tr("（最終回答なし）", "(no final answer)"))}</p></div></section>
      <section>${reportSectionHeading("table-2", tr("結果データ", "Result data"))}${evidence?.table?.rows?.length ? `<div class="mini-table-wrap"><table class="mini-table"><thead><tr>${evidence.table.headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${evidence.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="muted-copy">${tr("テーブル結果なし", "No table result")}</p>`}</section>
      <section>${reportSectionHeading("chart-no-axes-combined", tr("チャート", "Chart"))}${chartSpec ? `<div class="report-chart" data-chart-spec="${esc(encodeURIComponent(JSON.stringify(chartSpec)))}"></div>` : `<p class="muted-copy">${tr("チャートなし", "No chart")}</p>`}</section>
    </div>
  </article>`;
}

function renderRunDetailLegacy(run) {
  const context = run.context;
  const suiteRun = context ? state.suiteRuns.find((item) => item.id === context.suiteRunId) : null;
  const caseRun = suiteRun?.caseRuns?.find((item) => item.caseId === context?.caseId);
  const systemEvaluation = caseRun?.evaluation?.system || caseRun?.evaluation;
  const businessEvaluation = caseRun?.evaluation?.business;
  const isLive = run.summary?.status === "running";
  const evidence = extractRunEvidenceClient(run);
  const events = (run.events || []).map((event, index) => {
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
  const subtitle = state.runDetailTab === "trace"
    ? tr("レスポンス詳細", "Response details")
    : tr("実行サマリー", "Run summary");
  const standaloneAgent = state.agents.find((agent) => agentRunMatches(run, agent));
  const backHref = context ? `#/reports/${context.suiteRunId}` : standaloneAgent ? `#/agents/${standaloneAgent.id}/connectivity` : "#/agents";
  const backLabel = context
    ? tr("テスト実行結果へ戻る", "Back to test run result")
    : tr("疎通テストへ戻る", "Back to connectivity test");
  const actions = "";
  const summaryContent = caseRun
    ? reportCaseCardHtml({ ...caseRun, prompt: caseRun.prompt || run.question }, { evidence, showRunLink: false })
    : standaloneRunSummaryHtml(run, evidence);
  const traceContent = `<section class="trace-panel"><div class="section-row"><div><h2>${tr("レスポンス詳細", "Response details")}</h2><p>${isLive ? tr("エージェント応答を待っています…", "Waiting for the agent response…") : tr("{count}件のイベント", "{count} events", { count: formatLocaleNumber((run.events || []).length) })} · ${esc(run.agentLabel)}</p></div></div>${events || (isLive ? empty(tr("実行中", "Running"), tr("完了するとトレースが表示されます。", "The trace will appear when the run finishes.")) : "")}</section>`;
  app.innerHTML = shell(`
    ${navHeader({ title, subtitle, backHref, backLabel, actions })}
    ${detailBody(`
    <section class="run-context"><div><span>${tr("選択中のケース", "Selected case")}</span><strong>${esc(context?.caseTitle || title)}</strong></div><div><span>${tr("検証プロンプト", "Verification prompt")}</span><p>${esc(run.question)}</p></div><code>${esc(run.id)}</code></section>
    <section class="report-metrics"><div><span>${tr("結果", "Result")}</span><strong>${statusPill(run.summary?.status || "running")}</strong></div><div><span>${tr("所要時間", "Duration")}</span><strong>${isLive ? tr("実行中…", "Running…") : fmtDuration(run.summary?.durationMs)}</strong></div><div><span>${tr("課金対象", "Bytes billed")}</span><strong>${fmtBytes(run.summary?.totalBytesBilled)}</strong></div><div><span>${tr("SQL / ジョブ", "SQL / jobs")}</span><strong>${run.summary?.sqlCount || 0} / ${run.summary?.jobCount || 0}</strong></div></section>
    ${caseRun ? `<section class="run-evaluation-summary">
      <article><div class="layer-title"><strong>${tr("システム要件", "System requirements")}</strong><b>${tr("{score}点", "{score} pts", { score: formatLocaleNumber(systemEvaluation?.score ?? 0) })}</b></div><div class="checks">${(systemEvaluation?.checks || []).map((check) => `<span class="${check.passed ? "ok" : "ng"}">${icon(check.passed ? "check" : "x", 13)}${esc(translateApiMessage(check.label))}</span>`).join("")}</div></article>
      <article><div class="layer-title"><strong>ビジネス要件</strong>${gradeBadge(businessEvaluation)}</div>${!businessEvaluation || businessEvaluation.status === "not_configured" ? `<p class="muted-copy">${tr("精度条件は設定されていません。", "Accuracy criteria are not configured.")}</p>` : `${businessEvaluation.summary ? `<p class="business-summary"><strong>${esc(businessEvaluation.summary)}</strong></p>` : ""}${weatherItemList(businessEvaluation, { showEmpty: true })}${(businessEvaluation.discrepancies || []).length ? `<dl><dt>${tr("回答との差分", "Discrepancies")}</dt><dd>${esc(businessEvaluation.discrepancies.join(" / "))}</dd></dl>` : ""}`}</article>
    </section>` : ""}
    <section class="trace-panel"><div class="section-row"><div><h2>${tr("レスポンストレース", "Response trace")}</h2><p>${isLive ? tr("エージェント応答を待っています…", "Waiting for the agent response…") : tr("{count}件のイベント", "{count} events", { count: formatLocaleNumber((run.events || []).length) })} · ${esc(run.agentLabel)}</p></div></div>${events || (isLive ? empty(tr("実行中", "Running"), tr("完了するとトレースが表示されます。", "The trace will appear when the run finishes.")) : "")}</section>
    `)}
  `, context ? "reports" : "agents", "detail");
  if (isLive) {
    state.reportPollTimer = setTimeout(async () => {
      if (location.hash !== `#/runs/${run.id}`) return;
      try {
        const updated = await json(`/api/runs/${run.id}`);
        state.runs = [updated, ...state.runs.filter((item) => item.id !== updated.id)];
        state.selectedRun = updated;
        renderRunDetail(updated);
        refreshIcons();
      } catch (error) {
        notify(tr("進捗の更新に失敗しました: {message}", "Failed to refresh progress: {message}", { message: translateApiMessage(error.message) }));
      }
    }, 1500);
  }
}

function renderRunDetail(run) {
  state.selectedRun = run;
  const context = run.context;
  const suiteRun = context
    ? (state.activeReport?.id === context.suiteRunId ? state.activeReport : state.suiteRuns.find((item) => item.id === context.suiteRunId))
    : null;
  const caseRun = suiteRun?.caseRuns?.find((item) => item.caseId === context?.caseId);
  const isLive = run.summary?.status === "running";
  const evidence = extractRunEvidenceClient(run);
  const events = (run.events || []).map((event, index) => {
    const matchedSql = event.kind === "data.matched_query"
      ? event.payload?.sqlQuery || event.payload?.exampleQuery?.sqlQuery || ""
      : "";
    const body = event.kind.startsWith("text.")
      ? `<p>${esc((event.payload?.parts || []).join("\n"))}</p>`
      : event.kind === "data.generated_sql"
        ? `<pre>${esc(typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload, null, 2))}</pre>`
        : matchedSql
          ? `<div class="matched-sql-note">${icon("badge-check", 14)}${tr("検証済みクエリを再利用", "Reused verified query")}</div><pre>${esc(matchedSql)}</pre>`
          : `<details><summary>${tr("イベントデータ", "Event data")}</summary><pre>${esc(JSON.stringify(event.payload, null, 2))}</pre></details>`;
    return `<article class="trace-event"><span class="trace-dot ${event.severity}"></span><div><header><strong>${esc(translateApiMessage(event.label))}</strong><code>${esc(event.kind)} · #${index + 1}</code></header>${body}</div></article>`;
  }).join("");
  const title = context?.caseTitle || run.agentLabel || tr("単一テスト実行", "Single test run");
  const subtitle = state.runDetailTab === "trace" ? tr("レスポンス詳細", "Response details") : tr("実行サマリー", "Run summary");
  const standaloneAgent = state.agents.find((agent) => agentRunMatches(run, agent));
  const backHref = context ? `#/reports/${context.suiteRunId}/cases/${encodeURIComponent(context.caseId || "")}` : standaloneAgent ? `#/agents/${standaloneAgent.id}/connectivity` : "#/agents";
  const backLabel = context ? tr("テスト実行結果へ戻る", "Back to test run result") : tr("疎通テストへ戻る", "Back to connectivity test");
  const reportHeader = suiteRun
    ? navHeader({
        title: suiteRunLabel(suiteRun),
        subtitle: suiteRun.id,
        backHref: "#/reports",
        backLabel: tr("テスト実行結果一覧に戻る", "Back to test run results"),
        actions: reportToolbarActions(suiteRun, { jsonButtonId: "open-context-report-json", pdfButtonId: "export-context-report-pdf" })
      })
    : navHeader({ title, subtitle, backHref, backLabel });
  const contextHeader = context
    ? `<section class="case-drilldown-header" aria-label="${tr("表示中のテストケース", "Current test case")}"><div class="case-drilldown-inner"><a class="case-drilldown-close" href="${esc(backHref)}" aria-label="${tr("実行詳細を閉じる", "Close run details")}" title="${tr("実行詳細を閉じる", "Close run details")}">${icon("x", 18)}<span>${tr("閉じる", "Close")}</span></a><div class="case-drilldown-icon">${icon("list-tree", 19)}</div><div class="case-drilldown-copy"><span class="case-drilldown-eyebrow">${tr("テストケースの実行詳細を表示中", "Viewing test case run details")}</span><strong>${esc(context.caseTitle || title)}</strong><small>${esc(context.caseId || "")} · ${esc(subtitle)}</small></div></div></section>`
    : `<section class="run-context"><div><span>${tr("選択中のケース", "Selected case")}</span><strong>${esc(title)}</strong></div><div><span>${tr("検証プロンプト", "Verification prompt")}</span><p>${esc(run.question)}</p></div><code>${esc(run.id)}</code></section>`;
  const summaryContent = caseRun
    ? reportCaseCardHtml({ ...caseRun, prompt: caseRun.prompt || run.question }, { evidence, showRunLink: false })
    : standaloneRunSummaryHtml(run, evidence);
  const traceContent = `<section class="trace-panel"><div class="section-row"><div><h2>${tr("レスポンス詳細", "Response details")}</h2><p>${isLive ? tr("エージェント応答を待っています…", "Waiting for the agent response…") : tr("{count}件のイベント", "{count} events", { count: formatLocaleNumber((run.events || []).length) })} · ${esc(run.agentLabel)}</p></div></div>${events || (isLive ? empty(tr("実行中", "Running"), tr("完了するとトレースが表示されます。", "The trace will appear when the run finishes.")) : "")}</section>`;
  app.innerHTML = shell(`
    ${reportHeader}
    ${context ? contextHeader : ""}
    ${detailBody(`
      ${context ? "" : contextHeader}
      <section class="report-metrics"><div><span>${tr("結果", "Result")}</span><strong>${statusPill(run.summary?.status || "running")}</strong></div><div><span>${tr("所要時間", "Duration")}</span><strong>${isLive ? tr("実行中…", "Running…") : fmtDuration(run.summary?.durationMs)}</strong></div><div><span>${tr("課金対象", "Bytes billed")}</span><strong>${fmtBytes(run.summary?.totalBytesBilled)}</strong></div><div><span>${tr("SQL / ジョブ", "SQL / jobs")}</span><strong>${run.summary?.sqlCount || 0} / ${run.summary?.jobCount || 0}</strong></div></section>
      <div class="run-detail-tabs" role="tablist" aria-label="${tr("実行詳細の表示", "Run detail view")}">
        <button type="button" role="tab" data-run-tab="summary" aria-selected="${state.runDetailTab === "summary"}" tabindex="${state.runDetailTab === "summary" ? "0" : "-1"}" class="${state.runDetailTab === "summary" ? "active" : ""}">${icon("layout-dashboard", 16)}${tr("サマリー", "Summary")}</button>
        <button type="button" role="tab" data-run-tab="trace" aria-selected="${state.runDetailTab === "trace"}" tabindex="${state.runDetailTab === "trace" ? "0" : "-1"}" class="${state.runDetailTab === "trace" ? "active" : ""}">${icon("list-tree", 16)}${tr("レスポンス詳細", "Response details")}<small>${formatLocaleNumber((run.events || []).length)}</small></button>
      </div>
      <div class="run-tab-panel" role="tabpanel">${state.runDetailTab === "trace" ? traceContent : summaryContent}</div>
    `)}
  `, context ? "reports" : "run", "detail");
  renderEvidenceCharts();
  document.querySelector("#open-context-report-json")?.addEventListener("click", () => {
    openJsonViewer({ title: suiteRunLabel(suiteRun), data: suiteRun });
  });
  document.querySelector("#export-context-report-pdf")?.addEventListener("click", async () => {
    const button = document.querySelector("#export-context-report-pdf");
    await withButtonBusy(button, tr("PDF生成中…", "Generating PDF…"), async () => {
      try {
        const filename = await downloadPdf(`/api/suite-runs/${suiteRun.id}/export/pdf`, `prismtrail-run-${suiteRun.id}.pdf`);
        notify(tr("テスト実行結果PDFをダウンロードしました: {name}", "Downloaded test run result PDF: {name}", { name: filename }), "success");
      } catch (error) {
        notify(error.message);
      }
    }, { overlay: true });
  });
  const tabButtons = [...document.querySelectorAll("[data-run-tab]")];
  tabButtons.forEach((button, index) => {
    const activate = () => {
      state.runDetailTab = button.dataset.runTab;
      history.replaceState(null, "", `#/runs/${run.id}/${state.runDetailTab === "trace" ? "trace" : "summary"}`);
      renderRunDetail(run);
      refreshIcons();
      window.scrollTo({ top: 0, behavior: "instant" });
      document.querySelector(`[data-run-tab="${state.runDetailTab}"]`)?.focus({ preventScroll: true });
    };
    button.addEventListener("click", activate);
    button.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabButtons.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabButtons.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      tabButtons[nextIndex].click();
    });
  });
  if (isLive) {
    state.reportPollTimer = setTimeout(async () => {
      if (!location.hash.startsWith(`#/runs/${run.id}`)) return;
      try {
        const updated = await json(`/api/runs/${run.id}`);
        state.runs = [updated, ...state.runs.filter((item) => item.id !== updated.id)];
        state.selectedRun = updated;
        renderRunDetail(updated);
        refreshIcons();
      } catch (error) {
        notify(tr("進捗の更新に失敗しました: {message}", "Failed to refresh progress: {message}", { message: translateApiMessage(error.message) }));
      }
    }, 1500);
  }
}

async function route() {
  clearTimeout(state.reportPollTimer);
  state.reportPollTimer = null;
  const parts = location.hash.replace(/^#\//, "").split("/").filter(Boolean);
  if (parts[0] === "sheets") {
    location.replace("#/settings/sheets");
    return;
  }
  if (parts[0] !== "settings") state.mcpNewToken = null;
  await withRouteProgress(async () => {
    try {
      if (parts[0] === "knowledge") {
        location.replace("#/agents");
        return;
      }
      else if (parts[0] === "agents" && parts[1]) {
        let agent = state.agents.find((item) => item.id === parts[1]);
        if (!agent) throw new Error(tr("Data Agentが見つかりません。", "Data Agent not found."));
        if (parts[2] !== "connectivity" && !agent.remoteConfiguration) {
          agent = await json(`/api/agents/${parts[1]}`);
          state.agents = state.agents.map((item) => item.id === agent.id ? agent : item);
        }
        renderAgentDetail(agent, parts[2] === "connectivity" ? "connectivity" : "overview");
      }
      else if (parts[0] === "agents") renderAgents();
      else if (parts[0] === "settings") {
        if (["auth", "sheets", "storage", "mcp"].includes(parts[1])) {
          state.settingsTab = parts[1];
          localStorage.setItem("prismtrail-settings-tab", state.settingsTab);
        }
        const [storage, mcp, authReadiness] = await Promise.all([
          state.storageConfig?.overview ? state.storageConfig : json("/api/storage/config").catch(() => state.storageConfig),
          json("/api/mcp/config").catch(() => state.mcpConfig),
          json("/api/auth/readiness").catch(() => state.authReadiness)
        ]);
        state.storageConfig = storage;
        state.mcpConfig = mcp;
        state.authReadiness = authReadiness;
        renderSettings();
      }
      else if (parts[0] === "run") {
        const agent = state.agents.find((item) => item.status === "ready") || state.agents[0];
        location.replace(agent ? `#/agents/${agent.id}/connectivity` : "#/agents");
        return;
      }
      else if (parts[0] === "reports" && parts[1]) {
        const selectedCaseId = parts[2] === "cases" && parts[3] ? decodeURIComponent(parts[3]) : null;
        const report = await json(`/api/suite-runs/${parts[1]}`);
        state.activeReport = report;
        renderReport(report, { selectedCaseId });
      }
      else if (parts[0] === "reports") renderReports();
      else if (parts[0] === "runs" && parts[1]) {
        state.runDetailTab = parts[2] === "trace" ? "trace" : "summary";
        const run = await json(`/api/runs/${parts[1]}`);
        state.selectedRun = run;
        if (run.context?.suiteRunId && state.activeReport?.id !== run.context.suiteRunId) {
          state.activeReport = await json(`/api/suite-runs/${run.context.suiteRunId}`).catch(() =>
            state.suiteRuns.find((item) => item.id === run.context.suiteRunId) || null
          );
        }
        renderRunDetail(run);
      }
      else if (parts[0] === "suites" && parts[1] && parts[2] === "edit") {
        const deepCaseId = parts[3] ? decodeURIComponent(parts[3]) : "";
        if (state.selectedSuite?.id !== parts[1]) {
          state.suitePasteOpen = false;
          state.suitePasteText = "";
          state.suitePasteValidation = null;
          state.suitePasteError = "";
          state.selectedCaseIndex = 0;
          state.editorTab = "cases";
          state.suiteVersions = [];
          state.selectedSuiteVersionId = null;
          state.selectedSuiteVersion = null;
        }
        if (state.preserveEditorOnLocale && state.selectedSuite?.id === parts[1]) {
          state.preserveEditorOnLocale = false;
        } else {
          state.selectedSuite = await json(`/api/suites/${parts[1]}`);
          state.selectedCaseIndex = 0;
        }
        if (deepCaseId && state.selectedSuite?.cases) {
          const index = state.selectedSuite.cases.findIndex((item) => item.id === deepCaseId);
          if (index >= 0) {
            state.selectedCaseIndex = index;
            state.editorTab = "cases";
          }
        }
        renderEditor();
      } else renderSuites();
      refreshIcons();
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (error) {
      notify(error.message);
    }
  });
}

async function initialize() {
  setBusyOverlay(true, tr("データを読み込み中…", "Loading data…"));
  setRouteProgress(true);
  try {
    const [config, authReadiness, agents, suites, suiteRuns, runs, sheetConnections, storageConfig] = await Promise.all([
      json("/api/config"),
      json("/api/auth/readiness").catch(() => null),
      json("/api/agents"),
      json("/api/suites"),
      json("/api/suite-runs"),
      json("/api/runs").catch(() => ({ runs: [] })),
      json("/api/sheets/connections"),
      json("/api/storage/config?lite=1").catch(() => null)
    ]);
    Object.assign(state, {
      config,
      authReadiness,
      agents: agents.agents,
      suites: suites.suites,
      suiteRuns: suiteRuns.suiteRuns,
      runs: runs.runs || [],
      sheetConnections: sheetConnections.connections,
      sheetFormat: sheetConnections.format,
      storageConfig
    });
    if (!location.hash) location.hash = "#/suites";
    await route();
  } catch (error) {
    app.innerHTML = empty(tr("起動できませんでした", "Could not start the application"), translateApiMessage(error.message));
  } finally {
    setBusyOverlay(false);
    setRouteProgress(false);
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("prismtrail:localechange", () => {
  document.documentElement.lang = getLocale();
  route();
});
app.addEventListener("click", async (event) => {
  const authButton = event.target.closest("#recheck-google-auth-banner");
  if (authButton) {
    event.preventDefault();
    await recheckGoogleAuth(authButton);
    return;
  }
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
  const runButton = event.target.closest("#run-current-suite,[data-run-suite]");
  if (runButton) {
    event.preventDefault();
    runSuite(runButton.dataset.runSuite || state.selectedSuite?.id);
    return;
  }
  const quickSearchButton = event.target.closest("#open-quick-search");
  if (quickSearchButton) {
    event.preventDefault();
    openQuickSearch();
    return;
  }
  const saveButton = event.target.closest("#save-suite");
  if (saveButton) {
    event.preventDefault();
    saveSuite();
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
