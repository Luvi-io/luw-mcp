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
import { registerResultViewer, withResultViewer } from "./widget.js";

function instructions(config: LuwConfig): string {
  const local = config.mode === "local";
  return [
    "Luw.ai: AI tools for interior, exterior and landscape design, architectural rendering, image editing, video and 3D.",
    local
      ? "Image inputs accept https:// URLs, local file paths or data: URIs; local files are uploaded to Luw.ai automatically."
      : "Image inputs are public https:// links or data: URIs; a photo attached in the chat goes in image_file. This hosted server can't read files on the user's computer.",
    `Generations wait up to ${config.waitTimeoutSeconds}s. A tool that returns a processing_url is still running; luw_get_result collects it and can be called again while it runs. Running the generation again would use credits twice.`,
    "Each generation uses credits from the user's Luw.ai account; variations multiply the cost.",
    "luw_list_options lists valid style, room type, camera motion and material names.",
    "To change one exact area, luw_segment returns a mask for luw_magic_wand or luw_landscape_design.",
    // Hosted clients sign in to Luw.ai instead of handling keys.
    ...(local ? [`Without an API key, calls fail with setup steps; keys are created at ${API_KEY_URL}.`] : []),
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
  // user attached in ChatGPT, and generation results open in the result viewer. With sign-in on, every tool
  // runs as the signed-in user: ChatGPT reads that from each tool's securitySchemes; the SDK only passes _meta through.
  type ToolConfig = { title?: string; description?: string; inputSchema?: Record<string, ZodType>; _meta?: Record<string, unknown> };
  type Callback = Parameters<typeof acceptAttachedPhoto>[2];
  const tools: ToolDoc[] = [];
  const signIn = config.mode === "remote" && Boolean(config.oauthSecret);
  const register = server.registerTool.bind(server) as (name: string, tool: ToolConfig, cb: Callback) => unknown;
  server.registerTool = ((name: string, tool: ToolConfig, cb: Callback) => {
    tools.push({ name, title: tool.title, description: tool.description });
    const remote = config.mode === "remote";
    const [attachable, call] = remote ? acceptAttachedPhoto(name, tool, cb) : [tool, cb];
    const spec = remote ? withResultViewer(name, attachable) : attachable;
    return register(name, signIn ? { ...spec, _meta: { ...spec._meta, securitySchemes: [{ type: "oauth2" }] } } : spec, call);
  }) as typeof server.registerTool;

  if (sets.has("generate")) {
    registerGenerateTools(server, deps);
    registerCoreTools(server, deps);
  }
  if (sets.has("archigpt")) registerArchiGptTool(server, deps);
  // The multi-action management tools are local-only: app directories (ChatGPT, Claude) list the hosted
  // server and reject a tool that picks its operation from an argument. Projects stay readable there as resources.
  const local = config.mode === "local";
  if (local && sets.has("personas")) registerPersonaTool(server, deps);
  if (local && sets.has("projects")) registerProjectTool(server, deps);
  if (sets.has("team")) registerTeamTool(server, deps);
  if (sets.has("generate")) registerPrompts(server);
  if (!local && sets.has("generate")) registerResultViewer(server);
  registerResources(server, deps, { instructions: instructions(config), tools });
  return server;
}
