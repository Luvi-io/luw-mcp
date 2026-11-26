import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, parseToolsets } from "../src/config.js";
import { connect, fakeLuw, processing, textOf } from "./helpers.js";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("tool registry", () => {
  it("exposes everything except team by default", async () => {
    const { client } = await connect(fakeLuw().fetch);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(24);
    expect(names).toContain("luw_interior_design");
    expect(names).not.toContain("luw_team");
    expect(names.every((n) => /^luw_[a-z0-9_]+$/.test(n))).toBe(true);
  });

  it("names each Luw.ai app in a tool description, so models map what users say to the right tool", async () => {
    // Models see descriptions, not titles: "use Magic Prompt" must land on luw_edit_image.
    const { client } = await connect(fakeLuw().fetch);
    const tools = (await client.listTools()).tools;
    const toolFor = (app: string) => tools.filter((t) => t.description?.includes(app)).map((t) => t.name);
    expect(toolFor("Interior AI")).toEqual(["luw_interior_design"]);
    expect(toolFor("Exterior AI")).toEqual(["luw_exterior_design"]);
    expect(toolFor("Sketch AI")).toEqual(["luw_sketch_to_render"]);
    expect(toolFor("Render AI")).toEqual(["luw_render"]);
    expect(toolFor("Magic Prompt AI")).toEqual(["luw_edit_image"]);
    expect(toolFor("Magic Wand AI")).toEqual(["luw_magic_wand"]);
    expect(toolFor("Landscape AI")).toEqual(["luw_landscape_design"]);
    expect(toolFor("Photo Enhance AI")).toEqual(["luw_upscale_image"]);
    expect(toolFor("Expand AI")).toEqual(["luw_expand_image"]);
    expect(toolFor("Remove Furniture AI")).toEqual(["luw_remove_furniture"]);
    expect(toolFor("Change Background")).toEqual(["luw_background"]);
    expect(toolFor("Fluw AI")).toEqual(["luw_generate_image"]);
    expect(toolFor("Pattern AI")).toEqual(["luw_generate_pattern"]);
    expect(toolFor("Video AI")).toEqual(["luw_generate_video"]);
    expect(toolFor("3DGen AI")).toEqual(["luw_image_to_3d"]);
    expect(toolFor("ArchiGPT")).toEqual(["luw_archigpt"]);
  });

  it("filters by LUW_TOOLSETS", async () => {
    const { client } = await connect(fakeLuw().fetch, {}, { LUW_TOOLSETS: "archigpt,team" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.sort()).toEqual(["luw_archigpt", "luw_team"]);
  });

  it("rejects unknown toolsets", () => {
    expect(() => parseToolsets("generate,nope")).toThrow(/nope/);
    expect(parseToolsets("all").size).toBe(6);
  });

  it("marks read-only tools", async () => {
    const { client } = await connect(fakeLuw().fetch);
    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === "luw_list_options")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "luw_interior_design")?.annotations?.readOnlyHint).toBe(false);
  });
});

describe("generation", () => {
  it("maps friendly params to the API and polls until done", async () => {
    const luw = fakeLuw()
      .on("POST", "/generate", () => processing("job_1", 5))
      .on("POST", "/results", () => processing("job_1", 60), 1)
      .on("POST", "/results", () => ({ status: true, output: "https://cdn.test/out.png" }));
    const { call } = await connect(luw.fetch);

    const result = await call("luw_interior_design", {
      image: "https://example.com/room.jpg",
      prompt: "warm and calm",
      styles: ["Japandi", "Minimalism"],
      room_type: "Living Room",
      empty_room: true,
      style_reference: "persona",
      persona_id: 42,
      reference_images: ["https://example.com/sofa.jpg"],
      engine: "symphony",
      enhance_prompt: true,
      precision: 75,
    });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("https://cdn.test/out.png");
    expect(result.structuredContent).toMatchObject({ status: "completed", outputs: ["https://cdn.test/out.png"] });

    const [gen] = luw.generates();
    expect(gen!.headers.get("authorization")).toBe("Bearer test-key");
    expect(gen!.json).toEqual({
      model: "interior",
      image: "https://example.com/room.jpg",
      prompt: "warm and calm",
      styles: "Japandi,Minimalism",
      knows: "Living Room",
      fill_room: "true",
      style_transfer: "persona",
      pid: 42,
      extra_image_1: "https://example.com/sofa.jpg",
      luwmodel: "symphony-3",
      enhance_prompt: "true",
      precise: 75,
    });
    const polls = luw.calls.filter((c) => c.url.pathname.endsWith("/results"));
    expect(polls).toHaveLength(2);
    expect(polls[0]!.json).toEqual({ processing_url: "job_1" });
  });

  it("runs variations in parallel with consecutive seeds", async () => {
    let n = 0;
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: `https://cdn.test/${++n}.png` }));
    const { call } = await connect(luw.fetch);
    const result = await call("luw_generate_image", { prompt: "a chair", variations: 3, seed: 10 });
    expect(luw.generates().map((g) => g.json.seed)).toEqual([10, 11, 12]);
    expect((result.structuredContent as any).outputs).toHaveLength(3);
  });

  it("offers seed only where Luw.ai uses one, and drops it quietly elsewhere", async () => {
    // The backend reads a seed only for text-to-image; older clients may still send one to other tools.
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/x.png" }));
    const { client, call } = await connect(luw.fetch);
    const withSeed = (await client.listTools()).tools.filter((t) => "seed" in (t.inputSchema.properties ?? {})).map((t) => t.name);
    expect(withSeed).toEqual(["luw_generate_image"]);
    const result = await call("luw_exterior_design", { image: "https://example.com/h.jpg", seed: 10 });
    expect(result.isError).toBeFalsy();
    expect(luw.generates()[0]!.json).not.toHaveProperty("seed");
  });

  it("hands back a processing_url when the wait runs out, and luw_get_result collects it", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => processing("vid_9", 3)).on("POST", "/results", () => processing("vid_9", 30), 1);
    const { call } = await connect(luw.fetch, { waitTimeoutSeconds: 0 });

    const pending = await call("luw_generate_video", { image: "https://example.com/r.jpg", camera_motion: "Flythrough Cinematic" });
    expect(pending.isError).toBeFalsy();
    expect(pending.structuredContent).toMatchObject({ status: "processing", processing_urls: ["vid_9"] });
    expect(textOf(pending)).toMatch(/luw_get_result/);
    expect(luw.generates()[0]!.json).toMatchObject({ model: "video", styles: "Flythrough Cinematic" });

    luw.on("POST", "/results", () => ({ status: true, output: "https://cdn.test/v.mp4" }));
    const done = await call("luw_get_result", { processing_url: "vid_9", wait: false });
    expect(done.structuredContent).toMatchObject({ status: "completed", outputs: ["https://cdn.test/v.mp4"] });
    expect(luw.generates()).toHaveLength(1);
  });

  it("sends Video AI's end_image only when one is given", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/v.mp4" }));
    const { call } = await connect(luw.fetch);

    await call("luw_generate_video", { image: "https://example.com/before.jpg", end_image: "https://example.com/after.jpg" });
    await call("luw_generate_video", { image: "https://example.com/before.jpg" });
    expect(luw.generates()[0]!.json).toMatchObject({ model: "video", image: "https://example.com/before.jpg", end_image: "https://example.com/after.jpg" });
    expect(luw.generates()[1]!.json).not.toHaveProperty("end_image");
  });

  it("explains credit and auth errors", async () => {
    const credits = fakeLuw().on("POST", "/generate", () => ({ status: false, insert_coin: true }));
    const r1 = await (await connect(credits.fetch)).call("luw_generate_image", { prompt: "a chair" });
    expect(r1.isError).toBe(true);
    expect(textOf(r1)).toMatch(/out of credits.*app\.luw\.ai\/pricing/);

    const auth = fakeLuw().on("POST", "/generate", () => ({ status: false, errors: { auth: ["Wrong credentials or expired token"] } }));
    const r2 = await (await connect(auth.fetch)).call("luw_generate_image", { prompt: "a chair" });
    expect(textOf(r2)).toMatch(/rejected the API key.*Wrong credentials/);
  });

  it("explains how to add a key when none is configured", async () => {
    const luw = fakeLuw();
    const { call } = await connect(luw.fetch, { apiKey: "" });
    const result = await call("luw_render", { image: "https://example.com/a.jpg" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/LUW_API_KEY/);
    expect(luw.calls).toHaveLength(0);
  });

  it("retries /generate on server errors with the same Idempotency-Key, so credits are never spent twice", async () => {
    const luw = fakeLuw()
      .on("POST", "/generate", () => new Response("boom", { status: 502 }), 1)
      .on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/ok.png" }));
    const result = await (await connect(luw.fetch)).call("luw_render", { image: "https://example.com/a.jpg" });
    expect(result.structuredContent).toMatchObject({ status: "completed" });
    const keys = luw.generates().map((g) => g.headers.get("idempotency-key"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^luw-mcp-[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("explains persistent server errors", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => new Response("boom", { status: 500 }));
    const result = await (await connect(luw.fetch)).call("luw_render", { image: "https://example.com/a.jpg" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/HTTP 500.*API key is invalid/);
    expect(luw.generates()).toHaveLength(3);
  });

  it("uses a fresh Idempotency-Key per variation", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/x.png" }));
    await (await connect(luw.fetch)).call("luw_interior_design", { image: "https://e.com/r.jpg", variations: 2 });
    const keys = luw.generates().map((g) => g.headers.get("idempotency-key"));
    expect(new Set(keys).size).toBe(2);
  });

  it("retries /generate on 429", async () => {
    const luw = fakeLuw()
      .on("POST", "/generate", () => new Response("slow down", { status: 429 }), 1)
      .on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/ok.png" }));
    const result = await (await connect(luw.fetch)).call("luw_render", { image: "https://example.com/a.jpg" });
    expect(result.structuredContent).toMatchObject({ status: "completed" });
    expect(luw.generates()).toHaveLength(2);
  });

  it("routes luw_background and luw_generate_image to the right model", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/x.png" }));
    const { call } = await connect(luw.fetch);
    await call("luw_background", { image: "https://example.com/p.jpg" });
    await call("luw_background", { image: "https://example.com/p.jpg", prompt: "on a marble counter" });
    await call("luw_generate_image", { prompt: "logo", format: "svg", aspect_ratio: "1:1" });
    await call("luw_upscale_image", { image: "https://example.com/p.jpg", scale: 4 });
    await call("luw_remove_furniture", { image: "https://example.com/p.jpg" });
    await call("luw_vectorize_image", { image: "https://example.com/p.jpg" });
    expect(luw.generates().map((g) => g.json)).toEqual([
      { model: "removebg", image: "https://example.com/p.jpg", luwmodel: "symphony-3" },
      { model: "changebg", image: "https://example.com/p.jpg", prompt: "on a marble counter", luwmodel: "symphony-3" },
      // Fluw Vector AI has no shape or seed setting, so neither is sent.
      { model: "fluwvector", prompt: "logo" },
      { model: "enhance", image: "https://example.com/p.jpg", hd: "4" },
      { model: "removefurniture", image: "https://example.com/p.jpg" },
      { model: "vector", image: "https://example.com/p.jpg" },
    ]);
  });

  it("asks Magic Prompt for 4K with uhd=1, the switch the backend reads", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/x.png" }));
    const { call } = await connect(luw.fetch);
    await call("luw_edit_image", { image: "https://example.com/p.jpg", prompt: "night scene", resolution: "4k" });
    await call("luw_edit_image", { image: "https://example.com/p.jpg", prompt: "night scene", resolution: "2k" });
    expect(luw.generates().map((g) => g.json)).toEqual([
      { model: "magicprompt", image: "https://example.com/p.jpg", prompt: "night scene", luwmodel: "symphony-3", uhd: 1 },
      { model: "magicprompt", image: "https://example.com/p.jpg", prompt: "night scene", luwmodel: "symphony-3" },
    ]);
  });

  it("asks Render, Interior and Exterior AI for 4K with uhd=1, as the luw.ai form does, and 2K with nothing", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/x.png" }));
    const { client, call } = await connect(luw.fetch);
    const image = "https://example.com/p.jpg";
    const tools = (await client.listTools()).tools;
    for (const name of ["luw_render", "luw_interior_design", "luw_exterior_design"]) {
      const tool = tools.find((t) => t.name === name)!;
      expect((tool.inputSchema.properties as any).resolution.enum).toEqual(["2k", "4k"]);
      expect(tool.description).toContain("Costs 1 credit per variation (2 at 4k).");
      await call(name, { image, resolution: "4k" });
      await call(name, { image, resolution: "2k" });
      await call(name, { image });
    }
    expect(luw.generates().map((g) => g.json)).toEqual([
      { model: "render", image, uhd: 1 },
      { model: "render", image },
      { model: "render", image },
      { model: "interior", image, luwmodel: "symphony-3", uhd: 1 },
      { model: "interior", image, luwmodel: "symphony-3" },
      { model: "interior", image, luwmodel: "symphony-3" },
      { model: "exterior", image, luwmodel: "symphony-3", uhd: 1 },
      { model: "exterior", image, luwmodel: "symphony-3" },
      { model: "exterior", image, luwmodel: "symphony-3" },
    ]);
  });

  it("offers 4K only where the luw.ai form has the switch", async () => {
    // Render, Interior, Exterior and Magic Prompt have it; Landscape, for one, has no 4K switch on luw.ai.
    const { client } = await connect(fakeLuw().fetch);
    const tools = (await client.listTools()).tools;
    const with4k = tools.filter((t) => (t.inputSchema.properties as any)?.resolution).map((t) => t.name);
    expect(with4k.sort()).toEqual(["luw_edit_image", "luw_exterior_design", "luw_interior_design", "luw_render"]);
  });

  it("runs on Symphony unless Aria is picked, 3DGen on Aria, and sends no model to tools that have none", async () => {
    // As the Luw.ai apps open their tools. 3DGen's Symphony costs 8 credits instead of 3 and on a free account
    // makes Aria's model, so it stays on Aria. Render and Fluw run one model, so luwmodel would mean nothing there.
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/x.png" }));
    const { call } = await connect(luw.fetch);
    await call("luw_interior_design", { image: "https://e.com/r.jpg" });
    await call("luw_interior_design", { image: "https://e.com/r.jpg", engine: "aria" });
    await call("luw_generate_video", { image: "https://e.com/r.jpg" });
    await call("luw_image_to_3d", { image: "https://e.com/c.jpg" });
    await call("luw_render", { image: "https://e.com/r.jpg" });
    await call("luw_generate_image", { prompt: "a chair" });
    expect(luw.generates().map((g) => g.json.luwmodel)).toEqual(["symphony-3", undefined, "symphony-3", undefined, undefined, undefined]);
  });

  it("lists each tool's default model in its schema, as an optional setting", async () => {
    const { client } = await connect(fakeLuw().fetch);
    const tools = (await client.listTools()).tools;
    const withEngine = tools.filter((t) => (t.inputSchema.properties as any)?.engine);
    expect(withEngine.map((t) => t.name).sort()).toEqual([
      "luw_background",
      "luw_edit_image",
      "luw_exterior_design",
      "luw_generate_pattern",
      "luw_generate_video",
      "luw_image_to_3d",
      "luw_interior_design",
      "luw_magic_wand",
      "luw_sketch_to_render",
      "luw_vectorize_image",
    ]);
    for (const t of withEngine) {
      const engine = (t.inputSchema.properties as any).engine;
      expect(engine.enum).toEqual(["aria", "symphony"]);
      // Aria where Symphony costs more than Aria and the luw.ai form opens on Aria.
      expect(engine.default).toBe(["luw_image_to_3d", "luw_vectorize_image"].includes(t.name) ? "aria" : "symphony");
      expect(t.inputSchema.required ?? []).not.toContain("engine");
    }
  });

  it("offers a model prompt that keeps the pick for the rest of the chat", async () => {
    const { client } = await connect(fakeLuw().fetch);
    const prompt = await client.getPrompt({ name: "model", arguments: { engine: " Aria " } });
    const text = (prompt.messages[0]!.content as { text: string }).text;
    expect(text).toContain('use engine "aria" on every Luw.ai tool');
    expect(text).toContain("rest of this conversation");
  });

  it("validates inputs before spending credits", async () => {
    const luw = fakeLuw();
    const { call } = await connect(luw.fetch);
    const wand = await call("luw_magic_wand", { image: "https://e.com/a.jpg", mask_image: "https://e.com/m.png" });
    expect(textOf(wand)).toMatch(/prompt, remove=true, or a material_image/);
    expect(luw.calls).toHaveLength(0);
  });

  it("sends 4x when 8x is asked (the largest the upscaler makes)", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/u.png" }));
    const { call } = await connect(luw.fetch);
    await call("luw_upscale_image", { image: "https://e.com/a.jpg", scale: 8 });
    expect(luw.generates()[0]!.json.hd).toBe("4");
  });

  it("asks Pattern AI for the small tile only at size 512, on either engine", async () => {
    // The backend's one size switch is texture -1 (small); older clients' 768 and 1024 mean the full size.
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/t.png" }));
    const { call } = await connect(luw.fetch);
    await call("luw_generate_pattern", { prompt: "tiles", size: 512 });
    await call("luw_generate_pattern", { prompt: "tiles", size: 1024 });
    await call("luw_generate_pattern", { prompt: "tiles", size: 768, engine: "symphony" });
    expect(luw.generates().map((g) => g.json.texture)).toEqual([-1, undefined, undefined]);
  });

  it("keeps accepting the retired Magic Prompt engine name, as Symphony, without listing it", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/x.png" }));
    const { client, call } = await connect(luw.fetch);
    const tool = (await client.listTools()).tools.find((t) => t.name === "luw_edit_image")!;
    expect((tool.inputSchema.properties as any).engine.enum).toEqual(["aria", "symphony"]);
    expect(JSON.stringify(tool)).not.toMatch(/banana/);
    await call("luw_edit_image", { image: "https://e.com/a.jpg", prompt: "x", engine: "nano-banana-2" });
    expect(luw.generates()[0]!.json.luwmodel).toBe("symphony-3");
  });

  it("runs Vector AI on Aria unless Symphony is asked for", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/x.svg" }));
    const { call } = await connect(luw.fetch);
    await call("luw_vectorize_image", { image: "https://e.com/c.jpg" });
    await call("luw_vectorize_image", { image: "https://e.com/c.jpg", engine: "aria" });
    await call("luw_vectorize_image", { image: "https://e.com/c.jpg", engine: "symphony" });
    expect(luw.generates().map((g) => g.json)).toEqual([
      { model: "vector", image: "https://e.com/c.jpg" },
      { model: "vector", image: "https://e.com/c.jpg" },
      { model: "vector", image: "https://e.com/c.jpg", luwmodel: "symphony-3" },
    ]);
  });

  it("sends 3DGen reflections on either engine", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/m.glb" }));
    const result = await (await connect(luw.fetch)).call("luw_image_to_3d", { image: "https://e.com/c.jpg", reflections: true });
    expect(result.isError).toBeFalsy();
    expect(luw.generates()[0]!.json).toEqual({ model: "3dgen", image: "https://e.com/c.jpg", reflect: 1 });
  });

  it("turns 3DGen's texture pack on with symphony unless it is turned off", async () => {
    // The pack is what Symphony adds over Aria; the web app sends it by default too.
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/m.glb" }));
    const { call } = await connect(luw.fetch);
    await call("luw_image_to_3d", { image: "https://e.com/c.jpg", engine: "symphony" });
    await call("luw_image_to_3d", { image: "https://e.com/c.jpg", engine: "symphony", texture: 0 });
    await call("luw_image_to_3d", { image: "https://e.com/c.jpg" });
    expect(luw.generates().map((g) => g.json.texture)).toEqual([1, undefined, undefined]);
  });

  it("offers no setting the backend ignores", async () => {
    // One model behind Render and Fluw, a fixed output format for these tools, no enhancer for video and patterns.
    const { client } = await connect(fakeLuw().fetch);
    const props = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, Object.keys(t.inputSchema.properties ?? {})]));
    for (const name of ["luw_render", "luw_generate_image"]) expect(props[name]).not.toContain("engine");
    for (const name of ["luw_generate_video", "luw_generate_pattern"]) expect(props[name]).not.toContain("enhance_prompt");
    for (const name of ["luw_magic_wand", "luw_landscape_design", "luw_background", "luw_upscale_image", "luw_vectorize_image"]) {
      expect(props[name]).not.toContain("format");
    }
  });

  it("keeps a paid job collectable when polling loses contact with Luw.ai", async () => {
    const luw = fakeLuw()
      .on("POST", "/generate", () => processing("job_7", 5))
      .on("POST", "/results", () => new Response("boom", { status: 502 }));
    const result = await (await connect(luw.fetch)).call("luw_render", { image: "https://example.com/a.jpg" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ status: "processing", processing_urls: ["job_7"] });
    expect(luw.generates()).toHaveLength(1);
  });

  it("doesn't blame the key when a poll gets a server error", async () => {
    const luw = fakeLuw().on("POST", "/results", () => new Response("boom", { status: 502 }));
    const collect = await (await connect(luw.fetch)).call("luw_get_result", { processing_url: "job_7", wait: false });
    expect(collect.isError).toBe(true);
    expect(textOf(collect)).toMatch(/HTTP 502.*the job keeps running/);
    expect(textOf(collect)).not.toMatch(/API key|reconnect/i);
  });

  it("still reports a generation that failed on Luw.ai as failed", async () => {
    const luw = fakeLuw()
      .on("POST", "/generate", () => processing("job_8", 5))
      .on("POST", "/results", () => ({ status: true, processing: true, processing_url: "job_8", progress: { state: "failed" }, error: "bad input" }));
    const result = await (await connect(luw.fetch)).call("luw_render", { image: "https://example.com/a.jpg" });
    expect(result.structuredContent).toMatchObject({ status: "failed" });
    expect(textOf(result)).toMatch(/Generation failed: bad input/);
  });

  it("always sends landscape big_data as an object (the backend reads big_data[\"city\"])", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/g.png" }));
    await (await connect(luw.fetch)).call("luw_landscape_design", {
      image: "https://e.com/y.jpg",
      mask_image: "https://e.com/m.png",
      city: "Antalya",
      sun_exposure: "Partial sun (4 - 6 hours)",
    });
    expect(luw.generates()[0]!.json.big_data).toEqual({ city: "Antalya", sun: "Partial sun (4 - 6 hours)" });
    await (await connect(luw.fetch)).call("luw_landscape_design", { image: "https://e.com/y.jpg", mask_image: "https://e.com/m.png" });
    expect(luw.generates()[1]!.json.big_data).toEqual({});
  });

  it("reports progress to clients that ask for it", async () => {
    const luw = fakeLuw()
      .on("POST", "/generate", () => processing("p", 0))
      .on("POST", "/results", () => processing("p", 50), 2)
      .on("POST", "/results", () => ({ status: true, output: "https://cdn.test/p.png" }));
    const { client } = await connect(luw.fetch);
    const seen: number[] = [];
    await client.callTool({ name: "luw_sketch_to_render", arguments: { image: "https://e.com/s.jpg" } }, undefined, {
      onprogress: (p) => seen.push(p.progress),
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("file inputs", () => {
  function uploadRoutes(luw: ReturnType<typeof fakeLuw>) {
    let n = 0;
    return luw
      .on("POST", "/upload", () => {
        n++;
        return { status: true, signed_url: `https://storage.test/put/${n}`, final_url: `https://cdn.test/up/${n}.png` };
      })
      .on("PUT", /^https:\/\/storage\.test\/put\/\d+$/, () => new Response(null, { status: 200 }))
      .on("GET", "/finalize_upload", () => ({ status: true }));
  }

  it("uploads local files (once) and passes the CDN URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "luw-test-"));
    const file = join(dir, "my room.png");
    await writeFile(file, PNG);
    const luw = uploadRoutes(fakeLuw()).on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/edit.png" }));
    const { call } = await connect(luw.fetch);

    await call("luw_edit_image", { image: file, prompt: "add plants" });
    await call("luw_edit_image", { image: file, prompt: "add a rug" });

    const upload = luw.calls.find((c) => c.url.pathname.endsWith("/upload"))!;
    expect(String(upload.form!.get("filename"))).toMatch(/^x12tmp-[a-z0-9]+-my-room\.png$/);
    const put = luw.calls.find((c) => c.method === "PUT")!;
    expect(put.headers.get("content-type")).toBe("image/png");
    expect(put.headers.get("cache-control")).toBe("max-age=315360000");
    expect(Array.from(put.bytes!)).toEqual(Array.from(PNG));
    const finalize = luw.calls.find((c) => c.url.pathname.endsWith("/finalize_upload"))!;
    expect(finalize.url.searchParams.get("url")).toBe("https://cdn.test/up/1.png");

    expect(luw.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(luw.generates().map((g) => g.json.image)).toEqual(["https://cdn.test/up/1.png", "https://cdn.test/up/1.png"]);
  });

  it("uploads data: URIs", async () => {
    const luw = uploadRoutes(fakeLuw()).on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/o.png" }));
    const { call } = await connect(luw.fetch);
    await call("luw_expand_image", { image: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` });
    expect(luw.generates()[0]!.json).toEqual({ model: "expand", image: "https://cdn.test/up/1.png" });
  });

  it("gives a clear error for missing files", async () => {
    const { call } = await connect(fakeLuw().fetch);
    const result = await call("luw_edit_image", { image: "/no/such/file.jpg", prompt: "x" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Can't find/);
  });

  it("refuses local paths on the hosted server", async () => {
    const { call } = await connect(fakeLuw().fetch, { mode: "remote" });
    const result = await call("luw_edit_image", { image: "./room.jpg", prompt: "x" });
    expect(textOf(result)).toMatch(/hosted Luw\.ai MCP server can't read files/);
  });

  it("never fetches arbitrary URLs on the hosted server", async () => {
    const luw = fakeLuw();
    const { call } = await connect(luw.fetch, { mode: "remote" });
    const result = await call("luw_upload_file", { source: "http://169.254.169.254/latest/meta-data" });
    expect(result.isError).toBe(true);
    expect(luw.calls).toHaveLength(0);
  });

  it("lets ChatGPT pass a photo the user attached, in the file shape its fileParams require", async () => {
    const { client } = await connect(fakeLuw().fetch, { mode: "remote" });
    const tools = (await client.listTools()).tools;
    const interior = tools.find((t) => t.name === "luw_interior_design")!;
    expect(interior._meta?.["openai/fileParams"]).toEqual(["image_file"]);
    const file = interior.inputSchema.properties!.image_file as { properties: object; required: string[] };
    expect(Object.keys(file.properties).sort()).toEqual(["download_url", "file_id", "file_name", "mime_type"]);
    expect(file.required.sort()).toEqual(["download_url", "file_id"]);
    expect(interior.inputSchema.required ?? []).not.toContain("image");

    const local = (await (await connect(fakeLuw().fetch)).client.listTools()).tools.find((t) => t.name === "luw_interior_design")!;
    expect(local.inputSchema.properties).not.toHaveProperty("image_file");
    expect(local.inputSchema.required).toContain("image");
  });

  it("generates from an attached photo's download link, and asks for a photo when there is none", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/out.png" }));
    const { call } = await connect(luw.fetch, { mode: "remote" });
    const attached = { download_url: "https://files.oaiusercontent.test/room.jpg?sig=1", file_id: "file_123", mime_type: "image/jpeg" };

    const result = await call("luw_interior_design", { image_file: attached, styles: ["Scandinavian"] });
    expect(result.isError).toBeFalsy();
    expect(luw.generates()[0]!.json.image).toBe(attached.download_url);

    const missing = await call("luw_interior_design", { styles: ["Scandinavian"] });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/No photo given/);
    expect(luw.generates()).toHaveLength(1);
  });

  it("rejects non-media local files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "luw-test-"));
    const file = join(dir, "id_rsa");
    await writeFile(file, "secret");
    const luw = fakeLuw();
    const result = await (await connect(luw.fetch)).call("luw_upload_file", { source: file });
    expect(textOf(result)).toMatch(/Unsupported file type/);
    expect(luw.calls).toHaveLength(0);
  });

  it("treats README and installer placeholder keys as missing", () => {
    expect(loadConfig({ LUW_API_KEY: "YOUR_LUW_API_KEY" }).apiKey).toBe("");
    expect(loadConfig({ LUW_API_KEY: "${user_config.api_key}" }).apiKey).toBe("");
    expect(loadConfig({ LUW_OUTPUT_DIR: "${user_config.output_dir}" }).outputDir).toBeUndefined();
    expect(loadConfig({ LUW_API_TOKEN: " real-key " }).apiKey).toBe("real-key");
  });

  it("stores persona training images permanently", async () => {
    const dir = await mkdtemp(join(tmpdir(), "luw-test-"));
    const file = join(dir, "style.jpg");
    await writeFile(file, PNG);
    const luw = uploadRoutes(fakeLuw()).on("POST", "/personas/7/trainings", () => ({ status: true, training_id: 1 }));
    await (await connect(luw.fetch)).call("luw_personas", { action: "add_training", persona_id: 7, image: file, slot: 1 });
    const upload = luw.calls.find((c) => c.url.pathname.endsWith("/upload"))!;
    expect(String(upload.form!.get("filename"))).not.toMatch(/^x12tmp-/);
    expect(upload.form!.get("pid")).toBe("7");
    expect(luw.calls.at(-1)!.json).toEqual({ image: "https://cdn.test/up/1.png", slot: 1 });
  });
});

describe("outputs", () => {
  it("turns segmentation masks into URLs, filtered by label", async () => {
    let n = 0;
    const luw = fakeLuw()
      .on("POST", "/generate", () => ({
        status: true,
        output: [
          { label: "wall", mask: Buffer.from(PNG).toString("base64"), score: null },
          { label: "floor", mask: Buffer.from(PNG).toString("base64"), score: null },
          { label: "bed", mask: Buffer.from(PNG).toString("base64"), score: null },
        ],
      }))
      .on("POST", "/upload", () => ({ status: true, signed_url: `https://storage.test/put/${++n}`, final_url: `https://cdn.test/mask/${n}.png` }))
      .on("PUT", /storage\.test/, () => new Response(null))
      .on("GET", "/finalize_upload", () => ({ status: true }));
    const result = await (await connect(luw.fetch)).call("luw_segment", { image: "https://e.com/r.jpg", labels: ["floor", "WALL"] });
    const masks = (result.structuredContent as any).masks;
    expect(masks.map((m: any) => m.label)).toEqual(["wall", "floor"]);
    expect(masks.every((m: any) => /^https:\/\/cdn\.test\/mask\/\d\.png$/.test(m.url))).toBe(true);
    expect(textOf(result)).toMatch(/- wall: https/);
  });

  it("says so when a job finishes with no output, and what to try for a segment prompt", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: [] }));
    const result = await (await connect(luw.fetch)).call("luw_segment", { image: "https://e.com/r.jpg", prompt: "floor" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).status).toBe("empty");
    expect(textOf(result)).toMatch(/Segment AI finished in .* but returned no output\. Nothing matching "floor" was found/);
  });

  it("describes luw_upload_file for what each mode can do", async () => {
    const describe = async (mode: "local" | "remote") =>
      (await (await connect(fakeLuw().fetch, { mode })).client.listTools()).tools.find((t) => t.name === "luw_upload_file")!;
    const hosted = await describe("remote");
    expect(hosted.description).toMatch(/data: URI/);
    expect(JSON.stringify(hosted.inputSchema)).not.toMatch(/https:\/\/ URL|Local file path/);
    expect(JSON.stringify((await describe("local")).inputSchema)).toMatch(/Local file path/);
  });

  it("embeds result images and saves them to LUW_OUTPUT_DIR", async () => {
    const dir = await mkdtemp(join(tmpdir(), "luw-out-"));
    const luw = fakeLuw()
      .on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/final.png" }))
      .on("GET", "https://cdn.test/final.png", () => new Response(PNG, { headers: { "content-type": "image/png" } }));
    const result = await (await connect(luw.fetch, { inlineImages: true, outputDir: dir })).call("luw_render", { image: "https://e.com/a.jpg" });
    const image = result.content.find((c) => c.type === "image") as any;
    expect(image).toMatchObject({ mimeType: "image/png", data: Buffer.from(PNG).toString("base64") });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^luw-.*-1\.png$/);
    expect(Array.from(await readFile(join(dir, files[0]!)))).toEqual(Array.from(PNG));
    expect(textOf(result)).toContain(`Saved to: ${join(dir, files[0]!)}`);
  });

  it("previews Luw.ai CDN outputs through the resizing CDN but saves the full-size original", async () => {
    const dir = await mkdtemp(join(tmpdir(), "luw-out-"));
    const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 9, 9]);
    const luw = fakeLuw()
      .on("POST", "/generate", () => ({ status: true, output: "https://i.luvicdn.com/luwai/42/luwai-1.png" }))
      .on("GET", "https://luvicdn.net/img/luwai/42/luwai-1.png", (req) => {
        expect(req.url.search).toBe("?w=1568&fm=jpg&q=85");
        return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
      })
      .on("GET", "https://i.luvicdn.com/luwai/42/luwai-1.png", () => new Response(PNG, { headers: { "content-type": "image/png" } }));
    const result = await (await connect(luw.fetch, { inlineImages: true, outputDir: dir })).call("luw_render", { image: "https://e.com/a.jpg" });
    expect(result.content.find((c) => c.type === "image")).toMatchObject({ mimeType: "image/jpeg", data: Buffer.from(JPEG).toString("base64") });
    const files = await readdir(dir);
    expect(Array.from(await readFile(join(dir, files[0]!)))).toEqual(Array.from(PNG));
  });

  it("skips inline previews that are too large", async () => {
    const luw = fakeLuw()
      .on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/huge.png" }))
      .on("GET", "https://cdn.test/huge.png", () => new Response(PNG, { headers: { "content-type": "image/png", "content-length": "99999999" } }));
    const result = await (await connect(luw.fetch, { inlineImages: true })).call("luw_render", { image: "https://e.com/a.jpg" });
    expect(result.content.some((c) => c.type === "image")).toBe(false);
  });
});

describe("other tools", () => {
  it("ArchiGPT sends one standalone question and returns the answer", async () => {
    // App directories forbid asking for prior conversation turns, so ArchiGPT takes no history.
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, message: "Put the bed on the solid wall.", usage: 120, left: 880 }));
    const { client, call } = await connect(luw.fetch);
    const tool = (await client.listTools()).tools.find((t) => t.name === "luw_archigpt")!;
    expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain("history");

    const result = await call("luw_archigpt", { message: "Where should the bed go?", language: "en" });
    expect(textOf(result)).toContain("Put the bed on the solid wall.");
    expect(luw.generates()[0]!.json).toEqual({ model: "archigpt", prompt: "Where should the bed go?", lang: "en" });
  });

  it("ArchiGPT's image tag for the Luw.ai apps stays out of the reply", async () => {
    const message = 'A warm Japandi bedroom suits this room.\n\n[generateinteriorwithluwai="Japandi bedroom, light oak, linen"]';
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, message, usage: 10, left: 990 }));
    const result = await (await connect(luw.fetch)).call("luw_archigpt", { message: "Ideas for my bedroom?" });
    expect(textOf(result)).not.toMatch(/withluwai/);
    expect(textOf(result)).toContain("A warm Japandi bedroom suits this room.");
    expect(result.structuredContent).toMatchObject({
      message: "A warm Japandi bedroom suits this room.",
      image_prompt: "Japandi bedroom, light oak, linen",
    });
  });

  it("lists design styles from the public endpoint without auth", async () => {
    const luw = fakeLuw().on("GET", "/styles", () => [
      { name: "Japandi", description: "Japanese meets Scandinavian" },
      { name: "Baroque", description: "Ornate" },
    ]);
    const result = await (await connect(luw.fetch)).call("luw_list_options", { kind: "design_styles", search: "scandi" });
    expect(textOf(result)).toContain("Japandi: Japanese meets Scandinavian");
    expect(textOf(result)).not.toContain("Baroque");
    expect(luw.calls[0]!.headers.has("authorization")).toBe(false);
    expect(luw.calls[0]!.url.searchParams.get("version")).toBe("2");
  });

  it("lists personas with server-side paging when a profession is given", async () => {
    const luw = fakeLuw().on("GET", "/personas/ft-Interior", (req) => {
      expect(Object.fromEntries(req.url.searchParams)).toEqual({ page: "2", limit: "3", slim: "1" });
      return { status: true, personas: [1, 2, 3].map((id) => ({ id, name: `P${id}`, profession: "Interior", trainings: [{ id: 9 }], access_token: null })) };
    });
    const result = await (await connect(luw.fetch)).call("luw_personas", { action: "list", profession: "Interior", page: 2, limit: 2 });
    expect(result.structuredContent).toEqual({
      page: 2,
      has_more: true,
      personas: [
        { id: 1, name: "P1", profession: "Interior", trainings: 1 },
        { id: 2, name: "P2", profession: "Interior", trainings: 1 },
      ],
    });
  });

  it("trims the unpaginated persona list to a small, newest-first page", async () => {
    const personas = Array.from({ length: 1500 }, (_, i) => ({
      id: i,
      name: i === 7 ? "Villa Bodrum" : `Untitled ${i}`,
      updated_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
      trainings: Array.from({ length: 5 }, (_, t) => ({ id: t, extras: "x".repeat(2000) })),
    }));
    const luw = fakeLuw().on("GET", "/personas", () => ({ status: true, personas }));
    const { call } = await connect(luw.fetch);
    const page = await call("luw_personas", { action: "list" });
    expect(textOf(page).length).toBeLessThan(5000);
    expect(page.structuredContent).toMatchObject({ total: 1500, page: 1, has_more: true });
    expect((page.structuredContent as any).personas).toHaveLength(20);
    const found = await call("luw_personas", { action: "list", search: "bodrum" });
    expect((found.structuredContent as any).personas.map((p: any) => p.id)).toEqual([7]);
  });

  it("caps oversized JSON results", async () => {
    const luw = fakeLuw().on("GET", "/boards/1", () => ({ status: true, board: { media: Array.from({ length: 5000 }, (_, i) => ({ id: i, url: `https://cdn.test/${i}.png` })) } }));
    const result = await (await connect(luw.fetch)).call("luw_projects", { action: "get", project_id: 1 });
    expect(textOf(result).length).toBeLessThan(41_000);
    expect(textOf(result)).toMatch(/truncated/);
  });

  it("luw_projects hits the board endpoints", async () => {
    const luw = fakeLuw()
      .on("POST", "/boards", () => ({ status: true, board: { id: 5, name: "Villa" } }))
      .on("PUT", "/boards/5/media/9/move", () => ({ status: true }));
    const { call } = await connect(luw.fetch);
    const created = await call("luw_projects", { action: "create", name: "Villa" });
    expect(created.structuredContent).toMatchObject({ board: { id: 5 } });
    await call("luw_projects", { action: "move_media", project_id: 5, media_id: 9 });
    expect(luw.calls.at(-1)!.json).toEqual({ folder_id: null });
    const missing = await call("luw_projects", { action: "get" });
    expect(textOf(missing)).toMatch(/"project_id" is required/);
  });

  it("luw_run_model resolves image params and runs any model", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/r.png" }));
    const result = await (await connect(luw.fetch)).call("luw_run_model", {
      model: "interior",
      params: { image: "https://e.com/a.jpg", style_transfer: "persona", pid: 3, precise: 90 },
    });
    expect(result.structuredContent).toMatchObject({ status: "completed" });
    expect(luw.generates()[0]!.json).toEqual({ model: "interior", image: "https://e.com/a.jpg", style_transfer: "persona", pid: 3, precise: 90 });
  });

  it("keeps the generic executor and multi-action tools off the hosted server", async () => {
    // App directories list the hosted server and reject generic executors and tools that pick an operation from an argument.
    const { client } = await connect(fakeLuw().fetch, { mode: "remote" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ["luw_run_model", "luw_personas", "luw_projects"]) expect(names).not.toContain(name);
    expect(names).toHaveLength(22);
  });
});

describe("luw_create_upload", () => {
  const SLOT = /^x12tmp-[a-z0-9]+-put-(.+)$/;
  // Luw.ai storage keeps the file name it was given (as in the app: i.luvicdn.com/luwai/<user>/x12tmp-….png).
  function uploadSlots(luw: ReturnType<typeof fakeLuw>) {
    return luw.on("POST", "/upload", (req) => {
      const name = String(req.form!.get("filename"));
      return { status: true, signed_url: `https://storage.test/put/${name}?sig=1`, final_url: `https://cdn.test/luwai/7/${name}` };
    });
  }

  it("is on the hosted server only, where files can't be read from the user's computer", async () => {
    const list = async (mode: "local" | "remote") => (await (await connect(fakeLuw().fetch, { mode })).client.listTools()).tools;
    const tool = (await list("remote")).find((t) => t.name === "luw_create_upload")!;
    expect(tool.description).toMatch(/PUT/);
    expect(tool.description).toMatch(/Never put image bytes or base64/);
    expect((await list("local")).map((t) => t.name)).not.toContain("luw_create_upload");
  });

  it("returns the signed PUT URL, the headers it needs and the final URL, uploading nothing itself", async () => {
    const luw = uploadSlots(fakeLuw());
    const { call } = await connect(luw.fetch, { mode: "remote", apiKey: "oauth-key" });
    const result = await call("luw_create_upload", {});
    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as { method: string; put_url: string; image_url: string; headers: Record<string, string> };
    expect(data.method).toBe("PUT");
    expect(data.put_url).toMatch(/^https:\/\/storage\.test\/put\/x12tmp-/);
    expect(data.image_url).toMatch(/^https:\/\/cdn\.test\/luwai\/7\/x12tmp-/);
    expect(data.headers["Content-Type"]).toBe("image/jpeg");
    expect(data.headers["Cache-Control"]).toBe("max-age=315360000");
    expect(textOf(result)).toContain(data.put_url);
    expect(textOf(result)).toContain(data.image_url);

    // The signed-in user's own key asks for the link, and the server sends no bytes and checks nothing yet.
    expect(luw.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(["POST /v2/upload"]);
    expect(luw.calls[0]!.headers.get("authorization")).toBe("Bearer oauth-key");
    expect(String(luw.calls[0]!.form!.get("filename"))).toMatch(SLOT);
  });

  it("sets the Content-Type from the file name and refuses anything that isn't a picture", async () => {
    const luw = uploadSlots(fakeLuw());
    const { call } = await connect(luw.fetch, { mode: "remote" });
    const png = await call("luw_create_upload", { filename: "North facade 1.PNG" });
    expect((png.structuredContent as any).headers["Content-Type"]).toBe("image/png");
    expect(SLOT.exec(String(luw.calls[0]!.form!.get("filename")))![1]).toMatch(/^North-facade-1\.PNG$/);

    for (const filename of ["notes.txt", "model.glb", "view", "../view.png", "a/b.jpg", "x".repeat(80) + ".png"]) {
      const result = await call("luw_create_upload", { filename }).catch((error: Error) => error);
      expect(result instanceof Error || (result as { isError?: boolean }).isError, filename).toBe(true);
    }
    expect(luw.calls).toHaveLength(1);
  });

  it("has Luw.ai check the uploaded picture before a tool uses it, then generates from it", async () => {
    const luw = uploadSlots(fakeLuw())
      .on("GET", "/finalize_upload", () => ({ status: true }))
      .on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/render.png" }));
    const { call } = await connect(luw.fetch, { mode: "remote" });
    const slot = (await call("luw_create_upload", { filename: "view.jpg" })).structuredContent as { image_url: string };
    const result = await call("luw_render", { image: slot.image_url, prompt: "golden hour" });
    expect(result.isError).toBeFalsy();
    const order = luw.calls.map((c) => `${c.method} ${c.url.pathname}`).filter((c) => !c.endsWith("/upload"));
    expect(order.slice(0, 2)).toEqual(["GET /v2/finalize_upload", "POST /v2/generate"]);
    expect(luw.calls.find((c) => c.url.pathname.endsWith("/finalize_upload"))!.url.searchParams.get("url")).toBe(slot.image_url);
    expect(luw.generates()[0]!.json.image).toBe(slot.image_url);
  });

  it("spends nothing when the picture was never sent or Luw.ai refuses it", async () => {
    const luw = uploadSlots(fakeLuw()).on("GET", "/finalize_upload", () => ({ status: false, error: "file not found" }));
    const { call } = await connect(luw.fetch, { mode: "remote" });
    const slot = (await call("luw_create_upload", {})).structuredContent as { image_url: string };
    const result = await call("luw_render", { image: slot.image_url });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/send the file to its put_url first, or Luw\.ai refused it\. No credits were used\. \(.*file not found/);
    expect(luw.generates()).toHaveLength(0);
  });

  it("doesn't check links it didn't hand out, and keeps a rejected key's reconnect error", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/out.png" }));
    const { call } = await connect(luw.fetch, { mode: "remote" });
    await call("luw_render", { image: "https://i.luvicdn.com/luwai/1/x12tmp-5484-1787332371.png" });
    await call("luw_render", { image: "https://e.com/put-view.png" });
    expect(luw.calls.some((c) => c.url.pathname.endsWith("/finalize_upload"))).toBe(false);

    const rejected = fakeLuw().on("GET", "/finalize_upload", () => new Response(JSON.stringify({ status: false, errors: { auth: ["bad"] } }), { status: 401 }));
    const { call: hosted } = await connect(rejected.fetch, { mode: "remote" });
    const result = await hosted("luw_render", { image: "https://cdn.test/luwai/7/x12tmp-ab12cd-put-view.jpg" });
    expect(textOf(result)).toMatch(/Luw\.ai rejected this connection's key/);
    expect(textOf(result)).not.toMatch(/put_url/);
  });

  it("hands out no link it couldn't follow up on", async () => {
    const luw = fakeLuw().on("POST", "/upload", () => ({ status: true, signed_url: "https://storage.test/put/1", final_url: "https://cdn.test/renamed/1.jpg" }));
    const result = await (await connect(luw.fetch, { mode: "remote" })).call("luw_create_upload", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/can't check/);
  });

  it("points an assistant that passes a local path to the upload link", async () => {
    const result = await (await connect(fakeLuw().fetch, { mode: "remote" })).call("luw_render", { image: "C:\\Temp\\view.png" });
    expect(textOf(result)).toMatch(/luw_create_upload/);
  });
});
