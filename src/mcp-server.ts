import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { API_KEY_URL, SERVER_NAME, VERSION, type LuwConfig } from "./config.js";
import { createDeps } from "./context.js";
import { registerPrompts } from "./prompts.js";
import { registerArchiGptTool } from "./tools/archigpt.js";
import { registerCoreTools } from "./tools/core.js";
import { registerGenerateTools } from "./tools/generate.js";
import { registerPersonaTool, registerProjectTool, registerTeamTool } from "./tools/workspace.js";

function instructions(config: LuwConfig): string {
  const inputs =
    config.mode === "local"
      ? "Image inputs accept https:// URLs, local file paths or data: URIs — local files are uploaded to Luw.ai automatically."
      : "Image inputs must be public https:// URLs or data: URIs (this hosted server can't read the user's local files).";
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
      icons: [{ src: "https://luvicdn.net/img/luwai-10db78ea2bd139927f8b4f6c2ad1620c/lw-favicon.png?w=256&auto=format", mimeType: "image/png", sizes: ["256x256"] }],
    },
    { instructions: instructions(config), capabilities: { logging: {} } },
  );
  const deps = createDeps(config, fetchImpl);
  const sets = config.toolsets;

  if (sets.has("generate")) {
    registerGenerateTools(server, deps);
    registerCoreTools(server, deps);
  }
  if (sets.has("archigpt")) registerArchiGptTool(server, deps);
  if (sets.has("personas")) registerPersonaTool(server, deps);
  if (sets.has("projects")) registerProjectTool(server, deps);
  if (sets.has("team")) registerTeamTool(server, deps);
  if (sets.has("generate")) registerPrompts(server);
  return server;
}
