// Rebuilds vendor/pascal-app-{core,mcp,nodes}-<version>-luw.tgz from a Luw Studio checkout: the editor's core,
// MCP and built-in kinds as Luw Studio runs them (the upstream MIT packages with Luw's patches, listed in its
// LUW.md), which the studio tools bundle. Run after Luw Studio merges the upstream editor or changes a patch, then
// `npm install`. The studio tools take only the kinds' agent tools (the kitchen's), which need core
// alone: the nodes tarball leaves out its peers (the editor, the viewer, React Three Fiber), which
// would only be installed, never bundled.
//   node scripts/vendor-editor.mjs <path to the luwstudio2 checkout>
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const studio = resolve(process.argv[2] ?? "../luwstudio2");
const vendor = resolve(new URL("../vendor", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

for (const name of ["core", "mcp", "nodes"]) {
  const dir = join(studio, "packages", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  run("bun", ["run", "build"], dir);
  for (const old of readdirSync(vendor).filter((f) => f.startsWith(`pascal-app-${name}-`))) rmSync(join(vendor, old));
  let packDir = dir;
  if (name === "nodes") {
    packDir = join(vendor, ".nodes-stage");
    rmSync(packDir, { recursive: true, force: true });
    mkdirSync(packDir, { recursive: true });
    const { peerDependencies: _peers, peerDependenciesMeta: _meta, devDependencies: _dev, scripts: _scripts, ...rest } = pkg;
    writeFileSync(join(packDir, "package.json"), `${JSON.stringify(rest, null, 2)}
`);
    cpSync(join(dir, "dist"), join(packDir, "dist"), { recursive: true });
    cpSync(join(dir, "README.md"), join(packDir, "README.md"));
  }
  run("npm", ["pack", "--pack-destination", vendor], packDir);
  if (packDir !== dir) rmSync(packDir, { recursive: true, force: true });
  renameSync(join(vendor, `pascal-app-${name}-${pkg.version}.tgz`), join(vendor, `pascal-app-${name}-${pkg.version}-luw.tgz`));
  console.log(`vendor/pascal-app-${name}-${pkg.version}-luw.tgz`);
}
// npm reuses a cached tarball whose integrity the lockfile holds, so a plain `npm install` keeps the old
// build when the version did not change: install the files themselves, which records their new integrity.
console.log("Now point package.json at these files if the version changed, and run:");
console.log("  npm install --save-dev ./vendor/pascal-app-core-<version>-luw.tgz ./vendor/pascal-app-mcp-<version>-luw.tgz ./vendor/pascal-app-nodes-<version>-luw.tgz");
