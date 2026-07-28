import test from "node:test";
import assert from "node:assert/strict";
import { validateGcpProjectId } from "../lib/google-cloud.mjs";

test("validates Google Cloud project ids before bucket discovery", () => {
  assert.equal(validateGcpProjectId("example-production"), "example-production");
  assert.equal(validateGcpProjectId("demo-12345"), "demo-12345");
  assert.throws(() => validateGcpProjectId("Project Name"), /project IDの形式/);
  assert.throws(() => validateGcpProjectId("ab"), /project IDの形式/);
});
