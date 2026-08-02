import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const MAX_REDIRECTS = 3;
const MAX_BYTES = 512 * 1024;
const ALLOWED_CONTENT_TYPES = [
  "text/plain",
  "text/html",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "application/xhtml+xml"
];

function ipv4Number(address) {
  return address.split(".").reduce((total, part) => (total << 8) + Number(part), 0) >>> 0;
}

function inV4Range(value, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (ipv4Number(base) & mask);
}

export function isPublicIpAddress(address) {
  let value = String(address || "").toLowerCase();
  if (value.startsWith("::ffff:")) value = value.slice(7);
  const family = net.isIP(value);
  if (family === 4) {
    const number = ipv4Number(value);
    return ![
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4]
    ].some(([base, bits]) => inV4Range(number, base, bits));
  }
  if (family === 6) {
    // Only globally routable IPv6 unicast (2000::/3). This also excludes IPv4-mapped,
    // loopback, unspecified, unique-local, link-local, and multicast addresses.
    if (!/^[23]/.test(value)) return false;
    return !value.startsWith("2001:db8:");
  }
  return false;
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (entity, code) => {
      const value = Number(code);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    });
}

function htmlToText(value) {
  return decodeEntities(
    value
      .replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>|<\/li\s*>|<\/h[1-6]\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  ).replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
}

async function resolvePublicAddress(hostname, lookup = dns.lookup) {
  if (net.isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) throw new Error("ローカル・プライベート・予約済みIPへのアクセスは禁止されています。");
    return { address: hostname, family: net.isIP(hostname) };
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("公開IPだけに解決されるURLを指定してください。");
  }
  return addresses[0];
}

function requestPinned(url, resolved, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: url.protocol,
      hostname: resolved.address,
      family: resolved.family,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: "GET",
      servername: url.hostname,
      headers: {
        Host: url.host,
        Accept: ALLOWED_CONTENT_TYPES.join(", "),
        "Accept-Encoding": "identity",
        "User-Agent": "PrismTrail-Accuracy-Source/1.0"
      }
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error(`URL本文が上限${maxBytes.toLocaleString()}バイトを超えました。`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ response, body: Buffer.concat(chunks), bytes: size }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("URL取得がタイムアウトしました。")));
    request.on("error", reject);
    request.end();
  });
}

export async function readPublicUrl(input, options = {}) {
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs || 10_000), 1_000), 30_000);
  const maxBytes = Math.min(Math.max(Number(options.maxBytes || MAX_BYTES), 1_024), MAX_BYTES);
  let current = new URL(String(input || ""));
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (!["http:", "https:"].includes(current.protocol) || current.username || current.password) {
      throw new Error("認証情報を含まないHTTP(S) URLだけ取得できます。");
    }
    const expectedPort = current.protocol === "https:" ? "443" : "80";
    if (current.port && current.port !== expectedPort) throw new Error("URL取得は標準HTTP(S)ポートだけ許可されています。");
    const resolved = await resolvePublicAddress(current.hostname, options.lookup);
    const { response, body, bytes } = await (options.request || requestPinned)(current, resolved, { timeoutMs, maxBytes });
    const status = Number(response.statusCode || 0);
    if (status >= 300 && status < 400) {
      if (!response.headers.location) throw new Error(`URL取得のリダイレクト先がありません (${status})。`);
      if (redirect === MAX_REDIRECTS) throw new Error("URL取得のリダイレクト回数が上限を超えました。");
      current = new URL(response.headers.location, current);
      continue;
    }
    if (status < 200 || status >= 300) throw new Error(`URL取得に失敗しました (HTTP ${status})。`);
    const contentEncoding = String(response.headers["content-encoding"] || "identity").toLowerCase();
    if (contentEncoding !== "identity") throw new Error(`URL本文のContent-Encodingは読み込めません: ${contentEncoding}`);
    const contentType = String(response.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new Error(`URL本文のContent-Typeは読み込めません: ${contentType || "unknown"}`);
    }
    const raw = body.toString("utf8");
    return {
      text: contentType.includes("html") ? htmlToText(raw) : raw.trim(),
      finalUrl: current.toString(),
      contentType,
      bytes
    };
  }
  throw new Error("URL取得に失敗しました。");
}
