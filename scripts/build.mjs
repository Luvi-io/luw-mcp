// Bundles the server into a single dependency-free file so `npx @luw-ai/mcp` starts fast
// (nothing to install besides the package itself) and the .mcpb bundle needs no node_modules.
import { readFile, rm } from "node:fs/promises";
import { build } from "esbuild";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  minifySyntax: true,
  legalComments: "none",
  define: { __LUW_MCP_VERSION__: JSON.stringify(pkg.version) },
  banner: {
    // Bundled CommonJS deps (ajv) call require(); give ESM output a real one.
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});
