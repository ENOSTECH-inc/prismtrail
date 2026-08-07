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

test("local storage inspection returns a bounded registered-data preview", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-eval-storage-preview-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const backend = new LocalStorageBackend(root);
  await backend.save("agents", { id: "agent_1", name: "Sales Agent" });
  await backend.save("agents", { id: "agent_2", name: "Finance Agent" });

  const preview = await backend.inspect("agents", { sampleLimit: 1 });

  assert.equal(preview.count, 2);
  assert.ok(preview.sizeBytes > 0);
  assert.equal(preview.samples.length, 1);
  assert.ok(["agent_1", "agent_2"].includes(preview.samples[0].id));
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
    new Response(JSON.stringify({ id: "suite_1", name: "before" }), {
      status: 200,
      headers: { "x-goog-generation": "7" }
    }),
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
  assert.match(calls[0].url, /alt=media/);
  assert.match(calls[1].url, /ifGenerationMatch=7/);
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-token");
});

test("GCS retries after object mutation rate limits", async () => {
  const calls = [];
  const responses = [
    new Response(JSON.stringify({ id: "suite_1" }), {
      status: 200,
      headers: { "x-goog-generation": "3" }
    }),
    new Response("rate limited", { status: 429 }),
    new Response(JSON.stringify({ generation: "4" }), { status: 200 })
  ];
  const backend = new GcsStorageBackend(
    { bucket: "portable-test-bucket" },
    {
      tokenProvider: async () => ({ token: "test-token", source: "test" }),
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return responses.shift();
      }
    }
  );
  await backend.get("suites", "suite_1");
  const started = Date.now();
  await backend.save("suites", { id: "suite_1", name: "after rate limit" });
  assert.ok(Date.now() - started >= 900);
  assert.equal(calls.filter((item) => item.options.method === "POST").length, 2);
});

test("GCS retries a generation race and overwrites with the latest precondition", async () => {
  const calls = [];
  const responses = [
    new Response(JSON.stringify({ id: "suite_1" }), {
      status: 200,
      headers: { "x-goog-generation": "7" }
    }),
    new Response("generation mismatch", { status: 412 }),
    new Response(JSON.stringify({ generation: "9" }), { status: 200 }),
    new Response(JSON.stringify({ generation: "10" }), { status: 200 })
  ];
  const backend = new GcsStorageBackend(
    { bucket: "portable-test-bucket" },
    {
      tokenProvider: async () => ({ token: "test-token", source: "test" }),
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return responses.shift();
      }
    }
  );
  await backend.get("suites", "suite_1");
  await backend.save("suites", { id: "suite_1", name: "recovered edit" });
  assert.match(calls[1].url, /ifGenerationMatch=7/);
  assert.match(calls[2].url, /storage\/v1\/b\/.*\/o\/.*suite_1\.json$/);
  assert.match(calls[3].url, /ifGenerationMatch=9/);
});

test("GCS surfaces a generation race as a storage conflict after retries are exhausted", async () => {
  const responses = [
    new Response(JSON.stringify({ id: "suite_1" }), {
      status: 200,
      headers: { "x-goog-generation": "7" }
    }),
    new Response("generation mismatch", { status: 412 }),
    new Response(JSON.stringify({ generation: "8" }), { status: 200 }),
    new Response("generation mismatch", { status: 412 }),
    new Response(JSON.stringify({ generation: "9" }), { status: 200 }),
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
    backend.save("suites", { id: "suite_1", name: "stale edit" }, { maxRetries: 3 }),
    { code: "EEXIST", status: 412 }
  );
});

test("GCS storage inspection counts metadata and downloads only bounded samples", async () => {
  const calls = [];
  const responses = [
    new Response(JSON.stringify({
      items: [
        { name: "shared/agents/agent_1.json", size: "120", updated: "2026-07-30T00:00:00Z" },
        { name: "shared/agents/agent_2.json", size: "80", updated: "2026-07-31T00:00:00Z" },
        { name: "shared/agents/not-managed.txt", size: "500", updated: "2026-07-31T00:00:00Z" }
      ]
    }), { status: 200 }),
    new Response(JSON.stringify({ id: "agent_2", name: "Finance Agent" }), {
      status: 200,
      headers: { "x-goog-generation": "9" }
    })
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

  const preview = await backend.inspect("agents", { sampleLimit: 1 });

  assert.equal(preview.count, 2);
  assert.equal(preview.sizeBytes, 200);
  assert.equal(preview.latestUpdatedAt, "2026-07-31T00:00:00Z");
  assert.deepEqual(preview.samples, [{ id: "agent_2", name: "Finance Agent" }]);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /alt=media/);
});

test("GCS lists reuse generation-matched disk cache and a short-lived token", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-eval-gcs-cache-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  let now = 1_000;
  let tokenCalls = 0;
  const calls = [];
  const items = [
    { name: "shared/suites/suite_1.json", generation: "11" },
    { name: "shared/suites/suite_2.json", generation: "12" }
  ];
  const fetchImpl = async (url) => {
    const rawUrl = String(url);
    calls.push(rawUrl);
    if (!rawUrl.includes("alt=media")) {
      return new Response(JSON.stringify({ items }), { status: 200 });
    }
    const id = rawUrl.includes("suite_1.json") ? "suite_1" : "suite_2";
    const generation = items.find((item) => item.name.includes(`${id}.json`)).generation;
    return new Response(JSON.stringify({ id, name: id }), {
      status: 200,
      headers: { "x-goog-generation": generation }
    });
  };
  const dependencies = {
    cacheDirectory: root,
    fetchImpl,
    now: () => now,
    listCacheTtlMs: 10,
    tokenCacheTtlMs: 1_000,
    tokenProvider: async () => {
      tokenCalls += 1;
      return { token: `test-token-${tokenCalls}`, source: "test" };
    }
  };
  const firstBackend = new GcsStorageBackend(
    { bucket: "portable-test-bucket", prefix: "shared/" },
    dependencies
  );

  assert.deepEqual((await firstBackend.list("suites")).map((item) => item.id), ["suite_1", "suite_2"]);
  assert.equal(calls.filter((url) => url.includes("alt=media")).length, 2);
  assert.equal(tokenCalls, 1);

  const requestCount = calls.length;
  assert.equal((await firstBackend.list("suites")).length, 2);
  assert.equal(calls.length, requestCount);

  now += 20;
  assert.equal((await firstBackend.list("suites")).length, 2);
  assert.equal(calls.filter((url) => url.includes("alt=media")).length, 2);
  assert.equal(tokenCalls, 1);

  items[0].generation = "13";
  now += 20;
  assert.equal((await firstBackend.list("suites")).length, 2);
  assert.equal(calls.filter((url) => url.includes("alt=media")).length, 3);

  const secondBackend = new GcsStorageBackend(
    { bucket: "portable-test-bucket", prefix: "shared/" },
    dependencies
  );
  assert.equal((await secondBackend.list("suites")).length, 2);
  assert.equal(calls.filter((url) => url.includes("alt=media")).length, 3);
});

test("GCS retries once with a refreshed token after a 401", async () => {
  let tokenCalls = 0;
  const authorizationHeaders = [];
  const backend = new GcsStorageBackend(
    { bucket: "portable-test-bucket", prefix: "shared/" },
    {
      tokenProvider: async () => {
        tokenCalls += 1;
        return { token: `test-token-${tokenCalls}`, source: "test" };
      },
      fetchImpl: async (_url, options = {}) => {
        authorizationHeaders.push(options.headers.Authorization);
        if (authorizationHeaders.length === 1) return new Response("expired", { status: 401 });
        return new Response(JSON.stringify({ name: "portable-test-bucket" }), { status: 200 });
      }
    }
  );

  assert.equal((await backend.validate()).authSource, "test");
  assert.equal(tokenCalls, 2);
  assert.deepEqual(authorizationHeaders, ["Bearer test-token-1", "Bearer test-token-2"]);
});

test("GCS coalesces concurrent token refreshes after 401 responses", async () => {
  let tokenCalls = 0;
  const backend = new GcsStorageBackend(
    { bucket: "portable-test-bucket" },
    {
      tokenProvider: async () => ({ token: `token-${++tokenCalls}`, source: "test" }),
      fetchImpl: async (_url, options = {}) => {
        const token = options.headers.Authorization;
        if (token === "Bearer token-1") return new Response("expired", { status: 401 });
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
    }
  );

  await Promise.all([
    backend.request("https://storage.googleapis.test/a"),
    backend.request("https://storage.googleapis.test/b"),
    backend.request("https://storage.googleapis.test/c")
  ]);

  assert.equal(tokenCalls, 2);
});
