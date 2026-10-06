// Packs build/luw.mcpb — the one-click Claude Desktop extension. Run `npm run build` first.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const staging = new URL("build/mcpb/", root);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));

await rm(staging, { recursive: true, force: true });
await mkdir(new URL("server/", staging), { recursive: true });
// .mjs: the bundle is ESM and the extension folder has no package.json declaring "type": "module".
await copyFile(new URL("dist/cli.js", root), new URL("server/index.mjs", staging));
await copyFile(new URL("assets/icon.png", root), new URL("icon.png", staging));
await copyFile(new URL("LICENSE", root), new URL("LICENSE", staging));
await writeFile(new URL("manifest.json", staging), JSON.stringify({ ...manifest, version: pkg.version }, null, 2));

const out = new URL("build/luw.mcpb", root).pathname;
const mcpb = ["-y", "@anthropic-ai/mcpb@2.1.2"];
execFileSync("npx", [...mcpb, "validate", new URL("manifest.json", staging).pathname], { stdio: "inherit" });
execFileSync("npx", [...mcpb, "pack", staging.pathname, out], { stdio: "inherit" });
console.log(`\nPacked ${out}`);
