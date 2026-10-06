import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { API_KEY_URL, loadConfig, TOOLSETS, VERSION } from "./config.js";
import { startHttpServer } from "./http.js";
import { createLuwServer } from "./server.js";

const HELP = `Luw.ai MCP server v${VERSION}

Usage:
  npx -y @luw-ai/mcp                 Run over stdio (for Claude, Cursor, VS Code, …)
  npx -y @luw-ai/mcp --http          Run a hosted Streamable HTTP endpoint at /mcp

Options:
  --http            Serve Streamable HTTP instead of stdio. Each request authenticates
                    with its own "Authorization: Bearer <LUW_API_KEY>" header.
  --port <n>        HTTP port (default: $PORT or 8787)
  --host <addr>     HTTP bind address (default: $HOST or 127.0.0.1)
  -v, --version     Print version
  -h, --help        Show this help

Environment:
  LUW_API_KEY                 Your Luw.ai API key (stdio mode) — ${API_KEY_URL}
  LUW_TOOLSETS                Comma list of ${TOOLSETS.join(", ")} or "all"
                              (default: everything except team)
  LUW_WAIT_TIMEOUT_SECONDS    Max seconds a call waits for a generation (default 50)
  LUW_OUTPUT_DIR              Also download results into this folder (stdio mode)
  LUW_INLINE_IMAGES           Embed result images in tool output (default true)
  LUW_API_BASE_URL            Override the API base URL (default https://api.luw.ai/v2)
`;

async function main() {
  const { values } = parseArgs({
    options: {
      http: { type: "boolean" },
      port: { type: "string" },
      host: { type: "string" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.help) return void process.stdout.write(HELP);
  if (values.version) return void process.stdout.write(`${VERSION}\n`);

  if (values.http) {
    const port = Number.parseInt(values.port ?? process.env.PORT ?? "8787", 10);
    const host = values.host ?? process.env.HOST ?? "127.0.0.1";
    // Hosted mode never uses a key from the environment: callers bring their own.
    startHttpServer({ config: loadConfig({ ...process.env, LUW_API_KEY: "", LUW_API_TOKEN: "" }, { mode: "remote" }), port, host });
    return;
  }

  const config = loadConfig();
  const server = createLuwServer(config);
  await server.connect(new StdioServerTransport());
  console.error(
    `Luw.ai MCP server v${VERSION} running on stdio` + (config.apiKey ? "" : ` — no LUW_API_KEY set; get one at ${API_KEY_URL}`),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
