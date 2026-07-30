import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  chatWithDataAgent,
  downloadGcsObject,
  fetchJobDetails,
  generateAgentPlan,
  generateSuiteAssistantReply,
  getDataAgent,
  judgeBusinessAccuracy,
  judgeResponseWithContext,
  listGcsBuckets,
  listGcsObjects,
  uploadGcsObject,
  validateGcpProjectId
} from "./lib/google-cloud.mjs";
import { normalizeMessages, summarizeRun } from "./lib/normalize.mjs";
import {
  appendContextEvaluation,
  composeEvaluation,
  evaluateRun,
  summarizeSuiteRun
} from "./lib/evaluate.mjs";
import { JsonStore } from "./lib/json-store.mjs";
import { RunStore } from "./lib/store.mjs";
import {
  createStorageBackend,
  LocalStorageBackend,
  migrateStorage,
  normalizeStorageSettings,
  SwitchableStorageBackend
} from "./lib/primary-storage.mjs";
import {
  createIndexDocument,
  formatRetrievedContext,
  isIndexableObject,
  searchChunks
} from "./lib/knowledge.mjs";
import {
  AGENTS_SHEET,
  bootstrapManagedSheets,
  emptySuiteTemplate,
  getSpreadsheet,
  parseSpreadsheetId,
  pastedTextToSuiteInput,
  readSuiteSheet,
  REPORT_SHEET,
  SUITE_SHEET,
  SUITES_SHEET,
  normalizeSuiteAgentRefs,
  prepareSuiteForSheetExport,
  isCaseRunnable,
  normalizeCaseStatus,
  writeCatalogSheets,
  writeReportSheet,
  writeSuiteSheet
} from "./lib/google-sheets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(__dirname, "public");
const dataDirectory = path.resolve(process.env.PRIMARY_STORAGE_LOCAL_PATH || path.join(__dirname, "data"));
const storageConfigPath = path.resolve(
  process.env.PRIMARY_STORAGE_CONFIG_PATH || path.join(dataDirectory, "storage-config.json")
);
const storageNamespaces = [
  "runs",
  "agents",
  "suites",
  "suite-runs",
  "sheet-connections",
  "knowledge-sources",
  "knowledge-indexes"
];

function storageConfigInput(value = {}) {
  return {
    provider: value.driver || value.provider,
    projectId: value.projectId,
    bucket: value.bucket,
    prefix: value.prefix
  };
}

function publicStorageConfig(value, backend, extra = {}) {
  const description = backend.describe();
  return {
    driver: description.provider,
    defaultDriver: "gcs",
    projectId: description.projectId || "",
    bucket: description.bucket || "",
    prefix: description.prefix || "",
    localPath: description.rootDirectory || value.localPath || dataDirectory,
    status: extra.status || "ready",
    lastSyncedAt: value.lastSyncedAt || null,
    objectCount: extra.objectCount ?? null,
    sizeBytes: extra.sizeBytes ?? null,
    revision: Number(value.revision || 1),
    updatedAt: value.updatedAt || null
  };
}

async function readStorageConfig() {
  try {
    const stored = JSON.parse(await readFile(storageConfigPath, "utf8"));
    return { ...stored, driver: stored.driver || stored.provider };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const driver =
      process.env.PRIMARY_STORAGE_DRIVER ||
      (process.env.PRIMARY_STORAGE_BUCKET ? "gcs" : "local");
    return {
      schemaVersion: 1,
      driver,
      projectId: process.env.PRIMARY_STORAGE_PROJECT || "",
      bucket: process.env.PRIMARY_STORAGE_BUCKET || "",
      prefix: process.env.PRIMARY_STORAGE_PREFIX || "agent-eval/system-data/",
      localPath: dataDirectory,
      revision: 1,
      updatedAt: null
    };
  }
}

async function saveStorageConfig(value) {
  await mkdir(path.dirname(storageConfigPath), { recursive: true });
  const temporaryPath = `${storageConfigPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, storageConfigPath);
  return value;
}

function backendFromConfig(value) {
  if ((value.driver || value.provider) === "local") {
    return new LocalStorageBackend(path.resolve(value.localPath || dataDirectory));
  }
  return createStorageBackend(storageConfigInput(value), { dataDirectory });
}

let storageConfig = await readStorageConfig();
let initialBackend;
try {
  initialBackend = backendFromConfig(storageConfig);
} catch (error) {
  console.warn(`[storage] 設定を読み込めないためローカルへフォールバックしました: ${error.message}`);
  initialBackend = new LocalStorageBackend(dataDirectory);
  storageConfig = {
    ...storageConfig,
    driver: "local",
    localPath: dataDirectory,
    fallbackReason: error.message
  };
}
const primaryStorage = new SwitchableStorageBackend(initialBackend);
const runStore = new RunStore(primaryStorage, "runs");
const agentStore = new JsonStore(primaryStorage, "agents");
const suiteStore = new JsonStore(primaryStorage, "suites");
const suiteRunStore = new JsonStore(primaryStorage, "suite-runs");
const sheetConnectionStore = new JsonStore(primaryStorage, "sheet-connections");
const knowledgeSourceStore = new JsonStore(primaryStorage, "knowledge-sources");
const knowledgeIndexStore = new JsonStore(primaryStorage, "knowledge-indexes");
const port = Number(process.env.PORT || 4318);
const host = process.env.HOST || "127.0.0.1";

const config = {
  billingProject: process.env.BQ_AGENT_BILLING_PROJECT || "",
  location: process.env.BQ_AGENT_LOCATION || "global",
  agent: process.env.BQ_AGENT_RESOURCE || "",
  agentLabel: process.env.BQ_AGENT_LABEL || "My BigQuery Data Agent",
  vertexProject: process.env.VERTEX_AI_PROJECT || process.env.BQ_AGENT_BILLING_PROJECT || "",
  vertexLocation: process.env.VERTEX_AI_LOCATION || "global",
  vertexModel: process.env.VERTEX_AI_MODEL || "gemini-2.5-flash",
  vertexJudgeModel: process.env.VERTEX_AI_JUDGE_MODEL || "gemini-2.5-flash-lite",
  sheets: {
    suiteTab: SUITE_SHEET,
    reportTab: REPORT_SHEET,
    agentsTab: AGENTS_SHEET,
    suitesTab: SUITES_SHEET,
    schemaVersion: 2
  }
};

const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/i18n.js": ["i18n.js", "text/javascript; charset=utf-8"],
  "/i18n-core.js": ["i18n-core.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/assets/prismtrail-mark.png": ["assets/prismtrail-mark.png", "image/png"],
  "/vendor/lucide.min.js": ["../node_modules/lucide/dist/umd/lucide.min.js", "text/javascript; charset=utf-8"],
  "/vendor/vega.min.js": ["../node_modules/vega/build/vega.min.js", "text/javascript; charset=utf-8"],
  "/vendor/vega-lite.min.js": ["../node_modules/vega-lite/build/vega-lite.min.js", "text/javascript; charset=utf-8"],
  "/vendor/vega-embed.min.js": ["../node_modules/vega-embed/build/vega-embed.min.js", "text/javascript; charset=utf-8"]
};

function securityHeaders(contentType) {
  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'"
    ].join("; "),
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    ...securityHeaders("application/json; charset=utf-8"),
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function requestedStorageConfig(body = {}) {
  const driver = String(body.driver || body.provider || "gcs").toLowerCase();
  if (driver === "local") {
    return {
      driver: "local",
      localPath: path.resolve(String(body.localPath || dataDirectory))
    };
  }
  const normalized = normalizeStorageSettings(storageConfigInput({ ...body, driver }));
  return { driver: "gcs", ...normalized };
}

async function storageStats(backend = primaryStorage.backend) {
  let objectCount = 0;
  let sizeBytes = 0;
  for (const namespace of storageNamespaces) {
    const values = await backend.list(namespace);
    objectCount += values.length;
    sizeBytes += values.reduce(
      (total, value) => total + Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`),
      0
    );
  }
  return { objectCount, sizeBytes };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function validateAgentResource(agent) {
  return /^projects\/[^/]+\/locations\/[^/]+\/dataAgents\/[^/]+$/.test(agent);
}

function parseAgentResource(resourceName) {
  const match = resourceName.match(/^projects\/([^/]+)\/locations\/([^/]+)\/dataAgents\/([^/]+)$/);
  return match ? { projectId: match[1], location: match[2], remoteId: match[3] } : null;
}

function objectId(prefix) {
  return `${prefix}_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
}

function normalizeExpectations(value = {}) {
  const system = value.systemRequirements || value;
  const business = value.businessRequirements || {};
  const accuracyCriteria = String(
    business.accuracyCriteria ?? value.accuracyCriteria ?? ""
  ).trim().slice(0, 5000);
  return {
    schemaVersion: 2,
    systemRequirements: {
      requireSql: system.requireSql !== false,
      requireChart: Boolean(system.requireChart),
      maxDurationMs: Math.max(0, Number(system.maxDurationMs || 0)),
      maxBytesBilled: Math.max(0, Number(system.maxBytesBilled || 0)),
      requiredPhrases: Array.isArray(system.requiredPhrases)
        ? system.requiredPhrases.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 10)
        : []
    },
    businessRequirements: {
      enabled: business.enabled !== false && Boolean(accuracyCriteria),
      accuracyCriteria,
      passingGrade: ["A", "B", "C", "D"].includes(business.passingGrade)
        ? business.passingGrade
        : "B"
    },
    // 移行期間中の旧UI・過去データ向けミラー。
    requireSql: system.requireSql !== false,
    requireChart: Boolean(system.requireChart),
    maxDurationMs: Math.max(0, Number(system.maxDurationMs || 0)),
    maxBytesBilled: Math.max(0, Number(system.maxBytesBilled || 0)),
    requiredPhrases: Array.isArray(system.requiredPhrases)
      ? system.requiredPhrases.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 10)
      : []
  };
}

function normalizeSuite(body, existing = {}) {
  const now = new Date().toISOString();
  const cases = Array.isArray(body.cases) ? body.cases : existing.cases || [];
  const defaultAgentId = String(body.defaultAgentId ?? existing.defaultAgentId ?? "").trim();
  return {
    schemaVersion: 2,
    id: existing.id || objectId("suite"),
    name: String(body.name ?? existing.name ?? "無題のテストスイート").trim().slice(0, 120),
    description: String(body.description ?? existing.description ?? "").trim().slice(0, 2000),
    status: body.status === "active" ? "active" : existing.status || "draft",
    defaultAgentId,
    knowledgeSourceIds: Array.isArray(body.knowledgeSourceIds)
      ? body.knowledgeSourceIds.map(String).filter(Boolean).slice(0, 20)
      : existing.knowledgeSourceIds || [],
    cases: cases.slice(0, 50).map((item, index) => ({
      id: /^[a-zA-Z0-9_-]+$/.test(String(item.id || "")) ? String(item.id) : `case_${index + 1}_${randomUUID().slice(0, 6)}`,
      title: String(item.title || `テストケース ${index + 1}`).trim().slice(0, 160),
      prompt: String(item.prompt || "").trim().slice(0, 5000),
      agentId: String(item.agentId || defaultAgentId || "").trim(),
      knowledgeSourceIds: Array.isArray(item.knowledgeSourceIds)
        ? item.knowledgeSourceIds.map(String).filter(Boolean).slice(0, 20)
        : [],
      thinkingMode: item.thinkingMode === "THINKING" ? "THINKING" : "FAST",
      status: normalizeCaseStatus(item.status, { fallback: "active" }),
      expectations: normalizeExpectations(item.expectations)
    })),
    createdAt: existing.createdAt || now,
    updatedAt: now,
    lastRunAt: existing.lastRunAt || null
  };
}

function validateBucketName(value) {
  const bucket = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket)) {
    throw new Error("GCSバケット名の形式が正しくありません。");
  }
  return bucket;
}

function normalizePrefix(value) {
  const prefix = String(value || "").trim().replace(/^\/+/, "");
  if (prefix.includes("..") || prefix.length > 500) throw new Error("GCS prefixの形式が正しくありません。");
  return prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix;
}

async function createKnowledgeSources(body, { batch = false } = {}) {
  const projectId = validateGcpProjectId(body.projectId);
  const prefix = normalizePrefix(body.prefix);
  const requestedBuckets = batch
    ? Array.isArray(body.buckets)
      ? body.buckets
      : []
    : [body.bucket];
  const buckets = [...new Set(requestedBuckets.map(validateBucketName))].slice(0, 20);
  if (!buckets.length) throw new Error("登録するGCSバケットを1件以上選択してください。");
  const existing = await knowledgeSourceStore.list();
  const existingKeys = new Set(
    existing.map((source) => `${source.projectId || ""}\n${source.bucket}\n${source.prefix || ""}`)
  );
  const now = new Date().toISOString();
  const created = [];
  const skipped = [];
  for (const bucket of buckets) {
    if (existingKeys.has(`${projectId}\n${bucket}\n${prefix}`)) {
      skipped.push(bucket);
      continue;
    }
    created.push(
      await knowledgeSourceStore.save({
        schemaVersion: 1,
        id: objectId("knowledge"),
        name:
          buckets.length === 1 && String(body.name || "").trim()
            ? String(body.name).trim().slice(0, 120)
            : bucket,
        description: String(body.description || "").trim().slice(0, 1000),
        projectId,
        bucket,
        prefix,
        status: "unchecked",
        objectCount: 0,
        chunkCount: 0,
        lastSyncedAt: null,
        createdAt: now,
        updatedAt: now
      })
    );
  }
  return { sources: created, skipped };
}

async function retrieveKnowledge(query, sourceIds, limit = 6) {
  const ids = [...new Set((sourceIds || []).map(String).filter(Boolean))];
  const chunks = [];
  for (const sourceId of ids) {
    try {
      const index = await knowledgeIndexStore.get(sourceId);
      chunks.push(...(index.chunks || []));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const matches = searchChunks(chunks, query, { limit });
  return {
    matches,
    context: formatRetrievedContext(matches),
    sourceIds: ids
  };
}

async function syncKnowledgeSource(source) {
  const listing = await listGcsObjects({
    bucket: source.bucket,
    prefix: source.prefix,
    maxObjects: 200
  });
  const candidates = listing.items
    .filter(isIndexableObject)
    .filter((item) => Number(item.size || 0) <= 2 * 1024 * 1024)
    .slice(0, 60);
  const objects = [];
  const errors = [];
  for (const item of candidates) {
    try {
      objects.push({
        ...item,
        text: await downloadGcsObject({ bucket: source.bucket, objectName: item.name })
      });
    } catch (error) {
      errors.push({ objectName: item.name, message: error.message });
    }
  }
  const index = await knowledgeIndexStore.save(createIndexDocument(source, objects));
  const now = new Date().toISOString();
  const updated = await knowledgeSourceStore.save({
    ...source,
    status: errors.length ? "warning" : "ready",
    authSource: listing.authSource,
    lastSyncedAt: now,
    objectCount: index.objectCount,
    chunkCount: index.chunkCount,
    skippedObjectCount: listing.items.length - candidates.length,
    truncated: listing.truncated,
    syncErrors: errors.slice(0, 10),
    updatedAt: now
  });
  return { source: updated, index: { ...index, chunks: undefined }, objects: listing.items };
}

function mergeAssistantPatch(suite, patch = {}) {
  const next = { ...suite };
  if (typeof patch.name === "string") next.name = patch.name;
  if (typeof patch.description === "string") next.description = patch.description;
  if (Array.isArray(patch.cases)) {
    const byId = new Map((suite.cases || []).map((item) => [item.id, item]));
    for (const item of patch.cases) {
      const id = String(item.id || "");
      if (id && byId.has(id)) byId.set(id, { ...byId.get(id), ...item });
      else byId.set(id || `case_${randomUUID().slice(0, 8)}`, item);
    }
    next.cases = [...byId.values()];
  }
  return normalizeSuite(next, suite);
}

function suiteRunProjection(run) {
  return {
    id: run.id,
    suiteId: run.suiteId,
    suiteName: run.suiteName,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    summary: run.summary
  };
}

function slimSuiteRun(run) {
  return {
    ...run,
    caseRuns: (run.caseRuns || []).map((item) => ({
      ...item,
      runId: item.runId || item.run?.id || null,
      runSummary: item.runSummary || item.run?.summary || null,
      run: undefined
    }))
  };
}

function correctedRunSummary(run) {
  return summarizeRun(
    run.events || [],
    run.jobs || [],
    Number(run.summary?.durationMs || 0)
  );
}

async function resolveRunContext(runId) {
  for (const suiteRun of await suiteRunStore.list()) {
    const caseRun = (suiteRun.caseRuns || []).find((item) => item.runId === runId);
    if (!caseRun) continue;
    return {
      suiteRunId: suiteRun.id,
      suiteId: suiteRun.suiteId,
      suiteName: suiteRun.suiteName,
      caseId: caseRun.caseId,
      caseTitle: caseRun.title,
      evaluationStatus: caseRun.status
    };
  }
  return null;
}

async function runDetailView(run) {
  return {
    ...run,
    summary: correctedRunSummary(run),
    context: run.context || await resolveRunContext(run.id)
  };
}

async function correctedSuiteRunView(run) {
  const view = structuredClone(run);
  let corrected = false;
  for (const caseRun of view.caseRuns || []) {
    const sqlCheck = caseRun.evaluation?.checks?.find((check) => check.id === "sql");
    if (!sqlCheck) continue;
    sqlCheck.label = "SQLを生成・実行";
    if (sqlCheck.passed || !caseRun.runId) continue;
    try {
      const detail = await runStore.get(caseRun.runId);
      const summary = correctedRunSummary(detail);
      if (summary.sqlCount <= 0) continue;
      caseRun.runSummary = summary;
      sqlCheck.passed = true;
      sqlCheck.actual = summary.sqlCount;
      const checks = caseRun.evaluation.checks || [];
      caseRun.evaluation.passedCount = checks.filter((check) => check.passed).length;
      caseRun.evaluation.checkCount = checks.length;
      caseRun.evaluation.score = checks.length
        ? Math.round((caseRun.evaluation.passedCount / checks.length) * 100)
        : 0;
      caseRun.evaluation.status = checks.every((check) => check.passed) ? "passed" : "failed";
      caseRun.evaluation.system = {
        status: caseRun.evaluation.status,
        score: caseRun.evaluation.score,
        passedCount: caseRun.evaluation.passedCount,
        checkCount: caseRun.evaluation.checkCount,
        checks
      };
      const business = caseRun.evaluation.business;
      caseRun.status =
        business?.status === "judge_error"
          ? "review_required"
          : caseRun.evaluation.system.status === "passed" &&
              (!business || business.status === "not_configured" || business.passed === true)
            ? "passed"
            : "failed";
      caseRun.evaluation.status = caseRun.status;
      corrected = true;
    } catch {
      // Keep the stored evaluation when its underlying run is unavailable.
    }
  }
  if (corrected) {
    view.summary = summarizeSuiteRun(view.caseRuns);
    view.summary.total = view.suiteSnapshot?.cases?.length || view.caseRuns.length;
    view.summary.completed = view.caseRuns.length;
    if (view.status !== "running") {
      view.status = view.summary.status;
    }
    view.evaluationCorrection = {
      applied: true,
      reason: "検証済みSQLまたはBigQuery Query JobをSQL証跡として再判定しました。"
    };
  }
  return view;
}

function sheetConnectionProjection(connection) {
  return {
    id: connection.id,
    spreadsheetId: connection.spreadsheetId,
    title: connection.title,
    spreadsheetUrl: connection.spreadsheetUrl,
    locale: connection.locale,
    authSource: connection.authSource,
    status: connection.status,
    lastCheckedAt: connection.lastCheckedAt,
    lastImportedAt: connection.lastImportedAt,
    lastExportedAt: connection.lastExportedAt,
    lastOperation: connection.lastOperation,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    bootstrap: connection.bootstrap || null
  };
}

async function resolveBootstrapSuite(suiteId) {
  if (suiteId) {
    const suite = await findLocalSuite(String(suiteId));
    if (!suite) throw new Error("初期化に使うテストスイートが見つかりません。");
    return suite;
  }
  const suites = await suiteStore.list();
  if (!suites.length) return emptySuiteTemplate();
  return [...suites].sort((left, right) =>
    String(right.updatedAt || right.createdAt || "").localeCompare(
      String(left.updatedAt || left.createdAt || "")
    )
  )[0];
}

async function connectAndBootstrapSheet({
  spreadsheetId,
  suiteId,
  existing = null,
  forceOperational = false
}) {
  const now = new Date().toISOString();
  const suite = await resolveBootstrapSuite(suiteId);
  const agents = await agentStore.list();
  const suites = await suiteStore.list();
  const bootstrap = await bootstrapManagedSheets(spreadsheetId, {
    suite,
    agents,
    suites,
    forceOperational
  });
  const remote = bootstrap.spreadsheet;
  const bootstrapped =
    bootstrap.suiteBootstrapped || bootstrap.reportBootstrapped || bootstrap.catalogsBootstrapped;
  return sheetConnectionStore.save({
    schemaVersion: 1,
    id: existing?.id || objectId("sheet"),
    spreadsheetId,
    title: remote.title,
    spreadsheetUrl: remote.spreadsheetUrl,
    locale: remote.locale || existing?.locale || null,
    authSource: remote.authSource,
    status: "ready",
    lastCheckedAt: now,
    lastImportedAt: existing?.lastImportedAt || null,
    lastExportedAt: bootstrapped ? now : existing?.lastExportedAt || null,
    lastOperation: bootstrapped
      ? `bootstrapped:${[
          bootstrap.catalogsBootstrapped ? `${AGENTS_SHEET}+${SUITES_SHEET}` : null,
          bootstrap.suiteBootstrapped ? SUITE_SHEET : null,
          bootstrap.reportBootstrapped ? REPORT_SHEET : null
        ]
          .filter(Boolean)
          .join(",")}`
      : existing?.lastOperation || "connected",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    bootstrap: {
      suiteBootstrapped: bootstrap.suiteBootstrapped,
      reportBootstrapped: bootstrap.reportBootstrapped,
      catalogsBootstrapped: bootstrap.catalogsBootstrapped,
      agentCount: bootstrap.agentCount,
      suiteCount: bootstrap.suiteCount,
      suiteId: suite.id || null,
      suiteName: suite.name || null
    }
  });
}

async function refreshSheetConnection(connection, { suiteId, forceOperational = false } = {}) {
  return connectAndBootstrapSheet({
    spreadsheetId: connection.spreadsheetId,
    suiteId,
    existing: connection,
    forceOperational
  });
}

async function syncReadySheetCatalogs() {
  const connections = (await sheetConnectionStore.list()).filter(
    (connection) => connection.status === "ready"
  );
  if (!connections.length) return [];
  const agents = await agentStore.list();
  const suites = await suiteStore.list();
  const results = [];
  for (const connection of connections) {
    try {
      const catalog = await writeCatalogSheets(connection.spreadsheetId, { agents, suites });
      const now = new Date().toISOString();
      const updated = await sheetConnectionStore.save({
        ...connection,
        title: catalog.spreadsheet.title,
        spreadsheetUrl: catalog.spreadsheet.spreadsheetUrl,
        authSource: catalog.spreadsheet.authSource,
        status: "ready",
        lastCheckedAt: now,
        lastExportedAt: now,
        lastOperation: `catalog-sync:${AGENTS_SHEET},${SUITES_SHEET}`,
        updatedAt: now
      });
      results.push(updated);
    } catch (error) {
      console.error(`[sheets-catalog] ${connection.id} ${error.message}`);
    }
  }
  return results;
}

async function findLocalSuite(id) {
  if (!id) return null;
  return (await suiteStore.list()).find((suite) => suite.id === id) || null;
}

function suiteCaseDiff(previousCases = [], nextCases = []) {
  const previous = new Map(previousCases.map((item) => [item.id, item]));
  const next = new Map(nextCases.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const [id, item] of next) {
    const before = previous.get(id);
    if (!before) added += 1;
    else if (JSON.stringify(before) === JSON.stringify(item)) unchanged += 1;
    else updated += 1;
  }
  return {
    added,
    updated,
    removed: [...previous.keys()].filter((id) => !next.has(id)).length,
    unchanged
  };
}

async function validateSuiteReferences(suite) {
  const agents = await agentStore.list();
  const normalized = normalizeSuiteAgentRefs(suite, agents);
  const agentIds = new Set(agents.map((agent) => agent.id));
  const unknownAgents = [
    ...new Set((normalized.cases || []).map((item) => item.agentId).filter((id) => !agentIds.has(id)))
  ];
  if (unknownAgents.length) {
    throw new Error(`未登録のData Agent IDがあります: ${unknownAgents.join(", ")}`);
  }
  const knowledgeSources = new Set((await knowledgeSourceStore.list()).map((source) => source.id));
  const referencedKnowledge = [
    ...(normalized.knowledgeSourceIds || []),
    ...(normalized.cases || []).flatMap((item) => item.knowledgeSourceIds || [])
  ];
  const unknownKnowledge = [...new Set(referencedKnowledge.filter((id) => !knowledgeSources.has(id)))];
  if (unknownKnowledge.length) {
    throw new Error(`未登録のナレッジIDがあります: ${unknownKnowledge.join(", ")}`);
  }
  return {
    suite: normalized,
    agentCount: new Set((normalized.cases || []).map((item) => item.agentId)).size,
    knowledgeSourceCount: new Set(referencedKnowledge).size
  };
}

async function executeRun(body) {
  const question = String(body.question || "").trim();
  const agent = String(body.agent || config.agent).trim();
  const agentLabel = String(body.agentLabel || config.agentLabel).trim();
  const thinkingMode = body.thinkingMode === "THINKING" ? "THINKING" : "FAST";
  if (question.length < 5 || question.length > 5000) throw new Error("質問は5〜5000文字で指定してください。");
  if (!validateAgentResource(agent)) throw new Error("Data Agent resource nameの形式が正しくありません。");

  const id = objectId("run");
  const createdAt = new Date().toISOString();
  console.log(`[run] ${id} ${thinkingMode} ${question.slice(0, 120)}`);
  const result = await chatWithDataAgent({
    billingProject: config.billingProject,
    location: parseAgentResource(agent)?.location || config.location,
    dataAgent: agent,
    question,
    thinkingMode
  });
  const events = normalizeMessages(result.messages);
  const jobs = await fetchJobDetails(events, result.token);
  const summary = summarizeRun(events, jobs, result.durationMs);
  return runStore.save({
    schemaVersion: 1,
    id,
    createdAt,
    question,
    agent,
    agentLabel,
    context: body.context || null,
    request: result.request,
    rawMessages: result.messages,
    events,
    jobs,
    summary
  });
}

async function createSuiteRun(suite) {
  if (!suite.cases?.length) throw new Error("テストケースを1件以上登録してください。");
  const runnableCount = suite.cases.filter((item) => isCaseRunnable(item)).length;
  if (!runnableCount) {
    throw new Error("実行可のテストケースがありません。ケースのステータスを「実行可」にしてください。");
  }
  const suiteRun = {
    schemaVersion: 1,
    id: objectId("suite_run"),
    suiteId: suite.id,
    suiteName: suite.name,
    suiteSnapshot: suite,
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    currentCase: null,
    sheetExport: { status: "pending" },
    caseRuns: [],
    summary: {
      status: "running",
      total: suite.cases.length,
      runnable: runnableCount,
      skipped: suite.cases.length - runnableCount,
      completed: 0
    }
  };
  await suiteRunStore.save(suiteRun);
  return suiteRun;
}

async function autoExportSuiteRun(suiteRun) {
  const connections = (await sheetConnectionStore.list())
    .filter((connection) => connection.status === "ready")
    .sort((left, right) =>
      String(right.lastExportedAt || right.updatedAt || "").localeCompare(
        String(left.lastExportedAt || left.updatedAt || "")
      )
    );
  const connection = connections[0];
  if (!connection) {
    return {
      status: "skipped",
      message: "接続済みのGoogleスプレッドシートがないため、自動出力をスキップしました。"
    };
  }
  try {
    const result = await writeReportSheet(connection.spreadsheetId, suiteRun);
    const now = new Date().toISOString();
    const updated = await sheetConnectionStore.save({
      ...connection,
      title: result.spreadsheet.title,
      spreadsheetUrl: result.spreadsheet.spreadsheetUrl,
      authSource: result.spreadsheet.authSource,
      status: "ready",
      lastCheckedAt: now,
      lastExportedAt: now,
      lastOperation: `report-auto-export:${suiteRun.id}`,
      updatedAt: now
    });
    return {
      status: "succeeded",
      connectionId: updated.id,
      spreadsheetTitle: updated.title,
      spreadsheetUrl: updated.spreadsheetUrl,
      tabName: result.sheetTitle,
      rowCount: result.rowCount,
      completedAt: now
    };
  } catch (error) {
    return {
      status: "failed",
      message: error.message,
      completedAt: new Date().toISOString()
    };
  }
}

async function processSuiteRun(suite, suiteRun) {
  const agents = new Map((await agentStore.list()).map((agent) => [agent.id, agent]));
  for (let caseIndex = 0; caseIndex < suite.cases.length; caseIndex += 1) {
    const testCase = suite.cases[caseIndex];
    if (!isCaseRunnable(testCase)) {
      suiteRun.caseRuns.push({
        caseId: testCase.id,
        title: testCase.title,
        status: "skipped",
        skipReason: "ケースのステータスが実行可ではないためスキップしました。",
        evaluation: { status: "skipped", score: null, checks: [] }
      });
      suiteRun.summary = summarizeSuiteRun(suiteRun.caseRuns);
      suiteRun.summary.total = suite.cases.length;
      suiteRun.summary.completed = suiteRun.caseRuns.length;
      suiteRun.updatedAt = new Date().toISOString();
      await suiteRunStore.save(suiteRun);
      continue;
    }
    suiteRun.currentCase = {
      index: caseIndex,
      caseId: testCase.id,
      title: testCase.title,
      phase: "running",
      startedAt: new Date().toISOString()
    };
    suiteRun.updatedAt = suiteRun.currentCase.startedAt;
    await suiteRunStore.save(suiteRun);
    const agent = agents.get(testCase.agentId);
    if (!agent) {
      suiteRun.caseRuns.push({
        caseId: testCase.id,
        title: testCase.title,
        status: "failed",
        error: "選択されたData Agentが登録されていません。",
        evaluation: { status: "failed", score: 0, checks: [] }
      });
    } else {
      try {
        const selectedKnowledgeSourceIds = testCase.knowledgeSourceIds?.length
          ? testCase.knowledgeSourceIds
          : suite.knowledgeSourceIds || [];
        const retrieved = await retrieveKnowledge(testCase.prompt, selectedKnowledgeSourceIds);
        const run = await executeRun({
          question: testCase.prompt,
          agent: agent.resourceName,
          agentLabel: agent.displayName,
          thinkingMode: testCase.thinkingMode,
          context: {
            suiteRunId: suiteRun.id,
            suiteId: suite.id,
            suiteName: suite.name,
            caseId: testCase.id,
            caseTitle: testCase.title
          }
        });
        suiteRun.currentCase.phase = "evaluating_system";
        suiteRun.updatedAt = new Date().toISOString();
        await suiteRunStore.save(suiteRun);
        let evaluation = evaluateRun(run, testCase.expectations);
        if (retrieved.context) {
          const responseText = (run.events || [])
            .filter((event) => event.kind === "text.final_response")
            .flatMap((event) => event.payload?.parts || [])
            .join("\n");
          let judge;
          try {
            judge = await judgeResponseWithContext({
              project: config.vertexProject,
              location: config.vertexLocation,
              model: config.vertexModel,
              question: testCase.prompt,
              responseText,
              knowledgeContext: retrieved.context
            });
          } catch (error) {
            judge = {
              passed: false,
              score: 0,
              reason: `ナレッジ根拠判定を完了できませんでした: ${error.message}`,
              citations: [],
              evaluationError: true
            };
          }
          evaluation = appendContextEvaluation(evaluation, judge);
        }
        const businessRequirements = testCase.expectations?.businessRequirements || {};
        if (businessRequirements.enabled && businessRequirements.accuracyCriteria) {
          suiteRun.currentCase.phase = "evaluating_business";
          suiteRun.updatedAt = new Date().toISOString();
          await suiteRunStore.save(suiteRun);
          const finalText = (run.events || [])
            .filter((event) => event.kind === "text.final_response")
            .flatMap((event) => event.payload?.parts || [])
            .join("\n");
          const dataEvidence = (run.events || [])
            .filter((event) => event.kind === "data.result")
            .slice(0, 5)
            .map((event) => JSON.stringify(event.payload))
            .join("\n")
            .slice(0, 40_000);
          const answerEvidence = [
            finalText ? `FINAL_RESPONSE:\n${finalText}` : "",
            dataEvidence ? `DATA_RESULT:\n${dataEvidence}` : ""
          ].filter(Boolean).join("\n\n");
          let accuracyJudge;
          if (!answerEvidence) {
            accuracyJudge = {
              evaluationError: true,
              reason: "精度を判定できる最終回答またはデータ結果がありません。"
            };
          } else {
            try {
              accuracyJudge = await judgeBusinessAccuracy({
                project: config.vertexProject,
                location: config.vertexLocation,
                model: config.vertexJudgeModel,
                question: testCase.prompt,
                accuracyCriteria: businessRequirements.accuracyCriteria,
                answerEvidence
              });
            } catch (error) {
              accuracyJudge = {
                evaluationError: true,
                reason: `Vertex AIによる精度判定を完了できませんでした: ${error.message}`
              };
            }
          }
          evaluation = composeEvaluation(evaluation, accuracyJudge, businessRequirements);
        } else {
          evaluation = composeEvaluation(evaluation, null, businessRequirements);
        }
        suiteRun.caseRuns.push({
          caseId: testCase.id,
          title: testCase.title,
          agentId: agent.id,
          status: evaluation.status,
          runId: run.id,
          runSummary: run.summary,
          knowledge: {
            sourceIds: selectedKnowledgeSourceIds,
            retrievedChunks: retrieved.matches.map((chunk) => ({
              sourceId: chunk.sourceId,
              objectName: chunk.objectName,
              chunkIndex: chunk.chunkIndex,
              score: chunk.score
            }))
          },
          evaluation
        });
      } catch (error) {
        suiteRun.caseRuns.push({
          caseId: testCase.id,
          title: testCase.title,
          agentId: agent.id,
          status: "failed",
          error: error.message,
          evaluation: { status: "failed", score: 0, checks: [] }
        });
      }
    }
    suiteRun.updatedAt = new Date().toISOString();
    suiteRun.summary = summarizeSuiteRun(suiteRun.caseRuns);
    suiteRun.summary.total = suite.cases.length;
    suiteRun.summary.completed = suiteRun.caseRuns.length;
    suiteRun.status = "running";
    await suiteRunStore.save(suiteRun);
  }

  suiteRun.status = summarizeSuiteRun(suiteRun.caseRuns).status;
  suiteRun.completedAt = new Date().toISOString();
  suiteRun.updatedAt = suiteRun.completedAt;
  suiteRun.currentCase = null;
  suiteRun.summary = summarizeSuiteRun(suiteRun.caseRuns);
  suiteRun.summary.completed = suiteRun.caseRuns.length;
  suiteRun.sheetExport = { status: "exporting", startedAt: suiteRun.completedAt };
  await suiteRunStore.save(suiteRun);
  await suiteStore.save({ ...suite, lastRunAt: suiteRun.completedAt, updatedAt: suiteRun.completedAt });
  suiteRun.sheetExport = await autoExportSuiteRun(suiteRun);
  suiteRun.updatedAt = new Date().toISOString();
  await suiteRunStore.save(suiteRun);
  return suiteRun;
}

async function startSuiteRun(suite) {
  const suiteRun = await createSuiteRun(suite);
  setImmediate(() => {
    processSuiteRun(suite, suiteRun).catch(async (error) => {
      const now = new Date().toISOString();
      suiteRun.status = "failed";
      suiteRun.fatalError = error.message;
      suiteRun.currentCase = null;
      suiteRun.completedAt = now;
      suiteRun.updatedAt = now;
      suiteRun.sheetExport = {
        status: "skipped",
        message: "実行処理が中断されたため、Google Sheetsへ出力していません。"
      };
      await suiteRunStore.save(suiteRun);
      console.error(`[suite-run] ${suiteRun.id} ${error.stack || error.message}`);
    });
  });
  return suiteRun;
}

async function seedData() {
  const agents = await agentStore.list();
  if (!agents.length && validateAgentResource(config.agent)) {
    const parsed = parseAgentResource(config.agent);
    await agentStore.save({
      schemaVersion: 1,
      id: "agent_tpcds_retail",
      displayName: config.agentLabel,
      description: "TPC-DS小売データを使った実業務向け検証用Data Agent",
      resourceName: config.agent,
      projectId: parsed.projectId,
      location: parsed.location,
      remoteId: parsed.remoteId,
      status: "ready",
      lastCheckedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  const suites = await suiteStore.list();
  if (!suites.length && validateAgentResource(config.agent)) {
    await suiteStore.save(
      normalizeSuite({
        name: "TPC-DS 実業務リグレッション",
        description: "可視化、異常検知、集計の代表的な業務質問をまとめて評価します。",
        cases: [
          {
            title: "州別顧客数 Top 10",
            prompt: "Show the top 10 states by number of customers as a bar chart.",
            agentId: "agent_tpcds_retail",
            expectations: { requireSql: true, requireChart: true, maxDurationMs: 120000 }
          },
          {
            title: "返品率の外れ値",
            prompt:
              "Find customers who have returned items more than 20% more often than the average customer returns for a store in Tennessee for the year 2000.",
            agentId: "agent_tpcds_retail",
            expectations: { requireSql: true, maxDurationMs: 180000 }
          },
          {
            title: "メーカー別販売価格",
            prompt: "Report the average extended sales price per item brand of manufacturer 128 for all sales in November.",
            agentId: "agent_tpcds_retail",
            expectations: { requireSql: true, maxDurationMs: 120000 }
          }
        ]
      })
    );
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && staticFiles[url.pathname]) {
      const [file, contentType] = staticFiles[url.pathname];
      response.writeHead(200, { ...securityHeaders(contentType), "Cache-Control": "no-store" });
      response.end(await readFile(path.join(publicDirectory, file)));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/config") {
      sendJson(response, 200, config);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/storage/config") {
      const stats = await storageStats();
      sendJson(response, 200, publicStorageConfig(storageConfig, primaryStorage.backend, stats));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/storage/test") {
      const body = await readJson(request);
      try {
        const candidateConfig = requestedStorageConfig(body);
        const candidate = backendFromConfig(candidateConfig);
        const details = await candidate.validate();
        sendJson(response, 200, {
          ok: true,
          message: "プライマリーストレージへ接続できました。",
          identity: details.authSource || (candidate.provider === "local" ? "local-process" : null),
          details
        });
      } catch (error) {
        sendJson(response, 200, {
          ok: false,
          message: error.message,
          details: { driver: body.driver || body.provider || "gcs" }
        });
      }
      return;
    }
    if (request.method === "PUT" && url.pathname === "/api/storage/config") {
      const body = await readJson(request);
      if (body.revision != null && Number(body.revision) !== Number(storageConfig.revision || 1)) {
        const error = new Error("ストレージ設定が別のユーザーによって更新されています。再読み込みしてください。");
        error.status = 409;
        throw error;
      }
      const candidateConfig = requestedStorageConfig(body);
      const candidate = backendFromConfig(candidateConfig);
      await candidate.validate();
      const now = new Date().toISOString();
      const nextConfig = {
        schemaVersion: 1,
        ...candidateConfig,
        revision: Number(storageConfig.revision || 1) + 1,
        lastSyncedAt: storageConfig.lastSyncedAt || null,
        updatedAt: now
      };
      await saveStorageConfig(nextConfig);
      primaryStorage.use(candidate);
      storageConfig = nextConfig;
      const stats = await storageStats(candidate);
      sendJson(response, 200, publicStorageConfig(storageConfig, candidate, stats));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/storage/migrate") {
      const body = await readJson(request);
      const mode = body.mode === "sync" ? "sync" : "copy_and_switch";
      const targetConfig = requestedStorageConfig(body.targetConfig || {});
      const destination = backendFromConfig(targetConfig);
      const validation = await destination.validate();
      const preview = await migrateStorage({
        source: primaryStorage.backend,
        destination,
        namespaces: storageNamespaces,
        dryRun: true
      });
      if (preview.conflicts) {
        const error = new Error(
          `移行先に内容が異なる同一IDのデータが${preview.conflicts}件あります。切替は行いませんでした。`
        );
        error.status = 409;
        error.details = preview;
        throw error;
      }
      const migration = await migrateStorage({
        source: primaryStorage.backend,
        destination,
        namespaces: storageNamespaces,
        dryRun: false
      });
      const completedAt = new Date().toISOString();
      let responseConfig = publicStorageConfig(storageConfig, primaryStorage.backend);
      if (mode === "copy_and_switch") {
        const nextConfig = {
          schemaVersion: Number(SHEET_SCHEMA_VERSION),
          ...targetConfig,
          revision: Number(storageConfig.revision || 1) + 1,
          lastSyncedAt: completedAt,
          updatedAt: completedAt
        };
        await saveStorageConfig(nextConfig);
        primaryStorage.use(destination);
        storageConfig = nextConfig;
        responseConfig = publicStorageConfig(nextConfig, destination);
      } else {
        storageConfig = {
          ...storageConfig,
          lastSyncedAt: completedAt,
          revision: Number(storageConfig.revision || 1) + 1,
          updatedAt: completedAt
        };
        await saveStorageConfig(storageConfig);
        responseConfig = publicStorageConfig(storageConfig, primaryStorage.backend);
      }
      sendJson(response, 200, {
        ok: true,
        message:
          mode === "copy_and_switch"
            ? "データをコピーし、プライマリーストレージを切り替えました。"
            : "プライマリーストレージから移行先へデータを同期しました。",
        config: responseConfig,
        target: { ...targetConfig, validation },
        migration: {
          copiedFiles: migration.copied,
          copiedBytes: migration.copiedBytes,
          unchangedFiles: migration.unchanged,
          completedAt,
          namespaces: migration.namespaces
        }
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/test-cases") {
      sendJson(
        response,
        200,
        JSON.parse(await readFile(path.join(__dirname, "fixtures", "test-cases.json"), "utf8"))
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/runs") {
      sendJson(response, 200, {
        runs: await runStore.list()
      });
      return;
    }
    const runMatch = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)$/);
    if (request.method === "GET" && runMatch) {
      sendJson(response, 200, await runDetailView(await runStore.get(runMatch[1])));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/runs") {
      sendJson(response, 201, await executeRun(await readJson(request)));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agents") {
      sendJson(response, 200, { agents: await agentStore.list() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/knowledge-sources") {
      sendJson(response, 200, { sources: await knowledgeSourceStore.list() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/gcs/buckets") {
      sendJson(
        response,
        200,
        await listGcsBuckets({
          projectId: url.searchParams.get("projectId"),
          maxBuckets: 500
        })
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/knowledge-sources/batch") {
      const result = await createKnowledgeSources(await readJson(request), { batch: true });
      sendJson(response, result.sources.length ? 201 : 200, result);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/knowledge-sources") {
      const result = await createKnowledgeSources(await readJson(request));
      sendJson(response, 201, result.sources[0]);
      return;
    }
    const knowledgeDetailMatch = url.pathname.match(
      /^\/api\/knowledge-sources\/([a-zA-Z0-9_-]+)$/
    );
    if (request.method === "GET" && knowledgeDetailMatch) {
      const source = await knowledgeSourceStore.get(knowledgeDetailMatch[1]);
      const listing = await listGcsObjects({ bucket: source.bucket, prefix: source.prefix, maxObjects: 200 });
      let index = null;
      try {
        const storedIndex = await knowledgeIndexStore.get(source.id);
        index = { ...storedIndex, chunks: undefined };
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      sendJson(response, 200, {
        source,
        objects: listing.items,
        truncated: listing.truncated,
        authSource: listing.authSource,
        index
      });
      return;
    }
    const knowledgeSyncMatch = url.pathname.match(
      /^\/api\/knowledge-sources\/([a-zA-Z0-9_-]+)\/sync$/
    );
    if (request.method === "POST" && knowledgeSyncMatch) {
      sendJson(response, 200, await syncKnowledgeSource(await knowledgeSourceStore.get(knowledgeSyncMatch[1])));
      return;
    }
    const knowledgeUploadMatch = url.pathname.match(
      /^\/api\/knowledge-sources\/([a-zA-Z0-9_-]+)\/upload$/
    );
    if (request.method === "POST" && knowledgeUploadMatch) {
      const source = await knowledgeSourceStore.get(knowledgeUploadMatch[1]);
      const body = await readJson(request);
      const fileName = String(body.fileName || "").replaceAll("\\", "/").split("/").pop();
      if (!fileName || fileName.includes("..") || fileName.length > 240) {
        throw new Error("ファイル名の形式が正しくありません。");
      }
      const bytes = Buffer.from(String(body.contentBase64 || ""), "base64");
      if (!bytes.length || bytes.length > 4 * 1024 * 1024) {
        throw new Error("アップロードは1ファイル4MB以下にしてください。");
      }
      const uploaded = await uploadGcsObject({
        bucket: source.bucket,
        objectName: `${source.prefix}${fileName}`,
        contentType: String(body.contentType || "application/octet-stream"),
        bytes
      });
      sendJson(response, 201, uploaded);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/knowledge/search") {
      const body = await readJson(request);
      sendJson(
        response,
        200,
        await retrieveKnowledge(String(body.query || ""), body.sourceIds, Number(body.limit || 6))
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/knowledge/plan") {
      const body = await readJson(request);
      const goal = String(body.goal || "").trim();
      if (goal.length < 5) throw new Error("プランニング目的を5文字以上で入力してください。");
      const retrieved = await retrieveKnowledge(goal, body.sourceIds, 8);
      if (!retrieved.context) {
        throw new Error("同期済みGCSナレッジから関連チャンクを取得できませんでした。");
      }
      const sources = (await knowledgeSourceStore.list())
        .filter((source) => (body.sourceIds || []).includes(source.id))
        .map(({ id, name, description, bucket, prefix }) => ({ id, name, description, bucket, prefix }));
      const plan = await generateAgentPlan({
        project: config.vertexProject,
        location: config.vertexLocation,
        model: config.vertexModel,
        goal,
        knowledgeContext: retrieved.context,
        sources
      });
      sendJson(response, 200, {
        plan,
        retrieved: retrieved.matches.map(({ text, ...metadata }) => metadata)
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/agents") {
      const body = await readJson(request);
      const resourceName = String(body.resourceName || "").trim();
      const parsed = parseAgentResource(resourceName);
      if (!parsed) throw new Error("Data Agent resource nameの形式が正しくありません。");
      const now = new Date().toISOString();
      const agent = await agentStore.save({
        schemaVersion: 1,
        id: objectId("agent"),
        displayName: String(body.displayName || parsed.remoteId).trim().slice(0, 120),
        description: String(body.description || "").trim().slice(0, 1000),
        resourceName,
        ...parsed,
        status: "unchecked",
        lastCheckedAt: null,
        createdAt: now,
        updatedAt: now
      });
      syncReadySheetCatalogs().catch((error) => console.error(`[sheets-catalog] ${error.message}`));
      sendJson(response, 201, agent);
      return;
    }
    const agentCheckMatch = url.pathname.match(/^\/api\/agents\/([a-zA-Z0-9_-]+)\/check$/);
    if (request.method === "POST" && agentCheckMatch) {
      const agent = await agentStore.get(agentCheckMatch[1]);
      const remote = await getDataAgent({ resourceName: agent.resourceName, billingProject: config.billingProject });
      const updated = await agentStore.save({
        ...agent,
        displayName: remote.agent.displayName || agent.displayName,
        description: remote.agent.description || agent.description,
        status: "ready",
        authSource: remote.authSource,
        lastCheckedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      syncReadySheetCatalogs().catch((error) => console.error(`[sheets-catalog] ${error.message}`));
      sendJson(response, 200, updated);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sheets/connections") {
      sendJson(response, 200, {
        connections: (await sheetConnectionStore.list()).map(sheetConnectionProjection),
        format: {
          suiteTab: SUITE_SHEET,
          reportTab: REPORT_SHEET,
          agentsTab: AGENTS_SHEET,
          suitesTab: SUITES_SHEET,
          schemaVersion: 2,
          maxCases: 50
        }
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/sheets/connections") {
      const body = await readJson(request);
      const spreadsheetId = parseSpreadsheetId(body.spreadsheetUrl || body.spreadsheetId);
      const duplicate = (await sheetConnectionStore.list()).find(
        (connection) => connection.spreadsheetId === spreadsheetId
      );
      const connection = await connectAndBootstrapSheet({
        spreadsheetId,
        suiteId: body.suiteId,
        existing: duplicate || null,
        forceOperational: Boolean(body.forceOperational || body.forceSamples)
      });
      sendJson(response, duplicate ? 200 : 201, sheetConnectionProjection(connection));
      return;
    }
    const sheetCheckMatch = url.pathname.match(
      /^\/api\/sheets\/connections\/([a-zA-Z0-9_-]+)\/check$/
    );
    if (request.method === "POST" && sheetCheckMatch) {
      const body = await readJson(request).catch(() => ({}));
      sendJson(
        response,
        200,
        sheetConnectionProjection(
          await refreshSheetConnection(await sheetConnectionStore.get(sheetCheckMatch[1]), {
            suiteId: body?.suiteId,
            forceOperational: Boolean(body?.forceOperational || body?.forceSamples)
          })
        )
      );
      return;
    }
    const sheetExportSuiteMatch = url.pathname.match(
      /^\/api\/sheets\/connections\/([a-zA-Z0-9_-]+)\/export-suite$/
    );
    if (request.method === "POST" && sheetExportSuiteMatch) {
      const connection = await sheetConnectionStore.get(sheetExportSuiteMatch[1]);
      const body = await readJson(request);
      const suite = await suiteStore.get(String(body.suiteId || ""));
      const agents = await agentStore.list();
      const prepared = prepareSuiteForSheetExport(suite, agents);
      const result = await writeSuiteSheet(connection.spreadsheetId, prepared, { agents });
      await writeCatalogSheets(connection.spreadsheetId, {
        agents,
        suites: await suiteStore.list()
      });
      const now = new Date().toISOString();
      const updated = await sheetConnectionStore.save({
        ...connection,
        title: result.spreadsheet.title,
        spreadsheetUrl: result.spreadsheet.spreadsheetUrl,
        authSource: result.spreadsheet.authSource,
        status: "ready",
        lastCheckedAt: now,
        lastExportedAt: now,
        lastOperation: `suite-export:${suite.id}`,
        updatedAt: now
      });
      sendJson(response, 200, {
        connection: sheetConnectionProjection(updated),
        tabName: result.sheetTitle,
        rowCount: result.rowCount,
        suiteId: suite.id
      });
      return;
    }
    const sheetImportSuiteMatch = url.pathname.match(
      /^\/api\/sheets\/connections\/([a-zA-Z0-9_-]+)\/import-suite$/
    );
    if (request.method === "POST" && sheetImportSuiteMatch) {
      const connection = await sheetConnectionStore.get(sheetImportSuiteMatch[1]);
      const imported = await readSuiteSheet(connection.spreadsheetId);
      const references = await validateSuiteReferences(imported.suite);
      const existing = await findLocalSuite(references.suite.sourceSuiteId || imported.suite.sourceSuiteId);
      const suite = await suiteStore.save(normalizeSuite(references.suite, existing || {}));
      await writeCatalogSheets(connection.spreadsheetId, {
        agents: await agentStore.list(),
        suites: await suiteStore.list()
      });
      const now = new Date().toISOString();
      const updated = await sheetConnectionStore.save({
        ...connection,
        authSource: imported.authSource,
        status: "ready",
        lastCheckedAt: now,
        lastImportedAt: now,
        lastOperation: `suite-import:${suite.id}`,
        updatedAt: now
      });
      sendJson(response, existing ? 200 : 201, {
        connection: sheetConnectionProjection(updated),
        suite,
        mode: existing ? "updated" : "created"
      });
      return;
    }
    const sheetExportReportMatch = url.pathname.match(
      /^\/api\/sheets\/connections\/([a-zA-Z0-9_-]+)\/export-report$/
    );
    if (request.method === "POST" && sheetExportReportMatch) {
      const connection = await sheetConnectionStore.get(sheetExportReportMatch[1]);
      const body = await readJson(request);
      const report = await correctedSuiteRunView(
        await suiteRunStore.get(String(body.suiteRunId || ""))
      );
      const result = await writeReportSheet(connection.spreadsheetId, report);
      await writeCatalogSheets(connection.spreadsheetId, {
        agents: await agentStore.list(),
        suites: await suiteStore.list()
      });
      const now = new Date().toISOString();
      const updated = await sheetConnectionStore.save({
        ...connection,
        title: result.spreadsheet.title,
        spreadsheetUrl: result.spreadsheet.spreadsheetUrl,
        authSource: result.spreadsheet.authSource,
        status: "ready",
        lastCheckedAt: now,
        lastExportedAt: now,
        lastOperation: `report-export:${report.id}`,
        updatedAt: now
      });
      sendJson(response, 200, {
        connection: sheetConnectionProjection(updated),
        tabName: result.sheetTitle,
        rowCount: result.rowCount,
        suiteRunId: report.id
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/suites/import-paste") {
      const body = await readJson(request);
      const targetSuiteId = String(body.targetSuiteId || "").trim();
      const targetSuite = targetSuiteId ? await findLocalSuite(targetSuiteId) : null;
      if (targetSuiteId && !targetSuite) {
        throw new Error("更新対象のテストスイートが見つかりません。");
      }
      const preferTargetSuite = Boolean(body.preferTargetSuite);
      if (preferTargetSuite && !targetSuite) {
        throw new Error("編集中のテストスイートが見つかりません。");
      }
      const imported = pastedTextToSuiteInput(body.text, {
        targetSuite,
        preferTargetSuite,
        includeSuiteMetadata: body.includeSuiteMetadata !== false
      });
      const existingId =
        imported.format === "full" ? imported.suite.sourceSuiteId : targetSuite?.id;
      const existing = await findLocalSuite(existingId);
      if (!existing) {
        throw new Error("貼り付け内容に対応する既存テストスイートが見つかりません。");
      }
      const suiteInput = normalizeSuite(imported.suite, existing);
      const references = await validateSuiteReferences(suiteInput);
      const suite = normalizeSuite(references.suite, existing);
      const validation = {
        format: imported.format,
        delimiter: imported.delimiter,
        caseCount: suite.cases.length,
        diff: suiteCaseDiff(existing.cases, suite.cases),
        preview: suite.cases.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.title,
          prompt: item.prompt,
          agentId: item.agentId
        })),
        agentCount: references.agentCount,
        knowledgeSourceCount: references.knowledgeSourceCount
      };
      if (body.validateOnly === true) {
        sendJson(response, 200, { suite, mode: "validated", validation });
        return;
      }
      await suiteStore.save(suite);
      sendJson(response, 200, {
        suite,
        mode: "updated",
        validation
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/suites") {
      sendJson(response, 200, { suites: await suiteStore.list() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/suites") {
      const suite = await suiteStore.save(normalizeSuite(await readJson(request)));
      syncReadySheetCatalogs().catch((error) => console.error(`[sheets-catalog] ${error.message}`));
      sendJson(response, 201, suite);
      return;
    }
    const suiteMatch = url.pathname.match(/^\/api\/suites\/([a-zA-Z0-9_-]+)$/);
    if (request.method === "GET" && suiteMatch) {
      sendJson(response, 200, await suiteStore.get(suiteMatch[1]));
      return;
    }
    if ((request.method === "PATCH" || request.method === "PUT") && suiteMatch) {
      const existing = await suiteStore.get(suiteMatch[1]);
      const suite = await suiteStore.save(normalizeSuite(await readJson(request), existing));
      syncReadySheetCatalogs().catch((error) => console.error(`[sheets-catalog] ${error.message}`));
      sendJson(response, 200, suite);
      return;
    }
    if (request.method === "DELETE" && suiteMatch) {
      const suite = await suiteStore.get(suiteMatch[1]);
      const activeRun = (await suiteRunStore.list()).find(
        (run) => run.suiteId === suite.id && run.status === "running"
      );
      if (activeRun) {
        const error = new Error("実行中のスイートは削除できません。完了してから削除してください。");
        error.status = 409;
        throw error;
      }
      await suiteStore.delete(suite.id);
      syncReadySheetCatalogs().catch((error) => console.error(`[sheets-catalog] ${error.message}`));
      sendJson(response, 200, { deleted: true, id: suite.id, name: suite.name });
      return;
    }
    const suiteRunMatch = url.pathname.match(/^\/api\/suites\/([a-zA-Z0-9_-]+)\/run$/);
    if (request.method === "POST" && suiteRunMatch) {
      sendJson(response, 202, slimSuiteRun(await startSuiteRun(await suiteStore.get(suiteRunMatch[1]))));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/suite-runs") {
      const suiteRuns = await Promise.all(
        (await suiteRunStore.list()).map((run) => correctedSuiteRunView(run))
      );
      sendJson(response, 200, {
        suiteRuns: suiteRuns.map(suiteRunProjection)
      });
      return;
    }
    const reportMatch = url.pathname.match(/^\/api\/suite-runs\/([a-zA-Z0-9_-]+)$/);
    if (request.method === "GET" && reportMatch) {
      sendJson(
        response,
        200,
        slimSuiteRun(await correctedSuiteRunView(await suiteRunStore.get(reportMatch[1])))
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/assistant") {
      const body = await readJson(request);
      const latestMessage = Array.isArray(body.messages)
        ? body.messages.filter((message) => message.role !== "assistant").at(-1)?.text || ""
        : "";
      const sourceIds = [
        ...(body.suite?.knowledgeSourceIds || []),
        ...(body.suite?.cases || []).flatMap((item) => item.knowledgeSourceIds || [])
      ];
      const retrieved = await retrieveKnowledge(latestMessage, sourceIds, 6);
      const reply = await generateSuiteAssistantReply({
        project: config.vertexProject,
        location: config.vertexLocation,
        model: config.vertexModel,
        suite: body.suite,
        agents: await agentStore.list(),
        messages: Array.isArray(body.messages) ? body.messages : [],
        knowledgeContext: retrieved.context
      });
      reply.retrieved = retrieved.matches.map(({ text, ...metadata }) => metadata);
      if (body.applyPatch && reply.patch) {
        const suite = await suiteStore.get(String(body.suite?.id || ""));
        reply.updatedSuite = await suiteStore.save(mergeAssistantPatch(suite, reply.patch));
      }
      sendJson(response, 200, reply);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    const status = error?.status || (error?.code === "ENOENT" ? 404 : 500);
    sendJson(response, status, {
      error: error.message || "Unexpected error",
      ...(error.details ? { details: error.details } : {})
    });
  }
});

await Promise.all([
  runStore.ensure(),
  agentStore.ensure(),
  suiteStore.ensure(),
  suiteRunStore.ensure(),
  sheetConnectionStore.ensure(),
  knowledgeSourceStore.ensure(),
  knowledgeIndexStore.ensure()
]);
await seedData();
server.listen(port, host, () => {
  console.log(`PrismTrail is running at http://${host}:${port}`);
  console.log(`Agent: ${config.agent}`);
});
