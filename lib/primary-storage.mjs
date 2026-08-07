import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { mapWithConcurrency } from "./concurrency.mjs";
import { getAccessToken } from "./google-cloud.mjs";

const GCS_LIST_CONCURRENCY = 8;
const GCS_LIST_CACHE_TTL_MS = 5_000;
const GCS_TOKEN_CACHE_TTL_MS = 5 * 60_000;

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PROVIDERS = new Set(["local", "gcs"]);

function assertId(value, label = "object id") {
  const id = String(value || "");
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid ${label}`);
  return id;
}

function normalizePrefix(value = "") {
  const prefix = String(value).trim().replace(/^\/+/, "");
  if (prefix.includes("..") || prefix.length > 500) {
    throw new Error("ストレージのプレフィックスが正しくありません。");
  }
  return prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix;
}

export function normalizeStorageSettings(value = {}) {
  const provider = String(value.provider || "gcs").toLowerCase();
  if (!PROVIDERS.has(provider)) {
    throw new Error("プライマリーストレージはlocalまたはgcsを指定してください。");
  }
  if (provider === "local") {
    return { provider: "local" };
  }
  const bucket = String(value.bucket || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket)) {
    throw new Error("GCSバケット名の形式が正しくありません。");
  }
  const projectId = String(value.projectId || "").trim();
  if (projectId && !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) {
    throw new Error("Google CloudプロジェクトIDの形式が正しくありません。");
  }
  return {
    provider: "gcs",
    bucket,
    prefix: normalizePrefix(value.prefix || "agent-eval/system-data/"),
    ...(projectId ? { projectId } : {})
  };
}

export class LocalStorageBackend {
  constructor(rootDirectory) {
    this.rootDirectory = rootDirectory;
    this.provider = "local";
  }

  directory(namespace) {
    return path.join(this.rootDirectory, assertId(namespace, "namespace"));
  }

  pathFor(namespace, id) {
    return path.join(this.directory(namespace), `${assertId(id)}.json`);
  }

  async ensure(namespace) {
    await mkdir(this.directory(namespace), { recursive: true });
  }

  async save(namespace, value, { ifAbsent = false } = {}) {
    await this.ensure(namespace);
    const filePath = this.pathFor(namespace, value.id);
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: ifAbsent ? "wx" : "w"
    });
    return value;
  }

  async get(namespace, id) {
    return JSON.parse(await readFile(this.pathFor(namespace, id), "utf8"));
  }

  async list(namespace) {
    await this.ensure(namespace);
    const directory = this.directory(namespace);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
    return Promise.all(
      files.map((file) => readFile(path.join(directory, file), "utf8").then(JSON.parse))
    );
  }

  async inspect(namespace, { sampleLimit = 3 } = {}) {
    await this.ensure(namespace);
    const directory = this.directory(namespace);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
    const entries = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(directory, file);
        const details = await stat(filePath);
        return {
          file,
          filePath,
          sizeBytes: details.size,
          updatedAt: details.mtime.toISOString()
        };
      })
    );
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const samples = await Promise.all(
      entries.slice(0, sampleLimit).map(({ filePath }) =>
        readFile(filePath, "utf8").then(JSON.parse)
      )
    );
    return {
      count: entries.length,
      sizeBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
      latestUpdatedAt: entries[0]?.updatedAt || null,
      samples
    };
  }

  async delete(namespace, id) {
    try {
      await unlink(this.pathFor(namespace, id));
    } catch (error) {
      if (error?.code === "ENOENT") {
        const missing = new Error(`Object not found: ${namespace}/${id}`);
        missing.code = "ENOENT";
        missing.status = 404;
        throw missing;
      }
      throw error;
    }
  }

  async validate() {
    await mkdir(this.rootDirectory, { recursive: true });
    await access(this.rootDirectory, constants.R_OK | constants.W_OK);
    return { provider: this.provider, ready: true, rootDirectory: this.rootDirectory };
  }

  describe() {
    return { provider: this.provider, rootDirectory: this.rootDirectory };
  }
}

export class GcsStorageBackend {
  constructor(settings, {
    fetchImpl = fetch,
    tokenProvider = getAccessToken,
    cacheDirectory = null,
    now = () => Date.now(),
    listCacheTtlMs = GCS_LIST_CACHE_TTL_MS,
    tokenCacheTtlMs = GCS_TOKEN_CACHE_TTL_MS
  } = {}) {
    this.settings = normalizeStorageSettings({ ...settings, provider: "gcs" });
    this.provider = "gcs";
    this.fetchImpl = fetchImpl;
    this.tokenProvider = tokenProvider;
    this.now = now;
    this.listCacheTtlMs = listCacheTtlMs;
    this.tokenCacheTtlMs = tokenCacheTtlMs;
    this.generations = new Map();
    this.listCache = new Map();
    this.listPromises = new Map();
    this.listEpochs = new Map();
    this.tokenCache = null;
    this.tokenPromise = null;
    const cacheKey = createHash("sha256")
      .update(`${this.settings.bucket}\0${this.settings.prefix}`)
      .digest("hex")
      .slice(0, 20);
    this.cacheDirectory = cacheDirectory ? path.join(cacheDirectory, cacheKey) : null;
  }

  objectName(namespace, id) {
    return `${this.settings.prefix}${assertId(namespace, "namespace")}/${assertId(id)}.json`;
  }

  async accessToken({ force = false, staleToken = null } = {}) {
    if (force) {
      if (staleToken && this.tokenCache?.value?.token && this.tokenCache.value.token !== staleToken) {
        return this.tokenCache.value;
      }
      this.tokenCache = null;
    }
    const now = this.now();
    if (this.tokenCache?.expiresAt > now) return this.tokenCache.value;
    if (!this.tokenPromise) {
      const pending = Promise.resolve(this.tokenProvider())
        .then((value) => {
          this.tokenCache = { value, expiresAt: this.now() + this.tokenCacheTtlMs };
          return value;
        })
        .finally(() => {
          if (this.tokenPromise === pending) this.tokenPromise = null;
        });
      this.tokenPromise = pending;
    }
    return this.tokenPromise;
  }

  async request(url, options = {}, { retryAuth = true } = {}) {
    const { token, source: authSource } = await this.accessToken();
    let response = await this.fetchImpl(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(this.settings.projectId ? { "x-goog-user-project": this.settings.projectId } : {}),
        ...options.headers
      }
    });
    if (response.status === 401 && retryAuth) {
      const refreshed = await this.accessToken({ force: true, staleToken: token });
      response = await this.fetchImpl(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${refreshed.token}`,
          ...(this.settings.projectId ? { "x-goog-user-project": this.settings.projectId } : {}),
          ...options.headers
        }
      });
    }
    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`Google Cloud Storage API error ${response.status}: ${body.slice(0, 500)}`);
      error.status = response.status;
      if (response.status === 404) error.code = "ENOENT";
      if (response.status === 412) error.code = "EEXIST";
      throw error;
    }
    return { response, authSource };
  }

  async ensure() {
    // GCS is flat and does not require namespace directories.
    if (this.cacheDirectory) await mkdir(this.cacheDirectory, { recursive: true });
  }

  cachePath(namespace, id) {
    if (!this.cacheDirectory) return null;
    return path.join(
      this.cacheDirectory,
      assertId(namespace, "namespace"),
      `${assertId(id)}.json`
    );
  }

  invalidateList(namespace) {
    this.listCache.delete(namespace);
    this.listPromises.delete(namespace);
    this.listEpochs.set(namespace, (this.listEpochs.get(namespace) || 0) + 1);
  }

  async readCachedValue(namespace, id, generation) {
    const filePath = this.cachePath(namespace, id);
    if (!filePath || !generation) return null;
    try {
      const cached = JSON.parse(await readFile(filePath, "utf8"));
      const generationMatches = String(cached.generation || "") === String(generation);
      const idMatches = cached.value?.id === id;
      return generationMatches && idMatches ? cached.value : null;
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
        console.warn(`[storage] GCS read cache miss: ${error.message}`);
      }
      return null;
    }
  }

  async writeCachedValue(namespace, id, generation, value) {
    const filePath = this.cachePath(namespace, id);
    if (!filePath || !generation) return;
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify({ generation: String(generation), value })}\n`, "utf8");
    await rename(temporaryPath, filePath);
  }

  async deleteCachedValue(namespace, id) {
    const filePath = this.cachePath(namespace, id);
    if (!filePath) return;
    await unlink(filePath).catch((error) => {
      if (error?.code !== "ENOENT") console.warn(`[storage] GCS read cache cleanup: ${error.message}`);
    });
  }

  async save(namespace, value, { ifAbsent = false } = {}) {
    const objectName = this.objectName(namespace, value.id);
    const cacheKey = `${namespace}/${value.id}`;
    let expectedGeneration = this.generations.get(cacheKey);
    if (!ifAbsent && expectedGeneration == null) {
      try {
        const metadata = await this.metadata(objectName);
        expectedGeneration = metadata.generation;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        expectedGeneration = "0";
      }
    }
    const query = new URLSearchParams({
      uploadType: "media",
      name: objectName,
      ...(ifAbsent
        ? { ifGenerationMatch: "0" }
        : expectedGeneration != null
          ? { ifGenerationMatch: String(expectedGeneration) }
          : {})
    });
    const { response } = await this.request(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.settings.bucket)}/o?${query}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: `${JSON.stringify(value, null, 2)}\n`
      }
    );
    const metadata = await response.json();
    if (metadata.generation) {
      this.generations.set(cacheKey, metadata.generation);
      await this.writeCachedValue(namespace, value.id, metadata.generation, value).catch((error) => {
        console.warn(`[storage] GCS read cache write: ${error.message}`);
      });
    }
    this.invalidateList(namespace);
    return value;
  }

  async metadata(objectName) {
    const { response } = await this.request(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.settings.bucket)}/o/${encodeURIComponent(objectName)}`
    );
    return response.json();
  }

  async get(namespace, id) {
    const objectName = this.objectName(namespace, id);
    // Single media request — generation comes back on the response header.
    // Avoids a metadata round-trip on every read (important for list-heavy GCS usage).
    const { response } = await this.request(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.settings.bucket)}/o/${encodeURIComponent(objectName)}?alt=media`
    );
    const generation = response.headers.get("x-goog-generation");
    if (generation) this.generations.set(`${namespace}/${id}`, generation);
    return JSON.parse(await response.text());
  }

  async listedValue(namespace, item, prefix) {
    const id = item.name.slice(prefix.length, -5);
    const cached = await this.readCachedValue(namespace, id, item.generation);
    if (cached) {
      this.generations.set(`${namespace}/${id}`, String(item.generation));
      return cached;
    }
    const value = await this.get(namespace, id);
    const generation = this.generations.get(`${namespace}/${id}`) || item.generation;
    await this.writeCachedValue(namespace, id, generation, value).catch((error) => {
      console.warn(`[storage] GCS read cache write: ${error.message}`);
    });
    return value;
  }

  async listUncached(namespace) {
    const prefix = `${this.settings.prefix}${assertId(namespace, "namespace")}/`;
    const values = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({
        prefix,
        maxResults: "1000",
        fields: "items(name,generation),nextPageToken"
      });
      if (pageToken) query.set("pageToken", pageToken);
      const { response } = await this.request(
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.settings.bucket)}/o?${query}`
      );
      const body = await response.json();
      const items = (body.items || [])
        .filter((item) => {
          const name = String(item.name || "");
          if (!name.startsWith(prefix) || !name.endsWith(".json")) return false;
          return ID_PATTERN.test(name.slice(prefix.length, -5));
        });
      const page = await mapWithConcurrency(items, GCS_LIST_CONCURRENCY, (item) =>
        this.listedValue(namespace, item, prefix)
      );
      values.push(...page);
      pageToken = body.nextPageToken || "";
    } while (pageToken);
    return values;
  }

  async list(namespace) {
    const normalizedNamespace = assertId(namespace, "namespace");
    const cached = this.listCache.get(normalizedNamespace);
    if (cached?.expiresAt > this.now()) return cached.values;
    if (this.listPromises.has(normalizedNamespace)) return this.listPromises.get(normalizedNamespace);
    const epoch = this.listEpochs.get(normalizedNamespace) || 0;
    const pending = this.listUncached(normalizedNamespace)
      .then((values) => {
        if ((this.listEpochs.get(normalizedNamespace) || 0) === epoch) {
          this.listCache.set(normalizedNamespace, {
            values,
            expiresAt: this.now() + this.listCacheTtlMs
          });
        }
        return values;
      })
      .finally(() => {
        if (this.listPromises.get(normalizedNamespace) === pending) {
          this.listPromises.delete(normalizedNamespace);
        }
      });
    this.listPromises.set(normalizedNamespace, pending);
    return pending;
  }

  async inspect(namespace, { sampleLimit = 3 } = {}) {
    const prefix = `${this.settings.prefix}${assertId(namespace, "namespace")}/`;
    const entries = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({
        prefix,
        maxResults: "1000",
        fields: "items(name,generation,size,updated),nextPageToken"
      });
      if (pageToken) query.set("pageToken", pageToken);
      const { response } = await this.request(
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.settings.bucket)}/o?${query}`
      );
      const body = await response.json();
      entries.push(
        ...(body.items || []).filter((item) => {
          if (!item.name?.startsWith(prefix) || !item.name.endsWith(".json")) return false;
          return ID_PATTERN.test(item.name.slice(prefix.length, -5));
        })
      );
      pageToken = body.nextPageToken || "";
    } while (pageToken);
    entries.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
    const samples = await Promise.all(
      entries.slice(0, sampleLimit).map((entry) => {
        const id = entry.name.slice(prefix.length, -5);
        return this.get(namespace, id);
      })
    );
    return {
      count: entries.length,
      sizeBytes: entries.reduce((total, entry) => total + Number(entry.size || 0), 0),
      latestUpdatedAt: entries[0]?.updated || null,
      samples
    };
  }

  async delete(namespace, id) {
    const objectName = this.objectName(namespace, id);
    await this.request(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.settings.bucket)}/o/${encodeURIComponent(objectName)}`,
      { method: "DELETE" }
    );
    this.generations.delete(`${namespace}/${id}`);
    this.invalidateList(namespace);
    await this.deleteCachedValue(namespace, id);
  }

  async validate() {
    const { response, authSource } = await this.request(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.settings.bucket)}`
    );
    const bucket = await response.json();
    return {
      provider: this.provider,
      ready: true,
      authSource,
      bucket: bucket.name,
      projectNumber: bucket.projectNumber || null,
      location: bucket.location || null,
      prefix: this.settings.prefix
    };
  }

  describe() {
    return { ...this.settings };
  }
}

export class SwitchableStorageBackend {
  constructor(backend) {
    this.backend = backend;
  }

  use(backend) {
    this.backend = backend;
  }

  ensure(namespace) {
    return this.backend.ensure(namespace);
  }

  save(namespace, value, options) {
    return this.backend.save(namespace, value, options);
  }

  get(namespace, id) {
    return this.backend.get(namespace, id);
  }

  list(namespace) {
    return this.backend.list(namespace);
  }

  inspect(namespace, options) {
    return this.backend.inspect(namespace, options);
  }

  delete(namespace, id) {
    return this.backend.delete(namespace, id);
  }

  validate() {
    return this.backend.validate();
  }

  describe() {
    return this.backend.describe();
  }
}

export function createStorageBackend(settings, { dataDirectory, ...dependencies } = {}) {
  const normalized = normalizeStorageSettings(settings);
  return normalized.provider === "gcs"
    ? new GcsStorageBackend(normalized, {
      ...dependencies,
      cacheDirectory: dependencies.cacheDirectory || (dataDirectory ? path.join(dataDirectory, ".gcs-cache") : null)
    })
    : new LocalStorageBackend(dataDirectory);
}

export async function migrateStorage({
  source,
  destination,
  namespaces,
  dryRun = true,
  overwrite = false
}) {
  const result = {
    dryRun: Boolean(dryRun),
    source: source.describe(),
    destination: destination.describe(),
    namespaces: {},
    copied: 0,
    copiedBytes: 0,
    unchanged: 0,
    conflicts: 0
  };
  for (const namespace of namespaces) {
    const sourceValues = await source.list(namespace);
    const namespaceResult = {
      total: sourceValues.length,
      copied: 0,
      copiedBytes: 0,
      unchanged: 0,
      conflicts: []
    };
    for (const value of sourceValues) {
      let current = null;
      try {
        current = await destination.get(namespace, value.id);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (current && JSON.stringify(current) === JSON.stringify(value)) {
        namespaceResult.unchanged += 1;
        result.unchanged += 1;
        continue;
      }
      if (current && !overwrite) {
        namespaceResult.conflicts.push(value.id);
        result.conflicts += 1;
        continue;
      }
      if (!dryRun) {
        await destination.save(namespace, value, { ifAbsent: !current });
      }
      const bytes = Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);
      namespaceResult.copied += 1;
      namespaceResult.copiedBytes += bytes;
      result.copied += 1;
      result.copiedBytes += bytes;
    }
    result.namespaces[namespace] = namespaceResult;
  }
  return result;
}
