// Bundles the server into a single dependency-free file so `npx @luw-ai/mcp` starts fast
// (nothing to install besides the package itself) and the .mcpb bundle needs no node_modules.
// A second bundle, dist/engine.js, is the scene tools without the server (src/engine, the package's
// "./engine" export), for a host that runs them on scenes it holds (luw-api), with its declarations
// in dist/engine.d.ts.
import { execFileSync } from "node:child_process";
import { copyFile, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = new URL("..", import.meta.url);
// Bundled CommonJS deps (ajv) call require(); give ESM output a real one.
const requireShim = "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);";
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minifySyntax: true,
  legalComments: "none",
  logLevel: "info",
};

await rm(new URL("dist", root), { recursive: true, force: true });
await build({ ...common, entryPoints: ["src/cli.ts"], outfile: "dist/cli.js", banner: { js: `#!/usr/bin/env node\n${requireShim}` } });
await build({ ...common, entryPoints: ["src/engine/index.ts"], outfile: "dist/engine.js", banner: { js: requireShim } });

// The engine's declarations: every type it exports is declared in src/engine/index.ts, so its .d.ts
// stands alone. tsc writes the whole tree's into a scratch folder; only that file is kept.
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-p", "tsconfig.engine.json"], { cwd: root, stdio: "inherit" });
await copyFile(new URL("dist/.types/engine/index.d.ts", root), new URL("dist/engine.d.ts", root));
await rm(new URL("dist/.types", root), { recursive: true, force: true });
const declarations = await readFile(new URL("dist/engine.d.ts", root), "utf8");
if (/^\s*(import|export \* from|export \{[^}]*\} from)/m.test(declarations)) {
  throw new Error("dist/engine.d.ts refers to other files; declare every exported type in src/engine/index.ts.");
}
