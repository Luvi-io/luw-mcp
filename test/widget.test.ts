import { describe, expect, it } from "vitest";
import { RESULT_VIEWER_URI } from "../src/widget.js";
import { connect, fakeLuw, textOf } from "./helpers.js";

const HTML_MIME = "text/html;profile=mcp-app";

describe("result viewer", () => {
  it("links every generation tool and luw_get_result to the viewer on the hosted server", async () => {
    const { client } = await connect(fakeLuw().fetch, { mode: "remote" });
    const tools = (await client.listTools()).tools;
    const viewer = (name: string) => (tools.find((t) => t.name === name)!._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri;
    for (const name of ["luw_interior_design", "luw_generate_video", "luw_upscale_image", "luw_get_result"]) {
      expect(viewer(name)).toBe(RESULT_VIEWER_URI);
      expect(tools.find((t) => t.name === name)!._meta?.["openai/outputTemplate"]).toBe(RESULT_VIEWER_URI);
    }
    expect(viewer("luw_list_options")).toBeUndefined();
    expect(viewer("luw_archigpt")).toBeUndefined();

    const local = (await (await connect(fakeLuw().fetch)).client.listTools()).tools;
    expect(local.find((t) => t.name === "luw_interior_design")!._meta).toBeUndefined();
  });

  it("serves the viewer as an MCP Apps resource that may only load Luw.ai media", async () => {
    const { client } = await connect(fakeLuw().fetch, { mode: "remote" });
    expect((await client.listResources()).resources.map((r) => r.uri)).toContain(RESULT_VIEWER_URI);

    const [content] = (await client.readResource({ uri: RESULT_VIEWER_URI })).contents as unknown as [{ mimeType: string; text: string; _meta: any }];
    expect(content.mimeType).toBe(HTML_MIME);
    expect(content._meta.ui.domain).toBe("https://mcp.luw.ai");
    expect(content._meta.ui.csp.connectDomains).toEqual([]);
    expect(content._meta.ui.csp.resourceDomains).toContain("https://i.luvicdn.com");
    expect(content._meta.ui.csp.resourceDomains.every((d: string) => d.startsWith("https://") && !d.includes("*"))).toBe(true);

    // The script lives in a TypeScript template string: make sure the escaping still yields valid JavaScript.
    const script = /<script>([\s\S]*)<\/script>/.exec(content.text)![1]!;
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain("ui/initialize");
    expect(script).toContain("ui/notifications/tool-result");
  });

  it("is not served by the local server, which clients show inline already", async () => {
    const { client } = await connect(fakeLuw().fetch);
    expect((await client.listResources()).resources.map((r) => r.uri)).not.toContain(RESULT_VIEWER_URI);
  });

  it("gives the viewer the input image for before/after, and marks textures for tiling", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://i.luvicdn.com/luwai/1/out.png" }));
    const { call } = await connect(luw.fetch, { mode: "remote" });

    const redesign = await call("luw_interior_design", { image: "https://luvicdn.net/img/room.jpg", styles: ["Scandinavian"] });
    expect(redesign.structuredContent).toMatchObject({ status: "completed", outputs: ["https://i.luvicdn.com/luwai/1/out.png"], source: "https://luvicdn.net/img/room.jpg" });

    const pattern = await call("luw_generate_pattern", { prompt: "blue zellige tiles" });
    expect(pattern.structuredContent).toMatchObject({ tile: true });
    expect(pattern.structuredContent).not.toHaveProperty("source");

    // Fluw makes a new picture: its guide image isn't a "before".
    const fluw = await call("luw_generate_image", { prompt: "a villa", image: "https://luvicdn.net/img/guide.jpg" });
    expect(fluw.structuredContent).not.toHaveProperty("source");
  });

  it("keeps the before/after for jobs collected later with luw_get_result", async () => {
    const luw = fakeLuw()
      .on("POST", "/generate", () => ({ status: true, processing: true, processing_url: "job_9", progress: { state: "processing", percent: 10 } }))
      .on("POST", "/results", () => ({ status: true, processing: true, processing_url: "job_9", progress: { state: "processing", percent: 50 } }), 1)
      .on("POST", "/results", () => ({ status: true, output: "https://i.luvicdn.com/luwai/1/render.png" }));
    const { call } = await connect(luw.fetch, { mode: "remote", waitTimeoutSeconds: 0 });

    const pending = await call("luw_sketch_to_render", { image: "https://luvicdn.net/img/sketch.png" });
    expect(pending.structuredContent).toMatchObject({ status: "processing", processing_urls: ["job_9"], source: "https://luvicdn.net/img/sketch.png" });
    expect(textOf(pending)).toContain("processing_url and source_image https://luvicdn.net/img/sketch.png");

    const done = await call("luw_get_result", { processing_url: "job_9", source_image: "https://luvicdn.net/img/sketch.png" });
    expect(done.structuredContent).toMatchObject({ status: "completed", outputs: ["https://i.luvicdn.com/luwai/1/render.png"], source: "https://luvicdn.net/img/sketch.png" });
  });

  it("tells the model the result is already on screen, so its reply doesn't add another image", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://i.luvicdn.com/luwai/1/out.png" }));
    const remote = await connect(luw.fetch, { mode: "remote" });
    const result = await remote.call("luw_interior_design", { image: "https://luvicdn.net/img/room.jpg" });
    expect(textOf(result)).toMatch(/^The user already sees this result in the Luw\.ai viewer/);
    expect(textOf(result)).toContain("https://i.luvicdn.com/luwai/1/out.png");

    const local = await connect(luw.fetch);
    expect(textOf(await local.call("luw_interior_design", { image: "https://luvicdn.net/img/room.jpg" }))).not.toContain("Luw.ai viewer");
  });
});
