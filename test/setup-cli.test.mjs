import assert from "node:assert/strict";
import test from "node:test";
import {
  parseArgs,
  serializeEnv,
  validateAgentResource,
  validateProjectId
} from "../bin/bq-agent-eval.mjs";

test("setup CLI parses commands and flags", () => {
  assert.deepEqual(parseArgs(["init", "--project", "example-project", "--force"]), {
    command: "init",
    flags: { project: "example-project", force: true }
  });
});

test("setup CLI validates matching Google Cloud resources", () => {
  assert.equal(validateProjectId("example-project"), "example-project");
  assert.equal(
    validateAgentResource(
      "projects/example-project/locations/global/dataAgents/example-agent",
      "example-project"
    ),
    "projects/example-project/locations/global/dataAgents/example-agent"
  );
  assert.throws(
    () =>
      validateAgentResource(
        "projects/another-project/locations/global/dataAgents/example-agent",
        "example-project"
      ),
    /does not match/
  );
});

test("setup CLI generates a secret-free environment file", () => {
  const result = serializeEnv({
    appPort: 4318,
    gcloudConfigDir: "/home/example/.config/gcloud",
    projectId: "example-project",
    location: "global",
    agentResource: "projects/example-project/locations/global/dataAgents/example-agent",
    agentLabel: "Example Agent",
    vertexLocation: "global"
  });
  assert.match(result, /BQ_AGENT_BILLING_PROJECT=example-project/);
  assert.match(result, /BQ_AGENT_LABEL="Example Agent"/);
  assert.doesNotMatch(result, /token|private.key|client.secret/i);
});
