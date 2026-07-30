import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GcsStorageBackend,
  LocalStorageBackend,
  migrateStorage,
  normalizeStorageSettings,
  SwitchableStorageBackend
} from "../lib/primary-storage.mjs";
import { JsonStore } from "../lib/json-store.mjs";

test("storage settings default to a namespaced GCS prefix", () => {
  assert.deepEqual(normalizeStorageSettings({ provider: "gcs", bucket: "example-bucket" }), {
    provider: "gcs",
    bucket: "example-bucket",
    prefix: "agent-eval/system-data/"
  });
  assert.throws(
    () => normalizeStorageSettings({ provider: "gcs", bucket: "../unsafe" }),
    /バケット名/
  );
});

test("local backend remains compatible with collection/id.json data", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-eval-storage-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const backend = new SwitchableStorageBackend(new LocalStorageBackend(root));
  const store = new JsonStore(backend, "suites");
  await store.save({ id: "suite_1", name: "portable", updatedAt: "2026-01-01T00:00:00Z" });
  assert.equal((await store.get("suite_1")).name, "portable");
  assert.deepEqual((await store.list()).map((item) => item.id), ["suite_1"]);
  await store.delete("suite_1");
  await assert.rejects(() => store.get("suite_1"), (error) => error?.code === "ENOENT");
  assert.deepEqual(await store.list(), []);
});

test("migration previews, copies, and refuses different values with the same id", async (context) => {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-eval-source-"));
  const destinationRoot = await mkdtemp(path.join(os.tmpdir(), "agent-eval-destination-"));
  context.after(() => Promise.all([
    rm(sourceRoot, { recursive: true, force: true }),
    rm(destinationRoot, { recursive: true, force: true })
  ]));
  const source = new LocalStorageBackend(sourceRoot);
  const destination = new LocalStorageBackend(destinationRoot);
  await source.save("agents", { id: "agent_1", name: "source" });

  const preview = await migrateStorage({
    source,
    destination,
    namespaces: ["agents"],
    dryRun: true
  });
  assert.equal(preview.copied, 1);
  await assert.rejects(destination.get("agents", "agent_1"), { code: "ENOENT" });

  const copied = await migrateStorage({
    source,
    destination,
    namespaces: ["agents"],
    dryRun: false
  });
  assert.equal(copied.copied, 1);
  assert.ok(copied.copiedBytes > 0);

  await destination.save("agents", { id: "agent_1", name: "destination edit" });
  const conflict = await migrateStorage({
    source,
    destination,
    namespaces: ["agents"],
    dryRun: true
  });
  assert.equal(conflict.conflicts, 1);
  assert.deepEqual(conflict.namespaces.agents.conflicts, ["agent_1"]);
});

test("GCS writes use generation preconditions after a read", async () => {
  const calls = [];
  const responses = [
    new Response(JSON.stringify({ generation: "7" }), { status: 200 }),
    new Response(JSON.stringify({ id: "suite_1", name: "before" }), { status: 200 }),
    new Response(JSON.stringify({ generation: "8" }), { status: 200 })
  ];
  const backend = new GcsStorageBackend(
    { bucket: "portable-test-bucket", prefix: "shared/" },
    {
      tokenProvider: async () => ({ token: "test-token", source: "test" }),
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return responses.shift();
      }
    }
  );

  assert.equal((await backend.get("suites", "suite_1")).name, "before");
  await backend.save("suites", { id: "suite_1", name: "after" });
  assert.match(calls[2].url, /ifGenerationMatch=7/);
  assert.equal(calls[2].options.headers.Authorization, "Bearer test-token");
});

test("GCS surfaces a generation race as a storage conflict", async () => {
  const responses = [
    new Response(JSON.stringify({ generation: "7" }), { status: 200 }),
    new Response(JSON.stringify({ id: "suite_1" }), { status: 200 }),
    new Response("generation mismatch", { status: 412 })
  ];
  const backend = new GcsStorageBackend(
    { bucket: "portable-test-bucket" },
    {
      tokenProvider: async () => ({ token: "test-token", source: "test" }),
      fetchImpl: async () => responses.shift()
    }
  );
  await backend.get("suites", "suite_1");
  await assert.rejects(
    backend.save("suites", { id: "suite_1", name: "stale edit" }),
    { code: "EEXIST", status: 412 }
  );
});
