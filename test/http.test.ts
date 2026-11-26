import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createFetchHandler } from "../src/http.js";
import { API, fakeLuw, textOf } from "./helpers.js";

function setup() {
  const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/h.png" }));
  const config = loadConfig({}, { baseUrl: API, mode: "remote", inlineImages: false, pollIntervalMs: 5 });
  const handle = createFetchHandler(config, luw.fetch);
  return { luw, handle };
}

async function connectHttp(handle: (r: Request) => Promise<Response>, headers: Record<string, string>, path = "/mcp") {
  const transport = new StreamableHTTPClientTransport(new URL(`http://mcp.test${path}`), {
    requestInit: { headers },
    fetch: (url, init) => handle(new Request(url, init)),
  });
  const client = new Client({ name: "http-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

describe("hosted HTTP server", () => {
  it("serves MCP over Streamable HTTP with the caller's own key", async () => {
    const { luw, handle } = setup();
    const client = await connectHttp(handle, { Authorization: "Bearer user-key-123" });
    const tools = await client.listTools();
    expect(tools.tools.length).toBe(22);

    const result = await client.callTool({ name: "luw_render", arguments: { image: "https://e.com/a.jpg" } });
    expect(textOf(result as any)).toContain("https://cdn.test/h.png");
    expect(luw.generates()[0]!.headers.get("authorization")).toBe("Bearer user-key-123");
    await client.close();
  });

  it("accepts the key as a query parameter for clients without header support", async () => {
    const { luw, handle } = setup();
    const client = await connectHttp(handle, {}, "/mcp?api_key=query-key");
    await client.callTool({ name: "luw_render", arguments: { image: "https://e.com/a.jpg" } });
    expect(luw.generates()[0]!.headers.get("authorization")).toBe("Bearer query-key");
  });

  it("lets clients connect without a key but explains how to add one", async () => {
    const { luw, handle } = setup();
    const client = await connectHttp(handle, {});
    const result = await client.callTool({ name: "luw_render", arguments: { image: "https://e.com/a.jpg" } });
    expect(result.isError).toBe(true);
    expect(textOf(result as any)).toMatch(/Authorization: Bearer/);
    expect(luw.calls).toHaveLength(0);
  });

  it("serves clients that send a protocol version newer than the SDK knows, as ChatGPT does", async () => {
    const { handle } = setup();
    const response = await handle(
      new Request("http://mcp.test/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer user-key-123",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("luw_interior_design");
  });

  it("has health, CORS and method handling", async () => {
    const { handle } = setup();
    const health = await handle(new Request("http://mcp.test/health"));
    expect(await health.json()).toMatchObject({ status: "ok" });
    expect(health.headers.get("access-control-allow-origin")).toBe("*");
    expect((await handle(new Request("http://mcp.test/mcp"))).status).toBe(405);
    expect((await handle(new Request("http://mcp.test/nope"))).status).toBe(404);
    const preflight = await handle(new Request("http://mcp.test/mcp", { method: "OPTIONS" }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toMatch(/Authorization/);
  });
});

describe("Vercel function (api/mcp.ts)", () => {
  it("serves health, info and MCP through the vercel.json routes", async () => {
    const { default: vercel } = await import("../api/mcp.js");
    const health = await vercel.fetch(new Request("https://mcp.test/api/mcp?route=health"));
    expect(await health.json()).toMatchObject({ status: "ok" });
    const info = await vercel.fetch(new Request("https://mcp.test/api/mcp?route=info"));
    expect(await info.json()).toMatchObject({ mcp_endpoint: "https://mcp.test/mcp" });

    const client = await connectHttp((r) => vercel.fetch(r), { Authorization: "Bearer k" }, "/api/mcp");
    expect((await client.listTools()).tools.length).toBe(22);
    await client.close();
  });
});

describe("the Studio view's preview endpoint", () => {
  const VIEW_TOOLS = ["luw_studio_open", "luw_studio_session", "luw_studio_show_shared"];
  const handler = (env: Record<string, string>) => createFetchHandler(loadConfig(env, { baseUrl: API, mode: "remote", inlineImages: false }), fakeLuw().fetch);
  const viewTools = async (handle: (r: Request) => Promise<Response>, path: string) => {
    const client = await connectHttp(handle, { Authorization: "Bearer user-key-123" }, path);
    const names = (await client.listTools()).tools.map((t) => t.name);
    await client.close();
    return names.filter((n) => VIEW_TOOLS.includes(n)).sort();
  };

  it("doesn't exist until LUW_STUDIO_VIEW asks for it, and /studio has no view", async () => {
    const handle = handler({});
    const response = await handle(new Request("http://mcp.test/studio-preview", { method: "POST", headers: { Authorization: "Bearer k" }, body: "{}" }));
    expect(response.status).toBe(404);
    expect(await viewTools(handle, "/studio")).toEqual([]);
  });

  it("LUW_STUDIO_VIEW=preview: the view at /studio-preview only, /studio as it was", async () => {
    const handle = handler({ LUW_STUDIO_VIEW: "preview" });
    expect(await viewTools(handle, "/studio-preview")).toEqual([...VIEW_TOOLS].sort());
    expect(await viewTools(handle, "/studio")).toEqual([]);
    expect(await viewTools(handle, "/mcp")).toEqual([]);
  });

  it("LUW_STUDIO_VIEW=1: the view at /studio, and no preview endpoint", async () => {
    const handle = handler({ LUW_STUDIO_VIEW: "1" });
    expect(await viewTools(handle, "/studio")).toEqual([...VIEW_TOOLS].sort());
    expect(await viewTools(handle, "/mcp")).toEqual([]);
    const response = await handle(new Request("http://mcp.test/studio-preview", { method: "POST", headers: { Authorization: "Bearer k" }, body: "{}" }));
    expect(response.status).toBe(404);
  });

  it("signs in like /studio, as a resource of its own", async () => {
    const handle = handler({ LUW_STUDIO_VIEW: "preview", LUW_MCP_OAUTH_SECRET: "x".repeat(40) });
    const refused = await handle(new Request("http://mcp.test/studio-preview", { method: "POST", body: "{}" }));
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain('resource_metadata="http://mcp.test/.well-known/oauth-protected-resource/studio-preview"');
    const meta = await handle(new Request("http://mcp.test/.well-known/oauth-protected-resource/studio-preview"));
    expect(((await meta.json()) as { resource: string }).resource).toBe("http://mcp.test/studio-preview");
    // /studio's own answers are unchanged.
    const studio = await handle(new Request("http://mcp.test/studio", { method: "POST", body: "{}" }));
    expect(studio.headers.get("www-authenticate")).toContain('resource_metadata="http://mcp.test/.well-known/oauth-protected-resource/studio"');
    const mcp = await handle(new Request("http://mcp.test/mcp", { method: "POST", body: "{}" }));
    expect(mcp.headers.get("www-authenticate")).toContain('resource_metadata="http://mcp.test/.well-known/oauth-protected-resource/mcp"');
  });
});
