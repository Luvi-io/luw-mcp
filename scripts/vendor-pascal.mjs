// Rebuilds vendor/pascal-app-{core,mcp}-<version>-luw.tgz from a Luw Studio checkout: Pascal's core and
// MCP as Luw Studio runs them (Pascal's MIT packages with Luw's patches, listed in its LUW.md), which the
// studio tools bundle. Run after Luw Studio merges Pascal or changes a core patch, then `npm install`.
//   node scripts/vendor-pascal.mjs <path to the luwstudio2 checkout>
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const studio = resolve(process.argv[2] ?? "../luwstudio2");
const vendor = resolve(new URL("../vendor", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

for (const name of ["core", "mcp"]) {
  const dir = join(studio, "packages", name);
  const { version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  run("bun", ["run", "build"], dir);
  for (const old of readdirSync(vendor).filter((f) => f.startsWith(`pascal-app-${name}-`))) rmSync(join(vendor, old));
  run("npm", ["pack", "--pack-destination", vendor], dir);
  renameSync(join(vendor, `pascal-app-${name}-${version}.tgz`), join(vendor, `pascal-app-${name}-${version}-luw.tgz`));
  console.log(`vendor/pascal-app-${name}-${version}-luw.tgz`);
}
console.log("Now point package.json at these files if the version changed, and run npm install.");
