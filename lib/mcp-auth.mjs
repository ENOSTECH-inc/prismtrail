import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const MCP_SCOPES = Object.freeze([
  "suites:read",
  "suites:write",
  "runs:read",
  "runs:execute",
  "reports:read",
  "agents:read",
  "agents:write",
  "knowledge:read",
  "knowledge:write",
  "sheets:read",
  "sheets:write",
  "assistant:write",
  "storage:read",
  "storage:switch"
]);

function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(left, right) {
  try {
    const a = Buffer.from(String(left), "hex");
    const b = Buffer.from(String(right), "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function publicToken(token) {
  const { hash, ...safe } = token;
  return safe;
}

function normalizeScopes(value) {
  const requested = Array.isArray(value) ? value.map(String) : [];
  return [...new Set(requested.filter((scope) => MCP_SCOPES.includes(scope)))];
}

export class McpTokenManager {
  constructor(filePath, { now = () => new Date(), random = randomBytes } = {}) {
    this.filePath = path.resolve(filePath);
    this.now = now;
    this.random = random;
    this.writeLock = Promise.resolve();
  }

  async #read() {
    try {
      const data = JSON.parse(await readFile(this.filePath, "utf8"));
      return Array.isArray(data.tokens) ? data : { schemaVersion: 1, tokens: [] };
    } catch (error) {
      if (error?.code === "ENOENT") return { schemaVersion: 1, tokens: [] };
      throw error;
    }
  }

  async #write(data) {
    const task = this.writeLock.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    this.writeLock = task.catch(() => {});
    return task;
  }

  async list() {
    const data = await this.#read();
    return data.tokens.map(publicToken).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async create({ name, scopes = MCP_SCOPES, expiresInDays = 90 } = {}) {
    const label = String(name || "Coding agent").trim().slice(0, 120);
    const normalizedScopes = normalizeScopes(scopes);
    if (!normalizedScopes.length) throw Object.assign(new Error("権限を1つ以上選択してください。"), { status: 400 });
    const days = expiresInDays === null ? null : Number(expiresInDays);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
      throw Object.assign(new Error("有効期間は1日から365日の範囲で指定してください。"), { status: 400 });
    }
    const id = `mcp_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const secret = this.random(32).toString("base64url");
    const plainTextToken = `ptmcp_${id.slice(4)}_${secret}`;
    const now = this.now();
    const record = {
      id,
      name: label,
      prefix: plainTextToken.slice(0, 20),
      fingerprint: tokenHash(plainTextToken).slice(0, 12),
      hash: tokenHash(plainTextToken),
      scopes: normalizedScopes,
      createdAt: now.toISOString(),
      expiresAt: days === null ? null : new Date(now.getTime() + days * 86_400_000).toISOString(),
      lastUsedAt: null,
      revokedAt: null
    };
    const data = await this.#read();
    data.tokens.push(record);
    await this.#write(data);
    return { token: plainTextToken, metadata: publicToken(record) };
  }

  async revoke(id) {
    const data = await this.#read();
    const record = data.tokens.find((item) => item.id === id);
    if (!record) throw Object.assign(new Error("MCPトークンが見つかりません。"), { status: 404 });
    if (!record.revokedAt) {
      record.revokedAt = this.now().toISOString();
      await this.#write(data);
    }
    return publicToken(record);
  }

  async authenticate(authorization) {
    const match = String(authorization || "").match(/^Bearer\s+([^\s]+)$/i);
    if (!match) return null;
    const candidateHash = tokenHash(match[1]);
    const data = await this.#read();
    const record = data.tokens.find((item) => safeEqualHex(item.hash, candidateHash));
    if (!record || record.revokedAt) return null;
    if (record.expiresAt && Date.parse(record.expiresAt) <= this.now().getTime()) return null;
    const now = this.now();
    if (!record.lastUsedAt || now.getTime() - Date.parse(record.lastUsedAt) > 60_000) {
      record.lastUsedAt = now.toISOString();
      await this.#write(data);
    }
    return publicToken(record);
  }
}
