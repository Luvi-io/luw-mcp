import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { errorMessage, LuwApiError, LuwClient, MissingApiKeyError } from "./client.js";
import type { LuwConfig } from "./config.js";
import { FileResolver, InputError } from "./files.js";

/** Long-lived dependencies shared by every tool call on a server instance. */
export interface Deps {
  config: LuwConfig;
  client: LuwClient;
  files: FileResolver;
  fetch: typeof fetch;
}

/** Per-call context handed to tool handlers. */
export interface ToolContext extends Deps {
  signal: AbortSignal;
  /** Reports 0-100 progress to clients that asked for it (no-op otherwise). */
  progress: (percent: number, message: string) => Promise<void>;
}

export type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
export type Server = McpServer;

/**
 * Adapts a handler to the SDK callback shape: builds the ToolContext and turns expected failures
 * (bad input, API errors, missing key) into readable `isError` results instead of protocol errors.
 */
export function handler<A>(deps: Deps, fn: (args: A, ctx: ToolContext) => Promise<CallToolResult>) {
  return async (args: A, extra: Extra): Promise<CallToolResult> => {
    const ctx: ToolContext = { ...deps, signal: extra.signal, progress: progressReporter(extra) };
    try {
      return await fn(args, ctx);
    } catch (error) {
      const expected = error instanceof LuwApiError || error instanceof InputError || error instanceof MissingApiKeyError;
      return {
        content: [{ type: "text", text: expected ? (error as Error).message : `Unexpected error: ${errorMessage(error)}` }],
        isError: true,
      };
    }
  };
}

function progressReporter(extra: Extra): ToolContext["progress"] {
  const token = extra._meta?.progressToken;
  if (token === undefined) return async () => {};
  let last = -1;
  return async (percent, message) => {
    // Progress must strictly increase; nudge it forward on every poll so clients see the job is alive.
    const value = Math.min(99, Math.max(percent, last + 0.5));
    if (value <= last) return;
    last = value;
    await extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: Number(value.toFixed(1)), total: 100, message },
      })
      .catch(() => {});
  };
}

export function createDeps(config: LuwConfig, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Deps {
  const client = new LuwClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    fetch: fetchImpl,
    missingKeyHint:
      config.mode === "remote"
        ? 'send it as an "Authorization: Bearer <key>" header when connecting to this server.'
        : "set LUW_API_KEY in the env section of your MCP client config and restart the client.",
  });
  return { config, client, files: new FileResolver(client, config.mode), fetch: fetchImpl };
}

export function text(value: string, structured?: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: value }], ...(structured ? { structuredContent: structured } : {}) };
}

const MAX_JSON_CHARS = 40_000;

/** JSON tool result, capped so a huge API response can't flood the client or the model's context. */
export function json(value: unknown): CallToolResult {
  const full = JSON.stringify(value, null, 1);
  if (full.length > MAX_JSON_CHARS) {
    return {
      content: [
        {
          type: "text",
          text: `${full.slice(0, MAX_JSON_CHARS)}\n… truncated (${full.length - MAX_JSON_CHARS} more characters). Narrow the request (search, profession, page/limit, or a specific id).`,
        },
      ],
    };
  }
  return {
    content: [{ type: "text", text: full }],
    ...(value && typeof value === "object" && !Array.isArray(value) ? { structuredContent: value as Record<string, unknown> } : {}),
  };
}
