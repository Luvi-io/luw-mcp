import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";
import { connect, fakeLuw } from "./helpers.js";

const read = async (path: string) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));

describe("release metadata", () => {
  it("keeps package.json, server.json and manifest.json versions in sync", async () => {
    const [pkg, server, manifest] = await Promise.all([read("package.json"), read("server.json"), read("manifest.json")]);
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].version).toBe(pkg.version);
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.name).toBe(pkg.mcpName);
    expect(manifest.version).toBe(pkg.version);
    expect(VERSION).toBe(pkg.version);
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it("declares exactly the default tools in the Claude Desktop manifest", async () => {
    const manifest = await read("manifest.json");
    const { client } = await connect(fakeLuw().fetch);
    const registered = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(manifest.tools.map((t: { name: string }) => t.name).sort()).toEqual(registered);
  });
});
