import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// What the Studio tools say goes out in Luw Studio's name. The vendored editor packages' prose names
// their own project ("Pascal refused 2 walls", "This Pascal server cannot run geometry scripts"): the
// word becomes Luw Studio's where tools, guides and results leave this server and the engine entry.
// Ids a model sends back keep their spelling (pascal:core, pascalNodeId): only the capitalised word
// changes, and the design schema's address, which is Luw's own resource here.

/** A text in Luw Studio's name. */
export function luwName(text: string): string {
  return text.replaceAll("pascal://schema/design", "luw://studio/design-schema").replace(/\bPascal\b/g, "Luw Studio");
}

/** luwName on every string in a JSON value; keys and base64 (`data`, `blob`) stay as they are. */
export function luwNamed<T>(value: T): T {
  if (typeof value === "string") return luwName(value) as T;
  if (Array.isArray(value)) return value.map(luwNamed) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, key === "data" || key === "blob" ? item : luwNamed(item)]),
  ) as T;
}

type Handler = (request: { params?: { name?: unknown } }, extra: unknown) => Promise<unknown>;

/**
 * The MCP server's tool list, and what its scene tools answer (results, refusals and the SDK's input
 * errors), in Luw Studio's name: after the SDK checked a result against its output schema, so a listed
 * schema and the result it describes say the same. Luw's own tools (luw_*) answer as they are: what they
 * return is the user's (project names, ArchiGPT's replies). Install it once every tool is registered.
 */
export function answerInLuwName(server: McpServer): void {
  const handlers = (server.server as unknown as { _requestHandlers: Map<string, Handler> })._requestHandlers;
  const list = handlers.get("tools/list");
  const call = handlers.get("tools/call");
  if (list) handlers.set("tools/list", async (request, extra) => luwNamed(await list(request, extra)));
  if (call) {
    handlers.set("tools/call", async (request, extra) => {
      const result = await call(request, extra);
      return String(request.params?.name).startsWith("luw_") ? result : luwNamed(result);
    });
  }
}
