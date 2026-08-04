import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { McpTokenManager } from "../lib/mcp-auth.mjs";

test("MCP tokens are revealed once and persisted only as hashes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "prismtrail-mcp-"));
  const manager = new McpTokenManager(path.join(directory, "tokens.json"));
  const created = await manager.create({ name: "Codex", scopes: ["suites:read", "suites:write"], expiresInDays: 30 });
  assert.match(created.token, /^ptmcp_[a-f0-9]{16}_/);
  const persisted = await readFile(path.join(directory, "tokens.json"), "utf8");
  assert.equal(persisted.includes(created.token), false);
  assert.equal((await stat(path.join(directory, "tokens.json"))).mode & 0o777, 0o600);
  assert.equal((await manager.list())[0].token, undefined);
  assert.equal((await manager.authenticate(`Bearer ${created.token}`)).name, "Codex");
  assert.equal(await manager.authenticate("Bearer wrong"), null);
});

test("revoked and expired MCP tokens cannot authenticate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "prismtrail-mcp-"));
  let now = new Date("2026-01-01T00:00:00.000Z");
  const manager = new McpTokenManager(path.join(directory, "tokens.json"), { now: () => now });
  const revoked = await manager.create({ expiresInDays: 1 });
  await manager.revoke(revoked.metadata.id);
  assert.equal(await manager.authenticate(`Bearer ${revoked.token}`), null);
  const expired = await manager.create({ expiresInDays: 1 });
  now = new Date("2026-01-03T00:00:00.000Z");
  assert.equal(await manager.authenticate(`Bearer ${expired.token}`), null);
});
