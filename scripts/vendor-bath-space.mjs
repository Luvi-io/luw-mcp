// Copies the node schemas of Bath Space (@pascal-app/plugin-bath-space, MIT, sudhir9297/pascal-cluster), the
// bathroom plugin Luw Studio installs, into src/studio/bath-space: Luw Studio's bathroom_add parses its fixtures
// with them (nodeRegistry.get(kind).schema), and src/studio/bath-space/register.ts registers them. Only the
// schemas: the plugin's renderers, tools and panels need the editor. Run after Luw Studio pins a new Bath Space.
//   node scripts/vendor-bath-space.mjs <path to the luwstudio2 checkout>
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const studio = resolve(process.argv[2] ?? "../luwstudio2");
const plugin = join(studio, "node_modules", "@pascal-app", "plugin-bath-space");
const out = resolve(new URL("../src/studio/bath-space/vendor", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const pin = JSON.parse(readFileSync(join(studio, "apps", "editor", "package.json"), "utf8")).dependencies["@pascal-app/plugin-bath-space"];
const { version, license } = JSON.parse(readFileSync(join(plugin, "package.json"), "utf8"));

// The fixtures bathroom_add makes, and the files their schemas import.
const FILES = [
  "bathtub/schema.ts",
  "countertop-basin/schema.ts",
  "floor-standing-toilet/schema.ts",
  "flush-control/schema.ts",
  "freestanding-vanity/schema.ts",
  "hand-shower/schema.ts",
  "mirror/schema.ts",
  "shower-arm/schema.ts",
  "shower-control/schema.ts",
  "shower-divider/schema.ts",
  "shower-head/schema.ts",
  "shower-hose/schema.ts",
  "shower-mount/schema.ts",
  "taps/schema.ts",
  "taps/details.ts",
  "taps/presets.ts",
  "toilet-paper-holder/schema.ts",
  "towel-rail/schema.ts",
  "wall-hung-toilet/schema.ts",
];

rmSync(out, { recursive: true, force: true });
for (const file of FILES) {
  let source = readFileSync(join(plugin, "src", file), "utf8");
  // The bath's drain position helper lives with its geometry; the schema only re-exports it.
  source = source.replace(/^export \{ bathDrainX \} from '\.\/drain'\n/m, "");
  // NodeNext: relative imports name their .js file.
  source = source.replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)(['"])/g, (_, a, path, b) => `${a}${path.endsWith(".js") ? path : `${path}.js`}${b}`);
  const header = `// Vendored from @pascal-app/plugin-bath-space ${version} (${license}, ${pin}) by scripts/vendor-bath-space.mjs.\n// Do not edit: run the script again.\n`;
  const target = join(out, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, header + source);
  console.log(`src/studio/bath-space/vendor/${file}`);
}
