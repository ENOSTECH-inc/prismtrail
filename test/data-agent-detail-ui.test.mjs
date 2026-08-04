import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

test("Data Agent detail endpoint loads remote configuration without breaking local fallback", () => {
  assert.match(server, /const agentDetailMatch = url\.pathname\.match/);
  assert.match(server, /remoteConfiguration: remote\.agent/);
  assert.match(server, /configurationFetchedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(server, /configurationError: error\.message/);
});

test("Data Agent reads bill the registered resource project when available", () => {
  const matches = server.match(/billingProject: agent\.projectId \|\| config\.billingProject/g) || [];
  assert.ok(matches.length >= 3, "detail, REST check, and MCP check should use the registered project");
});
