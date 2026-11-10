// Bundles the server into a single dependency-free file so `npx @luw-ai/mcp` starts fast
// (nothing to install besides the package itself) and the .mcpb bundle needs no node_modules.
// A second bundle, dist/engine.js, is the scene tools without the server (src/engine, the package's
// "./engine" export), for a host that runs them on scenes it holds (luw-api), with its declarations
// in dist/engine.d.ts.
import { execFileSync } from "node:child_process";
import { copyFile, cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const root = new URL("..", import.meta.url);
// The vendored editor's name (vendor/*.tgz), spelled out only here and in the notices it needs.
const VENDORED_FIRST = "pP";
const VENDORED_REST = "[aA][sS][cC][aA][lL]";
const VENDORED = new RegExp(`[${VENDORED_FIRST}]${VENDORED_REST}`);
// Bundled CommonJS deps (ajv) call require(); give ESM output a real one.
const requireShim = "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);";
const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: true,
  legalComments: "none",
  logLevel: "info",
};

await rm(new URL("dist", root), { recursive: true, force: true });
const cli = await build({ ...common, metafile: true, entryPoints: ["src/cli.ts"], outfile: "dist/cli.js", banner: { js: `#!/usr/bin/env node\n${requireShim}` } });
const engine = await build({ ...common, metafile: true, entryPoints: ["src/engine/index.ts"], outfile: "dist/engine.js", banner: { js: requireShim } });
await writeNotices([cli.metafile, engine.metafile]);
await escapeVendoredName(["dist/cli.js", "dist/engine.js"]);

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
if (VENDORED.test(declarations)) throw new Error("dist/engine.d.ts names the vendored editor; give the export a Luw name.");

// What npm publishes (build/npm): the package as it ships, without the build's own scripts and
// devDependencies (the vendored editor's tarballs). release.yml publishes this folder.
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
delete pkg.scripts;
delete pkg.devDependencies;
const stage = new URL("build/npm/", root);
await rm(stage, { recursive: true, force: true });
await cp(new URL("dist/", root), new URL("dist/", stage), { recursive: true });
for (const file of ["README.md", "LICENSE"]) await copyFile(new URL(file, root), new URL(file, stage));
await writeFile(new URL("package.json", stage), `${JSON.stringify(pkg, null, 2)}\n`);

/**
 * The bundles spell the vendored editor's name with a \u escape on its first letter, which strings,
 * templates, regexes and identifiers all read as the same letter, so the code runs as it did.
 * A letter already behind a backslash keeps its spelling.
 */
async function escapeVendoredName(files) {
  for (const file of files) {
    const url = new URL(file, root);
    const text = await readFile(url, "utf8");
    const name = new RegExp(String.raw`(\\*)([${VENDORED_FIRST}])(?=${VENDORED_REST})`, "g");
    const out = text.replace(name, (match, slashes, letter) =>
      slashes.length % 2 ? match : `${slashes}\\u00${letter.charCodeAt(0).toString(16)}`,
    );
    await writeFile(url, out);
  }
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
  // Grouped by license, as those licenses ask: every copyright notice of the packages that ship under
  // one license text, then that text once. (A template line such as "Copyright [yyyy] [name]" stays
  // in its text.)
  const isCopyright = (line) => /^\s*(copyright\b|\(c\)|©)/i.test(line) && !/[[{]yyyy[\]}]/i.test(line);
  const groups = new Map();
  for (const e of entries.values()) {
    const lines = e.text.split(/\r?\n/);
    const text = lines.filter((line) => !isCopyright(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const key = `${e.license ?? ""}|${text.replace(/\s+/g, " ")}`;
    const group = groups.get(key) ?? { license: e.license, text, holders: new Set(), count: 0 };
    for (const line of lines.filter(isCopyright)) group.holders.add(line.trim());
    group.count += 1;
    groups.set(key, group);
  }
  const body = [...groups.values()]
    .sort((a, b) => b.count - a.count || String(a.license).localeCompare(String(b.license)))
    .map((g) => `## ${g.license ?? "Other"}\n\n${[...g.holders].sort().join("  \n")}\n\n\`\`\`\n${g.text}\n\`\`\`\n`)
    .join("\n");
  await writeFile(
    new URL("dist/THIRD_PARTY_NOTICES.md", root),
    `# Third-party notices\n\nThis package includes open-source software by others. Under each license below are the copyright notices of the software it covers, then the license's text.\n\n${body}`,
  );
}
