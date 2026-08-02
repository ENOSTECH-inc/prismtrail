const objectSchema = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false
});

const stringId = { type: "string", pattern: "^[a-zA-Z0-9_-]+$" };
const relatedUrlsSchema = {
  type: "array",
  description: "HTTP(S) provenance links for the case, such as Slack messages, tickets, or source documents.",
  items: { type: "string", format: "uri", maxLength: 2048 },
  maxItems: 20
};
const accuracySourceSchema = objectSchema({
  id: stringId,
  type: { enum: ["text", "url", "bigquery_sql"] },
  description: { type: "string", maxLength: 500 },
  content: { type: "string", maxLength: 20000 }
}, ["type", "content"]);
const expectationsSchema = objectSchema({
  systemRequirements: { type: "object" },
  businessRequirements: objectSchema({
    enabled: { type: "boolean" },
    criteriaItems: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 20 },
    passingGrade: { enum: ["A", "B", "C", "D"] }
  }),
  accuracyValidation: objectSchema({
    enabled: { type: "boolean" },
    sources: { type: "array", items: accuracySourceSchema, maxItems: 20 }
  })
});
const testCaseSchema = {
  type: "object",
  properties: {
    id: stringId,
    title: { type: "string", maxLength: 160 },
    prompt: { type: "string", maxLength: 5000 },
    agentId: { type: "string" },
    knowledgeSourceIds: { type: "array", items: stringId, maxItems: 20 },
    thinkingMode: { enum: ["FAST", "THINKING"] },
    status: { enum: ["active", "draft"] },
    relatedUrls: relatedUrlsSchema,
    memo: { type: "string", maxLength: 20000 },
    expectations: expectationsSchema
  },
  additionalProperties: true
};
const suiteSchema = {
  type: "object",
  properties: {
    name: { type: "string", maxLength: 120 },
    description: { type: "string", maxLength: 2000 },
    status: { enum: ["active", "draft"] },
    defaultAgentId: { type: "string" },
    knowledgeSourceIds: { type: "array", items: stringId, maxItems: 20 },
    cases: { type: "array", items: testCaseSchema, maxItems: 120 }
  },
  additionalProperties: true
};

export function createPrismTrailMcpTools(operations) {
  return [
    {
      name: "list_suites", scope: "suites:read",
      description: "List test suites with lightweight test-case summaries.",
      inputSchema: objectSchema({ limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } }),
      handler: (args) => operations.listSuites(args)
    },
    {
      name: "get_suite", scope: "suites:read", description: "Get a complete test suite definition.",
      inputSchema: objectSchema({ suiteId: stringId }, ["suiteId"]),
      handler: ({ suiteId }) => operations.getSuite(suiteId)
    },
    {
      name: "list_test_cases", scope: "suites:read", description: "List test cases, optionally restricted to one suite.",
      inputSchema: objectSchema({ suiteId: stringId, limit: { type: "integer", minimum: 1, maximum: 200 }, cursor: { type: "integer", minimum: 0 } }),
      handler: (args) => operations.listTestCases(args)
    },
    {
      name: "get_test_case", scope: "suites:read", description: "Get one test case from a suite.",
      inputSchema: objectSchema({ suiteId: stringId, caseId: stringId }, ["suiteId", "caseId"]),
      handler: ({ suiteId, caseId }) => operations.getTestCase(suiteId, caseId)
    },
    {
      name: "create_suite", scope: "suites:write", description: "Create a test suite. Delete operations are not supported.",
      inputSchema: objectSchema({ suite: suiteSchema }, ["suite"]),
      handler: ({ suite }, context) => operations.createSuite(suite, context)
    },
    {
      name: "update_suite", scope: "suites:write", description: "Update a suite using optimistic concurrency.",
      inputSchema: objectSchema({ suiteId: stringId, expectedUpdatedAt: { type: "string" }, patch: suiteSchema }, ["suiteId", "expectedUpdatedAt", "patch"]),
      handler: (args, context) => operations.updateSuite(args, context)
    },
    {
      name: "create_test_case", scope: "suites:write", description: "Add a new test case. businessRequirements defines acceptance conditions; accuracyValidation.sources defines text, URL, or read-only BigQuery SQL ground truth. relatedUrls is provenance only.",
      inputSchema: objectSchema({ suiteId: stringId, expectedUpdatedAt: { type: "string" }, testCase: testCaseSchema }, ["suiteId", "expectedUpdatedAt", "testCase"]),
      handler: (args, context) => operations.createTestCase(args, context)
    },
    {
      name: "update_test_case", scope: "suites:write", description: "Update one test case without deleting others. Accuracy sources support text, safe public URL retrieval, and cost-capped read-only BigQuery SQL. relatedUrls remains provenance only.",
      inputSchema: objectSchema({ suiteId: stringId, caseId: stringId, expectedUpdatedAt: { type: "string" }, patch: testCaseSchema }, ["suiteId", "caseId", "expectedUpdatedAt", "patch"]),
      handler: (args, context) => operations.updateTestCase(args, context)
    },
    {
      name: "list_suite_versions", scope: "suites:read", description: "List immutable edit-history versions for a suite.",
      inputSchema: objectSchema({ suiteId: stringId }, ["suiteId"]), handler: ({ suiteId }) => operations.listSuiteVersions(suiteId)
    },
    {
      name: "get_suite_version", scope: "suites:read", description: "Get one historical suite snapshot.",
      inputSchema: objectSchema({ suiteId: stringId, versionId: stringId }, ["suiteId", "versionId"]), handler: ({ suiteId, versionId }) => operations.getSuiteVersion(suiteId, versionId)
    },
    {
      name: "restore_suite_version", scope: "suites:write", description: "Restore a historical suite snapshot using optimistic concurrency.",
      inputSchema: objectSchema({ suiteId: stringId, versionId: stringId, expectedUpdatedAt: { type: "string" } }, ["suiteId", "versionId", "expectedUpdatedAt"]), handler: (args, context) => operations.restoreSuiteVersion(args, context)
    },
    {
      name: "import_pasted_test_cases", scope: "suites:write", description: "Validate or apply TSV/CSV test-case rows copied from a managed sheet.",
      inputSchema: objectSchema({ targetSuiteId: stringId, text: { type: "string" }, validateOnly: { type: "boolean" }, includeSuiteMetadata: { type: "boolean" } }, ["targetSuiteId", "text"]), handler: (args, context) => operations.importPastedTestCases(args, context)
    },
    {
      name: "list_agents", scope: "agents:read", description: "List registered BigQuery Data Agents.",
      inputSchema: objectSchema(), handler: () => operations.listAgents()
    },
    {
      name: "register_agent", scope: "agents:write", description: "Register an existing BigQuery Data Agent resource.",
      inputSchema: objectSchema({ resourceName: { type: "string" }, displayName: { type: "string" }, description: { type: "string" } }, ["resourceName"]),
      handler: (args) => operations.registerAgent(args)
    },
    {
      name: "check_agent_connection", scope: "agents:write", description: "Verify a registered Data Agent through ADC and refresh its metadata.",
      inputSchema: objectSchema({ agentId: stringId }, ["agentId"]), handler: ({ agentId }) => operations.checkAgent(agentId)
    },
    {
      name: "list_runs", scope: "runs:read", description: "List single-prompt and suite case execution records.",
      inputSchema: objectSchema({ limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } }), handler: (args) => operations.listRuns(args)
    },
    {
      name: "get_run_evidence", scope: "runs:read", description: "Get normalized events, jobs, and evidence for one execution.",
      inputSchema: objectSchema({ runId: stringId }, ["runId"]), handler: ({ runId }) => operations.getRun(runId)
    },
    {
      name: "run_single_prompt", scope: "runs:execute", description: "Start an asynchronous single-prompt execution using a registered agent.",
      inputSchema: objectSchema({ agentId: stringId, question: { type: "string" }, thinkingMode: { type: "string" } }, ["agentId", "question"]), handler: (args) => operations.runSinglePrompt(args)
    },
    {
      name: "run_suite", scope: "runs:execute", description: "Start an asynchronous full or partial suite evaluation.",
      inputSchema: objectSchema({ suiteId: stringId, caseIds: { type: "array", items: stringId, maxItems: 120 } }, ["suiteId"]),
      handler: ({ suiteId, caseIds }) => operations.runSuite(suiteId, caseIds)
    },
    {
      name: "list_evaluation_reports", scope: "runs:read", description: "List evaluation reports and current execution status.",
      inputSchema: objectSchema({ limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "integer", minimum: 0 } }),
      handler: (args) => operations.listReports(args)
    },
    {
      name: "get_evaluation_report", scope: "reports:read", description: "Get a complete evaluation report for polling or analysis.",
      inputSchema: objectSchema({ reportId: stringId }, ["reportId"]),
      handler: ({ reportId }) => operations.getReport(reportId)
    },
    {
      name: "download_evaluation_report_pdf", scope: "reports:read", description: "Download a completed evaluation report as an embedded PDF resource.",
      inputSchema: objectSchema({ reportId: stringId, caseId: stringId }, ["reportId"]),
      handler: (args) => operations.downloadReportPdf(args)
    },
    {
      name: "download_case_spec_pdf", scope: "reports:read", description: "Download one or all test-case specifications as an embedded PDF resource.",
      inputSchema: objectSchema({ suiteId: stringId, caseId: stringId }, ["suiteId"]), handler: (args) => operations.downloadCaseSpecPdf(args)
    },
    {
      name: "list_gcs_buckets", scope: "knowledge:read", description: "List ADC-accessible GCS buckets for a project.",
      inputSchema: objectSchema({ projectId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 } }, ["projectId"]), handler: (args) => operations.listGcsBuckets(args)
    },
    {
      name: "list_knowledge_sources", scope: "knowledge:read", description: "List registered GCS knowledge sources.",
      inputSchema: objectSchema(), handler: () => operations.listKnowledgeSources()
    },
    {
      name: "get_knowledge_source", scope: "knowledge:read", description: "Get a knowledge source, live object listing, and index metadata.",
      inputSchema: objectSchema({ sourceId: stringId }, ["sourceId"]), handler: ({ sourceId }) => operations.getKnowledgeSource(sourceId)
    },
    {
      name: "search_knowledge", scope: "knowledge:read", description: "Search synchronized knowledge chunks.",
      inputSchema: objectSchema({ query: { type: "string" }, sourceIds: { type: "array", items: stringId, maxItems: 20 }, limit: { type: "integer", minimum: 1, maximum: 20 } }, ["query", "sourceIds"]), handler: (args) => operations.searchKnowledge(args)
    },
    {
      name: "register_knowledge_sources", scope: "knowledge:write", description: "Register one or more GCS bucket/prefix knowledge sources.",
      inputSchema: objectSchema({ projectId: { type: "string" }, buckets: { type: "array", items: { type: "string" }, maxItems: 20 }, prefix: { type: "string" }, name: { type: "string" }, description: { type: "string" } }, ["projectId", "buckets"]), handler: (args) => operations.registerKnowledgeSources(args)
    },
    {
      name: "sync_knowledge_source", scope: "knowledge:write", description: "Read a registered GCS source and rebuild its local search index.",
      inputSchema: objectSchema({ sourceId: stringId }, ["sourceId"]), handler: ({ sourceId }) => operations.syncKnowledgeSource(sourceId)
    },
    {
      name: "upload_knowledge_file", scope: "knowledge:write", description: "Upload a base64 file to a registered GCS knowledge source. Maximum request size is 1 MiB.",
      inputSchema: objectSchema({ sourceId: stringId, fileName: { type: "string" }, contentType: { type: "string" }, contentBase64: { type: "string" } }, ["sourceId", "fileName", "contentBase64"]), handler: (args) => operations.uploadKnowledgeFile(args)
    },
    {
      name: "generate_knowledge_plan", scope: "knowledge:read", description: "Generate an implementation plan grounded in synchronized knowledge.",
      inputSchema: objectSchema({ goal: { type: "string" }, sourceIds: { type: "array", items: stringId, maxItems: 20 } }, ["goal", "sourceIds"]), handler: (args) => operations.generateKnowledgePlan(args)
    },
    {
      name: "list_sheet_connections", scope: "sheets:read", description: "List managed Google Sheets connections.",
      inputSchema: objectSchema(), handler: () => operations.listSheetConnections()
    },
    {
      name: "connect_google_sheet", scope: "sheets:write", description: "Connect and bootstrap managed tabs in a Google Sheet.",
      inputSchema: objectSchema({ spreadsheetUrl: { type: "string" }, suiteId: stringId, forceOperational: { type: "boolean" } }, ["spreadsheetUrl"]), handler: (args) => operations.connectSheet(args)
    },
    {
      name: "check_sheet_connection", scope: "sheets:write", description: "Verify and refresh a Google Sheets connection.",
      inputSchema: objectSchema({ connectionId: stringId, suiteId: stringId }, ["connectionId"]), handler: (args) => operations.checkSheet(args)
    },
    {
      name: "export_suite_to_sheet", scope: "sheets:write", description: "Export a suite and refresh managed catalog tabs.",
      inputSchema: objectSchema({ connectionId: stringId, suiteId: stringId }, ["connectionId", "suiteId"]), handler: (args) => operations.exportSuiteToSheet(args)
    },
    {
      name: "import_suite_from_sheet", scope: "sheets:write", description: "Import and validate a managed suite tab into PrismTrail.",
      inputSchema: objectSchema({ connectionId: stringId }, ["connectionId"]), handler: (args, context) => operations.importSuiteFromSheet(args, context)
    },
    {
      name: "export_report_to_sheet", scope: "sheets:write", description: "Export an evaluation report to the managed report tab.",
      inputSchema: objectSchema({ connectionId: stringId, reportId: stringId }, ["connectionId", "reportId"]), handler: (args) => operations.exportReportToSheet(args)
    },
    {
      name: "edit_suite_with_ai", scope: "assistant:write", description: "Generate an AI suite patch and optionally apply it with optimistic concurrency.",
      inputSchema: objectSchema({ suiteId: stringId, messages: { type: "array", items: { type: "object" }, maxItems: 50 }, applyPatch: { type: "boolean" }, expectedUpdatedAt: { type: "string" } }, ["suiteId", "messages"]), handler: (args, context) => operations.editSuiteWithAi(args, context)
    },
    {
      name: "get_storage_config", scope: "storage:read", description: "Get the active primary-storage configuration and non-sensitive summary.",
      inputSchema: objectSchema(), handler: () => operations.getStorageConfig()
    },
    {
      name: "test_storage_destination", scope: "storage:read", description: "Validate and preview a local or GCS storage destination without changing state.",
      inputSchema: objectSchema({ destination: { type: "object" } }, ["destination"]),
      handler: ({ destination }) => operations.testStorage(destination)
    },
    {
      name: "preview_storage_switch", scope: "storage:switch", description: "Dry-run a non-destructive storage migration and issue a short-lived confirmation ID.",
      inputSchema: objectSchema({ destination: { type: "object" }, expectedRevision: { type: "integer", minimum: 1 } }, ["destination", "expectedRevision"]),
      handler: (args, context) => operations.previewStorageSwitch(args, context)
    },
    {
      name: "switch_storage", scope: "storage:switch", description: "Copy data and switch storage using an unexpired preview confirmation. Source data is never deleted.",
      inputSchema: objectSchema({ confirmationId: { type: "string" }, confirm: { const: true } }, ["confirmationId", "confirm"]),
      handler: (args, context) => operations.switchStorage(args, context)
    }
  ];
}
