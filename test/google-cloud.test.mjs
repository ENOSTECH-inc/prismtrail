import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveDataAgentChatRequest,
  validateGcpProjectId
} from "../lib/google-cloud.mjs";

test("validates Google Cloud project ids before bucket discovery", () => {
  assert.equal(validateGcpProjectId("example-production"), "example-production");
  assert.equal(validateGcpProjectId("demo-12345"), "demo-12345");
  assert.throws(() => validateGcpProjectId("Project Name"), /project IDの形式/);
  assert.throws(() => validateGcpProjectId("ab"), /project IDの形式/);
});

test("uses the Data Agent project when the chat billing project is not configured", () => {
  assert.deepEqual(
    resolveDataAgentChatRequest({
      billingProject: "",
      location: "global",
      dataAgent: "projects/example-production/locations/global/dataAgents/sales-agent"
    }),
    {
      billingProject: "example-production",
      location: "global",
      dataAgent: "projects/example-production/locations/global/dataAgents/sales-agent",
      url: "https://geminidataanalytics.googleapis.com/v1/projects/example-production/locations/global:chat"
    }
  );
});

test("keeps an explicit quota project and builds a regional chat endpoint", () => {
  const request = resolveDataAgentChatRequest({
    billingProject: "quota-project-123",
    location: "us-central1",
    dataAgent: "projects/agent-project-123/locations/us-central1/dataAgents/sales-agent"
  });
  assert.equal(request.billingProject, "quota-project-123");
  assert.equal(
    request.url,
    "https://geminidataanalytics-us-central1.googleapis.com/v1/projects/quota-project-123/locations/us-central1:chat"
  );
});

test("rejects a malformed Data Agent resource before issuing a chat request", () => {
  assert.throws(
    () => resolveDataAgentChatRequest({ dataAgent: "sales-agent" }),
    /resource nameの形式/
  );
});
