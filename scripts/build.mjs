// Bundles the server into a single dependency-free file so `npx @luw-ai/mcp` starts fast
// (nothing to install besides the package itself) and the .mcpb bundle needs no node_modules.
// A second bundle, dist/engine.js, is the scene tools without the server (src/engine, the package's
// "./engine" export), for a host that runs them on scenes it holds (luw-api), with its declarations
// in dist/engine.d.ts.
import { execFileSync } from "node:child_process";
import { copyFile, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
const cli = await build({ ...common, metafile: true, entryPoints: ["src/cli.ts"], outfile: "dist/cli.js", banner: { js: `#!/usr/bin/env node\n${requireShim}` } });
const engine = await build({ ...common, metafile: true, entryPoints: ["src/engine/index.ts"], outfile: "dist/engine.js", banner: { js: requireShim } });
await writeNotices([cli.metafile, engine.metafile]);

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

/**
 * dist/THIRD_PARTY_NOTICES.md: every package the bundles hold, with its license text, as their
 * licenses ask of a copy that carries their code (the bundles drop license comments). Read from what
 * esbuild put in, so it lists exactly what ships.
 */
async function writeNotices(metafiles) {
  const dirs = new Set();
  for (const meta of metafiles) {
    for (const input of Object.keys(meta.inputs)) {
      const match = input.replaceAll("\\", "/").match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
      if (match) dirs.add(match[1]);
    }
  }
  const entries = new Map();
  for (const dir of dirs) {
    const pkg = JSON.parse(await readFile(new URL(`${dir}/package.json`, root), "utf8"));
    const key = `${pkg.name}@${pkg.version}`;
    if (entries.has(key)) continue;
    const licenseFile = (await readdir(new URL(dir, root))).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
    const text = licenseFile ? (await readFile(new URL(`${dir}/${licenseFile}`, root), "utf8")).trim() : undefined;
    entries.set(key, { name: pkg.name, version: pkg.version, license: pkg.license, author: pkg.author, text });
  }
  // A package shipped without its license file takes its scope's (one project's packages share one),
  // else its license's name and author.
  for (const e of entries.values()) {
    if (e.text) continue;
    const scope = e.name.startsWith("@") ? e.name.split("/")[0] : undefined;
    const sibling = scope && [...entries.values()].find((o) => o.text && o.name.startsWith(`${scope}/`) && o.license === e.license);
    const author = typeof e.author === "string" ? e.author : e.author?.name;
    e.text = sibling ? sibling.text : `License: ${e.license ?? "see the package"}${author ? `, ${author}` : ""}`;
  }
  const body = [...entries.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => `## ${e.name} ${e.version}${e.license ? ` (${e.license})` : ""}\n\n\`\`\`\n${e.text}\n\`\`\`\n`)
    .join("\n");
  await writeFile(
    new URL("dist/THIRD_PARTY_NOTICES.md", root),
    `# Third-party notices\n\nThis package bundles the following open-source packages. Their licenses follow.\n\n${body}`,
  );
}
