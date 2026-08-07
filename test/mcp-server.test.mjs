import assert from "node:assert/strict";
import test from "node:test";
import { createMcpHttpHandler } from "../lib/mcp-server.mjs";
import { createPrismTrailMcpTools } from "../lib/mcp-tools.mjs";

function responseCapture() {
  return {
    headers: {}, status: null, body: "",
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    end(body = "") { this.body = String(body); }
  };
}

const sendJson = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

test("MCP lists only tools allowed by token scopes and exposes no delete tool", async () => {
  const handler = createMcpHttpHandler({
    tokenManager: { authenticate: async () => ({ id: "one", scopes: ["suites:read"] }) },
    tools: [
      { name: "list_suites", description: "List", inputSchema: { type: "object" }, scope: "suites:read", handler: async () => [] },
      { name: "create_suite", description: "Create", inputSchema: { type: "object" }, scope: "suites:write", handler: async () => ({}) }
    ]
  });
  const response = responseCapture();
  await handler(
    { method: "POST", headers: { authorization: "Bearer x", host: "localhost" } },
    response,
    { readJson: async () => ({ jsonrpc: "2.0", id: 1, method: "tools/list" }), sendJson }
  );
  const names = JSON.parse(response.body).result.tools.map((tool) => tool.name);
  assert.deepEqual(names, ["list_suites"]);
  assert.equal(names.some((name) => name.includes("delete")), false);
});

test("MCP rejects invalid tokens", async () => {
  const handler = createMcpHttpHandler({ tokenManager: { authenticate: async () => null }, tools: [] });
  const response = responseCapture();
  await handler({ method: "POST", headers: {} }, response, { readJson: async () => ({}), sendJson });
  assert.equal(response.status, 401);
  assert.match(response.body, /Invalid/);
});

test("MCP rejects cross-origin requests and unknown tool arguments", async () => {
  const tool = { name: "list_suites", description: "List", inputSchema: { type: "object", properties: {}, additionalProperties: false }, scope: "suites:read", handler: async () => [] };
  const handler = createMcpHttpHandler({ tokenManager: { authenticate: async () => ({ id: "one", scopes: ["suites:read"] }) }, tools: [tool] });
  const denied = responseCapture();
  await handler({ method: "POST", headers: { origin: "https://evil.example", host: "localhost" } }, denied, { readJson: async () => ({}), sendJson });
  assert.equal(denied.status, 403);

  const invalid = responseCapture();
  await handler(
    { method: "POST", headers: { authorization: "Bearer x", host: "localhost" } }, invalid,
    { readJson: async () => ({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_suites", arguments: { unexpected: true } } }), sendJson }
  );
  const body = JSON.parse(invalid.body);
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /not allowed/);
});

test("PrismTrail MCP exposes the complete non-destructive operation surface", () => {
  const operations = new Proxy({}, { get: () => async () => ({}) });
  const tools = createPrismTrailMcpTools(operations);
  const names = tools.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, 42);
  for (const expected of [
    "update_test_case", "run_single_prompt", "run_suite", "get_run_evidence",
    "get_evaluation_report", "download_evaluation_report_pdf", "download_case_spec_pdf",
    "restore_suite_version", "check_agent_connection", "sync_knowledge_source",
    "upload_knowledge_file", "export_suite_to_sheet", "import_suite_from_sheet",
    "export_report_to_sheet", "edit_suite_with_ai", "switch_storage"
  ]) assert.equal(names.includes(expected), true, expected);
  assert.equal(names.some((name) => /delete|remove|purge|cancel/i.test(name)), false);
  assert.equal(tools.every((tool) => typeof tool.scope === "string" && tool.scope.length > 0), true);
  const createCase = tools.find((tool) => tool.name === "create_test_case");
  assert.equal(createCase.inputSchema.properties.testCase.properties.relatedUrls.maxItems, 20);
  const expectationProperties = createCase.inputSchema.properties.testCase.properties.expectations.properties;
  assert.equal(expectationProperties.accuracyValidation, undefined);
  assert.equal(expectationProperties.businessRequirements.properties.criteriaItems.maxItems, 20);
  assert.equal(createCase.inputSchema.properties.testCase.properties.relatedUrls.items.format, "uri");
  const connectSheet = tools.find((tool) => tool.name === "connect_google_sheet");
  assert.deepEqual(connectSheet.inputSchema.required, ["spreadsheetUrl", "sheetName", "agentId"]);
  assert.equal(connectSheet.inputSchema.properties.sheetName.maxLength, 120);
  assert.equal(connectSheet.inputSchema.properties.agentId.pattern, "^[a-zA-Z0-9_-]+$");
  const listSheets = tools.find((tool) => tool.name === "list_sheet_connections");
  assert.equal(listSheets.inputSchema.properties.agentId.pattern, "^[a-zA-Z0-9_-]+$");
});
