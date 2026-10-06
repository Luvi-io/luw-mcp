import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, type LuwConfig } from "../src/config.js";
import { createLuwServer } from "../src/server.js";

export const API = "https://api.test/v2";

export interface Recorded {
  method: string;
  url: URL;
  headers: Headers;
  json?: any;
  form?: FormData;
  bytes?: Uint8Array;
}

type Handler = (req: Recorded) => Response | Promise<Response> | unknown;

/** A scriptable stand-in for the Luw.ai API + CDN. Unmatched requests fail the test loudly. */
export function fakeLuw() {
  const calls: Recorded[] = [];
  const routes: { method: string; match: string | RegExp; handler: Handler; times?: number }[] = [];

  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const rec: Recorded = { method, url, headers };
    if (typeof init.body === "string") rec.json = JSON.parse(init.body);
    else if (init.body instanceof FormData) rec.form = init.body;
    else if (init.body instanceof Uint8Array) rec.bytes = init.body;
    calls.push(rec);

    const target = url.origin + url.pathname;
    const route = routes.find(
      (r) => r.method === method && (typeof r.match === "string" ? r.match === target : r.match.test(target)) && r.times !== 0,
    );
    if (!route) throw new Error(`Unexpected request: ${method} ${url}`);
    if (route.times !== undefined) route.times--;
    const result = await route.handler(rec);
    return result instanceof Response ? result : Response.json(result);
  }) as typeof globalThis.fetch;

  const api = {
    calls,
    fetch,
    /** Register a handler; `times` limits how often it matches (later routes take over). */
    on(method: string, match: string | RegExp, handler: Handler, times?: number) {
      routes.push({ method, match: typeof match === "string" && match.startsWith("/") ? API + match : match, handler, times });
      return api;
    },
    generates(): Recorded[] {
      return calls.filter((c) => c.url.pathname.endsWith("/generate"));
    },
  };
  return api;
}

export async function connect(fetch: typeof globalThis.fetch, overrides: Partial<LuwConfig> = {}, env: Record<string, string> = {}) {
  const config = loadConfig(env, {
    apiKey: "test-key",
    baseUrl: API,
    waitTimeoutSeconds: 5,
    pollIntervalMs: 5,
    inlineImages: false,
    ...overrides,
  });
  const server = createLuwServer(config, fetch);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    call: (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
  };
}

export function textOf(result: CallToolResult): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("\n");
}

export const processing = (id = "job_1", percent = 10) => ({
  status: true,
  processing: true,
  processing_url: id,
  progress: { state: "processing", percent },
});
