import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodType } from "zod";
import { acceptAttachedPhoto } from "./attachments.js";
import { API_KEY_URL, SERVER_NAME, VERSION, type LuwConfig } from "./config.js";
import { createDeps } from "./context.js";
import { registerPrompts } from "./prompts.js";
import { registerResources, type ToolDoc } from "./resources.js";
import { registerArchiGptTool } from "./tools/archigpt.js";
import { registerCoreTools } from "./tools/core.js";
import { registerGenerateTools } from "./tools/generate.js";
import { registerPersonaTool, registerProjectTool, registerTeamTool } from "./tools/workspace.js";

function instructions(config: LuwConfig): string {
  const inputs =
    config.mode === "local"
      ? "Image inputs accept https:// URLs, local file paths or data: URIs — local files are uploaded to Luw.ai automatically."
      : "Image inputs must be public https:// URLs or data: URIs (this hosted server can't read the user's local files); in ChatGPT, pass a photo the user attached as image_file.";
  return [
    "Luw.ai: AI tools for interior, exterior and landscape design, architectural rendering, image editing, video and 3D.",
    inputs,
    `Generations wait up to ${config.waitTimeoutSeconds}s. If a tool returns a processing_url instead of a result, call luw_get_result with it (repeat while it is still processing). Never re-run the generation — that spends credits again.`,
    "Every generation spends the user's Luw.ai credits (variations multiply the cost); prefer 1 variation unless the user asks for options.",
    "Use luw_list_options to get valid style, room type, camera motion and material names.",
    "To change one exact area: luw_segment to get a mask, then luw_magic_wand (replace/remove/material) or luw_landscape_design.",
    `Without an API key, calls fail with setup steps; keys are created at ${API_KEY_URL}.`,
  ].join("\n");
}

/** Builds a fully configured Luw.ai MCP server (one per stdio process, or one per hosted HTTP request). */
export function createLuwServer(config: LuwConfig, fetchImpl?: typeof fetch): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: "Luw.ai",
      version: VERSION,
      websiteUrl: "https://luw.ai",
      icons: [{ src: "https://luvicdn.net/img/luwai-10db78ea2bd139927f8b4f6c2ad1620c/lw-favicon.png?w=256&fm=png", mimeType: "image/png", sizes: ["256x256"] }],
    },
    { instructions: instructions(config), capabilities: { logging: {} } },
  );
  const deps = createDeps(config, fetchImpl);
  const sets = config.toolsets;

  // Records each tool for the luw://guide resource. On the hosted server, photo tools also accept a file the
  // user attached in ChatGPT. With sign-in on, every tool runs as the signed-in user: ChatGPT reads that from
  // each tool's securitySchemes; the SDK only passes _meta through.
  type ToolConfig = { title?: string; description?: string; inputSchema?: Record<string, ZodType>; _meta?: Record<string, unknown> };
  type Callback = Parameters<typeof acceptAttachedPhoto>[2];
  const tools: ToolDoc[] = [];
  const signIn = config.mode === "remote" && Boolean(config.oauthSecret);
  const register = server.registerTool.bind(server) as (name: string, tool: ToolConfig, cb: Callback) => unknown;
  server.registerTool = ((name: string, tool: ToolConfig, cb: Callback) => {
    tools.push({ name, title: tool.title, description: tool.description });
    const [spec, call] = config.mode === "remote" ? acceptAttachedPhoto(name, tool, cb) : [tool, cb];
    return register(name, signIn ? { ...spec, _meta: { ...spec._meta, securitySchemes: [{ type: "oauth2" }] } } : spec, call);
  }) as typeof server.registerTool;

  if (sets.has("generate")) {
    registerGenerateTools(server, deps);
    registerCoreTools(server, deps);
  }
  if (sets.has("archigpt")) registerArchiGptTool(server, deps);
  if (sets.has("personas")) registerPersonaTool(server, deps);
  if (sets.has("projects")) registerProjectTool(server, deps);
  if (sets.has("team")) registerTeamTool(server, deps);
  if (sets.has("generate")) registerPrompts(server);
  registerResources(server, deps, { instructions: instructions(config), tools });
  return server;
}
