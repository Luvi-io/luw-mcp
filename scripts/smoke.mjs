// Live end-to-end check against the real Luw.ai API through the built server (npm run build first).
//   LUW_API_KEY=... npm run smoke            free checks only (lookups, upload)
//   LUW_API_KEY=... npm run smoke -- --paid  also runs one Interior AI generation (1 credit)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const paid = process.argv.includes("--paid");
if (!process.env.LUW_API_KEY) {
  console.error("Set LUW_API_KEY first (https://app.luw.ai/dashboard/api).");
  process.exit(1);
}

const client = new Client({ name: "luw-smoke", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js"], env: { ...process.env, LUW_INLINE_IMAGES: "false" }, stderr: "inherit" }),
);

let failed = false;
async function step(name, tool, args, check = () => true) {
  const started = Date.now();
  try {
    const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 600_000 });
    const text = result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const ok = !result.isError && check(result, text);
    failed ||= !ok;
    console.log(`${ok ? "✔" : "✘"} ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)\n  ${text.split("\n").slice(0, 4).join("\n  ")}`);
    return result;
  } catch (error) {
    failed = true;
    console.log(`✘ ${name}: ${error.message}`);
  }
}

const sample = "https://luvicdn.com/assets/luw_styles/zen.png";
await step("design styles (public)", "luw_list_options", { kind: "design_styles", search: "zen" }, (_, t) => /Zen/.test(t));
await step("materials", "luw_list_options", { kind: "materials", search: "oak" });
await step("personas (auth check)", "luw_personas", { action: "list", limit: 3 });
await step("personas by profession (server paging)", "luw_personas", { action: "list", profession: "Interior", limit: 3 });
const tiny = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
await step("upload (temporary)", "luw_upload_file", { source: tiny }, (r) => /^https:\/\//.test(r.structuredContent?.url ?? ""));

if (paid) {
  const run = await step("Interior AI generation (1 credit)", "luw_interior_design", { image: sample, styles: ["Japandi"], room_type: "Living Room" });
  const pending = run?.structuredContent?.processing_urls?.[0];
  if (pending) await step("collect pending result", "luw_get_result", { processing_url: pending });
}

await client.close();
process.exit(failed ? 1 : 0);
