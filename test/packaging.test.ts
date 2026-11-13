import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";
import { connect, fakeLuw } from "./helpers.js";

const read = async (path: string) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));

describe("release metadata", () => {
  it("keeps package.json, server.json, manifest.json and plugin versions in sync", async () => {
    const [pkg, server, studio, manifest, gemini, claudePlugin] = await Promise.all([
      read("package.json"),
      read("server.json"),
      read("server.studio.json"),
      read("manifest.json"),
      read("gemini-extension.json"),
      read("plugins/luw/.claude-plugin/plugin.json"),
    ]);
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].version).toBe(pkg.version);
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.name).toBe(pkg.mcpName);
    expect(manifest.version).toBe(pkg.version);
    expect(gemini.version).toBe(pkg.version);
    expect(claudePlugin.version).toBe(pkg.version);
    expect(VERSION).toBe(pkg.version);
    expect(server.description.length).toBeLessThanOrEqual(100);
    // The Studio endpoint's own registry entry (ai.luw/studio)
    expect(studio.version).toBe(pkg.version);
    expect(studio.description.length).toBeLessThanOrEqual(100);
  });

  it("exports the engine entry the build writes, and keeps the CLI as the bin", async () => {
    const [pkg, build] = await Promise.all([read("package.json"), readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8")]);
    expect(pkg.bin).toEqual({ "luw-mcp": "dist/cli.js" });
    expect(pkg.exports["./engine"]).toEqual({ types: "./dist/engine.d.ts", import: "./dist/engine.js" });
    expect(pkg.files).toContain("dist");
    expect(build).toContain('outfile: "dist/engine.js"');
    expect(build).toContain('"dist/engine.d.ts"');
  });

  it("declares exactly the default tools in the Claude Desktop manifest", async () => {
    const manifest = await read("manifest.json");
    const { client } = await connect(fakeLuw().fetch);
    const registered = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(manifest.tools.map((t: { name: string }) => t.name).sort()).toEqual(registered);
  });
});
