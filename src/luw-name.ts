import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// What the Studio tools say goes out in Luw Studio's name. The vendored editor packages' prose names
// their own project ("Pascal refused 2 walls", "This Pascal server cannot run geometry scripts"): the
// word becomes Luw Studio's where tools, guides and results leave this server and the engine entry.
// The design schema's address is Luw's own resource here. A scene's ids say luw: where they say
// pascal: (installedPlugins' "pascal:trees"), as Luw.ai's share pages and API hand them out (Rails'
// studio_scene_out), and what a model sends back says pascal: again (studioIds) before a tool reads it.
// Other ids keep their spelling (pascalNodeId).

const SCHEMA = ["pascal://schema/design", "luw://studio/design-schema"] as const;
// An id: the prefix, then the id's own name ("pascal:trees"), not an address ("pascal://…") or prose.
const PASCAL_ID = /(^|")pascal:(?=[a-z0-9])/g;
const LUW_ID = /(^|")luw:(?=[a-z0-9])/g;

/** A text in Luw Studio's name. */
export function luwName(text: string): string {
  return text.replaceAll(SCHEMA[0], SCHEMA[1]).replace(PASCAL_ID, "$1luw:").replace(/\bPascal\b/g, "Luw Studio");
}

/** A text a model sent, in the scene's own ids. */
function studioId(text: string): string {
  return text.replace(LUW_ID, "$1pascal:");
}

/** `name` on every string and key of a JSON value; base64 (`data`, `blob`) stays as it is. */
function mapped<T>(value: T, name: (text: string) => string): T {
  if (typeof value === "string") return name(value) as T;
  if (Array.isArray(value)) return value.map((item) => mapped(item, name)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [name(key), key === "data" || key === "blob" ? item : mapped(item, name)]),
  ) as T;
}

/** luwName on every string (and every id-like key) in a JSON value. */
export function luwNamed<T>(value: T): T {
  return mapped(value, luwName);
}

/** A tool's input in the scene's own ids: what luwNamed handed out as luw:… is pascal:… again. */
export function studioIds<T>(value: T): T {
  return mapped(value, studioId);
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
