const PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([PROTOCOL_VERSION, "2025-06-18"]);

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function toolText(value) {
  return [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
}

function hasScope(token, required) {
  return !required || token.scopes?.includes(required);
}

function validateInput(schema, value, location = "arguments") {
  if (!schema) return;
  if (schema.const !== undefined && value !== schema.const) throw new Error(`${location} must equal ${JSON.stringify(schema.const)}`);
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} must be an object`);
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`${location}.${key} is required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties || {}, key)) throw new Error(`${location}.${key} is not allowed`);
    }
    for (const [key, child] of Object.entries(schema.properties || {})) if (Object.hasOwn(value, key)) validateInput(child, value[key], `${location}.${key}`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) throw new Error(`${location} must be an array`);
    if (schema.maxItems != null && value.length > schema.maxItems) throw new Error(`${location} has too many items`);
    value.forEach((item, index) => validateInput(schema.items, item, `${location}[${index}]`));
  } else if (schema.type === "string") {
    if (typeof value !== "string") throw new Error(`${location} must be a string`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error(`${location} has an invalid format`);
  } else if (schema.type === "integer") {
    if (!Number.isInteger(value)) throw new Error(`${location} must be an integer`);
    if (schema.minimum != null && value < schema.minimum) throw new Error(`${location} is too small`);
    if (schema.maximum != null && value > schema.maximum) throw new Error(`${location} is too large`);
  } else if (schema.type === "boolean" && typeof value !== "boolean") {
    throw new Error(`${location} must be a boolean`);
  }
}

function originAllowed(request, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const host = String(request.headers.host || "").toLowerCase();
    return parsed.host.toLowerCase() === host || allowedOrigins.has(origin);
  } catch {
    return false;
  }
}

export function createMcpHttpHandler({ tokenManager, tools, allowedOrigins = [], requestsPerMinute = 120, audit = async () => {} }) {
  const definitions = tools.map(({ handler, scope, ...definition }) => definition);
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const rateWindows = new Map();
  const allowedOriginSet = new Set(allowedOrigins);

  function rateLimit(token) {
    const now = Date.now();
    const current = rateWindows.get(token.id);
    if (!current || current.resetAt <= now) {
      rateWindows.set(token.id, { count: 1, resetAt: now + 60_000 });
      return null;
    }
    current.count += 1;
    return current.count > requestsPerMinute ? Math.max(1, Math.ceil((current.resetAt - now) / 1000)) : null;
  }

  return async function handleMcp(request, response, { readJson, sendJson }) {
    if (!originAllowed(request, allowedOriginSet)) {
      sendJson(response, 403, { error: "Origin is not allowed" });
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, { error: "Only stateless Streamable HTTP POST is supported" });
      return;
    }
    const token = await tokenManager.authenticate(request.headers.authorization);
    if (!token) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="PrismTrail MCP"');
      sendJson(response, 401, { error: "Invalid, expired, or revoked MCP token" });
      return;
    }
    const retryAfter = rateLimit(token);
    if (retryAfter) {
      response.setHeader("Retry-After", String(retryAfter));
      sendJson(response, 429, { error: "MCP request rate limit exceeded" });
      return;
    }

    let payload;
    try {
      payload = await readJson(request);
    } catch (error) {
      sendJson(response, 400, jsonRpcError(null, -32700, "Parse error", error.message));
      return;
    }
    const id = payload?.id;
    if (payload?.jsonrpc !== "2.0" || typeof payload?.method !== "string") {
      sendJson(response, 400, jsonRpcError(id, -32600, "Invalid Request"));
      return;
    }

    if (payload.method === "notifications/initialized") {
      response.writeHead(202, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (payload.method === "initialize") {
      const requestedVersion = String(payload.params?.protocolVersion || "");
      sendJson(response, 200, {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion) ? requestedVersion : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "prismtrail", version: "0.1.0" },
          instructions: "Manage PrismTrail evaluations. Delete operations are intentionally unavailable."
        }
      });
      return;
    }
    if (payload.method === "ping") {
      sendJson(response, 200, { jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (payload.method === "tools/list") {
      sendJson(response, 200, {
        jsonrpc: "2.0",
        id,
        result: { tools: definitions.filter((tool) => hasScope(token, toolMap.get(tool.name)?.scope)) }
      });
      return;
    }
    if (payload.method === "tools/call") {
      const name = String(payload.params?.name || "");
      const tool = toolMap.get(name);
      if (!tool) {
        sendJson(response, 200, jsonRpcError(id, -32601, "Tool not found"));
        return;
      }
      if (!hasScope(token, tool.scope)) {
        await audit({ tokenId: token.id, tool: name, outcome: "denied", reason: "scope" });
        sendJson(response, 200, jsonRpcError(id, -32001, `Token requires the ${tool.scope} scope`));
        return;
      }
      const startedAt = Date.now();
      try {
        const args = payload.params?.arguments || {};
        validateInput(tool.inputSchema, args);
        const result = await tool.handler(args, { token });
        const content = result?.content || toolText(result);
        await audit({ tokenId: token.id, tool: name, outcome: "succeeded", durationMs: Date.now() - startedAt });
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id,
          result: { content, ...(result?.structuredContent ? { structuredContent: result.structuredContent } : {}) }
        });
      } catch (error) {
        await audit({ tokenId: token.id, tool: name, outcome: "failed", durationMs: Date.now() - startedAt, errorCode: error.status || "tool_error" });
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: toolText({ error: error.message || "Tool execution failed", ...(error.details ? { details: error.details } : {}) })
          }
        });
      }
      return;
    }
    sendJson(response, 200, jsonRpcError(id, -32601, "Method not found"));
  };
}
