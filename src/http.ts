import { webcrypto } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { DOCS_URL, VERSION, type LuwConfig } from "./config.js";
import { createLuwServer } from "./mcp-server.js";
import { createOAuth } from "./oauth.js";

// Node 18 has no global Web Crypto; the SDK's web-standard transport calls crypto.randomUUID().
if (!globalThis.crypto) (globalThis as { crypto?: unknown }).crypto = webcrypto;

const MAX_BODY_BYTES = 25 * 1024 * 1024; // room for data: URI images in tool arguments
const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-length", "upgrade", "te", "trailer"]);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID, X-Luw-Api-Key",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

/**
 * Stateless Streamable HTTP handler built on Web standard Request/Response, so it runs on Node,
 * Bun, Deno or edge runtimes. Each request carries its own Luw.ai key; nothing is stored server-side.
 * With an OAuth secret configured, keyless clients are sent to sign in to Luw.ai instead (oauth.ts).
 */
export function createFetchHandler(baseConfig: LuwConfig, fetchImpl?: typeof fetch) {
  const oauth = baseConfig.oauthSecret ? createOAuth({ secret: baseConfig.oauthSecret, connectUrl: baseConfig.oauthConnectUrl }) : undefined;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const oauthResponse = await oauth?.handle(request, url);
    if (oauthResponse) return oauthResponse.headers.has("Access-Control-Allow-Origin") ? oauthResponse : withCors(oauthResponse);
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

    if (url.pathname === "/.well-known/openai-apps-challenge" && request.method === "GET") {
      return baseConfig.openaiAppsChallenge
        ? withCors(new Response(baseConfig.openaiAppsChallenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } }))
        : jsonResponse({ error: "not_found" }, 404);
    }
    if (url.pathname === "/health" || url.pathname === "/healthz") {
      return jsonResponse({ status: "ok", version: VERSION, oauth: !!oauth });
    }
    if (url.pathname === "/" && request.method === "GET") {
      return jsonResponse({
        name: "Luw.ai MCP server",
        version: VERSION,
        mcp_endpoint: `${url.origin}/mcp`,
        auth: oauth ? "OAuth (sign in to Luw.ai) or Authorization: Bearer <LUW_API_KEY>" : "Authorization: Bearer <LUW_API_KEY>",
        docs: "https://github.com/Luvi-io/luw-mcp",
        api_docs: DOCS_URL,
      });
    }
    if (url.pathname !== "/mcp") return jsonResponse({ error: "not_found" }, 404);
    if (request.method !== "POST") {
      // Stateless server: no standalone SSE stream (GET) and no sessions to delete (DELETE).
      return withCors(new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { Allow: "POST, OPTIONS", "Content-Type": "application/json" } }));
    }

    const apiKey = apiKeyFrom(request, url);
    if (!apiKey && oauth) return withCors(oauth.unauthorized(url));
    const authChallenge = oauth?.rejectedKeyChallenge(url);
    const server = createLuwServer({ ...baseConfig, apiKey, mode: "remote", authChallenge }, fetchImpl);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      maxRequestBodySize: MAX_BODY_BYTES,
    });
    // The transport answers malformed or unsupported requests with a bare 400; log why, or the logs only show the status.
    transport.onerror = (error) => console.warn(`MCP request rejected (${request.headers.get("user-agent") ?? "unknown client"}): ${error.message}`);
    const cleanup = once(() => {
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(withKnownProtocolVersion(request));
      return withCors(onBodyDone(response, cleanup));
    } catch (error) {
      cleanup();
      throw error;
    }
  };
}

/**
 * ChatGPT's MCP client sends an MCP-Protocol-Version newer than this SDK knows (2026-07-28), which the transport
 * rejects with a bare 400. The methods it calls are unchanged, so answer them at the latest version we support.
 */
function withKnownProtocolVersion(request: Request): Request {
  const version = request.headers.get("mcp-protocol-version");
  if (!version || SUPPORTED_PROTOCOL_VERSIONS.includes(version)) return request;
  const headers = new Headers(request.headers);
  headers.set("mcp-protocol-version", LATEST_PROTOCOL_VERSION);
  return new Request(request, { headers });
}

/** Accepts `Authorization: Bearer <key>`, `X-Luw-Api-Key: <key>`, or `?api_key=` for clients that can't set headers. */
export function apiKeyFrom(request: Request, url: URL): string {
  const auth = request.headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  return (bearer ?? request.headers.get("x-luw-api-key") ?? url.searchParams.get("api_key") ?? "").trim();
}

export function startHttpServer(options: { config: LuwConfig; port: number; host: string }) {
  const handle = createFetchHandler(options.config);
  const server = createServer(async (req, res) => {
    try {
      const request = await toWebRequest(req, options.host);
      if (!request) {
        res.writeHead(413, { "Content-Type": "application/json", ...CORS_HEADERS }).end(JSON.stringify({ error: "payload_too_large" }));
        return;
      }
      await writeWebResponse(await handle(request), res);
    } catch (error) {
      console.error("Request failed:", error instanceof Error ? error.message : error);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json", ...CORS_HEADERS });
      res.end(JSON.stringify({ error: "internal_error" }));
    }
  });
  server.listen(options.port, options.host, () => {
    console.error(`Luw.ai MCP server v${VERSION} listening on http://${options.host}:${options.port}/mcp`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server;
}

async function toWebRequest(req: IncomingMessage, fallbackHost: string): Promise<Request | undefined> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? fallbackHost}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    // Hop-by-hop and length headers describe the Node socket, not the buffered body we pass on.
    if (value === undefined || HOP_BY_HOP.has(key)) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  let body: Buffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) return undefined;
      chunks.push(chunk as Buffer);
    }
    body = Buffer.concat(chunks);
  }
  const abort = new AbortController();
  req.once("close", () => {
    if (!req.complete) abort.abort();
  });
  return new Request(url, { method: req.method, headers, body: body as BodyInit | undefined, signal: abort.signal });
}

async function writeWebResponse(response: Response, res: ServerResponse) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  res.once("close", () => void reader.cancel().catch(() => {}));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

/** Re-wraps the body so `done` runs once the (possibly SSE) stream finishes or the client goes away. */
function onBodyDone(response: Response, done: () => void): Response {
  if (!response.body) {
    done();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          done();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        controller.error(error);
        done();
      }
    },
    cancel(reason) {
      done();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function withCors(response: Response): Response {
  for (const [k, v] of Object.entries(CORS_HEADERS)) response.headers.set(k, v);
  return response;
}

function jsonResponse(value: unknown, status = 200): Response {
  return withCors(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }));
}

function once(fn: () => void): () => void {
  let called = false;
  return () => {
    if (!called) {
      called = true;
      fn();
    }
  };
}
