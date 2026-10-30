import { CallToolRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RETIRED_MCP_TOOLS, retiredToolRefusal } from "@pascal-app/core/agent-tools";
import type { Server } from "../context.js";

type CallHandler = (request: unknown, extra: unknown) => Promise<unknown>;

/**
 * Pascal's answerRetiredTools for this server: a call to a tool Pascal retired gets `tool_retired`
 * with the tool that replaced it and how to use that one, where the SDK would answer an unknown name
 * with a bare error. Pascal's own copy is written for the MCP SDK v2, whose handlers are keyed by the
 * method's name; v1 takes the request's schema. Install it once the tools are registered.
 */
export function answerRetiredTools(server: Server, retired = RETIRED_MCP_TOOLS) {
  const handlers = (server.server as unknown as { _requestHandlers: Map<string, CallHandler> })._requestHandlers;
  const original = handlers.get("tools/call");
  if (!original) return;
  server.server.removeRequestHandler("tools/call");
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name } = request.params;
    if (!Object.hasOwn(retired, name)) return (await original(request, extra)) as CallToolResult;
    const { error, ...answer } = retiredToolRefusal(name, retired[name]!);
    return { content: [{ type: "text", text: JSON.stringify({ error, ...answer }) }], isError: true };
  });
}
