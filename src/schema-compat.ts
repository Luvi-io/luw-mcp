import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type Schema = Record<string, unknown>;
type ListHandler = (request: unknown, extra: unknown) => Promise<{ tools: { inputSchema: Schema }[] }>;

/**
 * A tuple (`items` as a list, as Zod writes z.tuple for draft-07) becomes one item schema with the same length.
 * ChatGPT refuses a whole app over a single tuple in an input schema; arguments still validate against the tuple.
 */
export function flattenTuples(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(flattenTuples);
  if (!schema || typeof schema !== "object") return schema;
  const out: Schema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalItems") continue;
    out[key] = flattenTuples(value);
  }
  if (Array.isArray(out.items)) {
    const items = out.items as unknown[];
    const same = items.every((item) => JSON.stringify(item) === JSON.stringify(items[0]));
    out.items = same ? (items[0] ?? {}) : { anyOf: items };
    out.minItems ??= items.length;
    out.maxItems ??= items.length;
  }
  return out;
}

/** Lists every tool with its input schema in a form ChatGPT accepts (Claude and other clients read either). */
export function listToolsForChatGpt(server: McpServer): void {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, ListHandler> })._requestHandlers;
  const list = handlers?.get("tools/list");
  if (!handlers || !list) return;
  handlers.set("tools/list", async (request, extra) => {
    const result = await list(request, extra);
    return { ...result, tools: result.tools.map((tool) => ({ ...tool, inputSchema: flattenTuples(tool.inputSchema) as Schema })) };
  });
}
