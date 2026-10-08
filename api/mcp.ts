// Vercel Function for the hosted endpoint (https://mcp.luw.ai). vercel.json rewrites /mcp, /health,
// / and the OAuth routes here; `route` says which, and the shared fetch handler serves it exactly
// like `--http` does.
import { loadConfig } from "../src/config.js";
import { createFetchHandler } from "../src/http.js";

// Hosted mode never uses a key from the environment: every caller brings their own.
const handle = createFetchHandler(loadConfig({ ...process.env, LUW_API_KEY: "", LUW_API_TOKEN: "" }, { mode: "remote" }));
const PATHS: Record<string, string> = {
  health: "/health",
  info: "/",
  "oauth-protected-resource": "/.well-known/oauth-protected-resource",
  "oauth-protected-resource-mcp": "/.well-known/oauth-protected-resource/mcp",
  "oauth-authorization-server": "/.well-known/oauth-authorization-server",
  register: "/register",
  authorize: "/authorize",
  token: "/token",
  approve: "/oauth/approve",
  "openai-apps-challenge": "/.well-known/openai-apps-challenge",
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    url.pathname = PATHS[url.searchParams.get("route") ?? ""] ?? "/mcp";
    url.searchParams.delete("route");
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    return handle(new Request(url, { method: request.method, headers: request.headers, body, signal: request.signal }));
  },
};
