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
    expect(names).toHaveLength(21);
    expect(names).toContain("luw_interior_design");
    expect(names).not.toContain("luw_team");
    expect(names.every((n) => /^luw_[a-z0-9_]+$/.test(n))).toBe(true);
  });

  it("filters by LUW_TOOLSETS", async () => {
    const { client } = await connect(fakeLuw().fetch, {}, { LUW_TOOLSETS: "archigpt,team" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.sort()).toEqual(["luw_archigpt", "luw_team"]);
  });

  it("rejects unknown toolsets", () => {
    expect(() => parseToolsets("generate,nope")).toThrow(/nope/);
    expect(parseToolsets("all").size).toBe(5);
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
    const result = await call("luw_exterior_design", { image: "https://example.com/h.jpg", variations: 3, seed: 10 });
    expect(luw.generates().map((g) => g.json.seed)).toEqual([10, 11, 12]);
    expect((result.structuredContent as any).outputs).toHaveLength(3);
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
    await call("luw_image_tools", { operation: "upscale", image: "https://example.com/p.jpg", scale: 4 });
    expect(luw.generates().map((g) => g.json)).toEqual([
      { model: "removebg", image: "https://example.com/p.jpg" },
      { model: "changebg", image: "https://example.com/p.jpg", prompt: "on a marble counter" },
      { model: "fluwvector", prompt: "logo", aspect_ratio: "1:1" },
      { model: "enhance", image: "https://example.com/p.jpg", hd: "4" },
    ]);
  });

  it("validates inputs before spending credits", async () => {
    const luw = fakeLuw();
    const { call } = await connect(luw.fetch);
    const wand = await call("luw_magic_wand", { image: "https://e.com/a.jpg", mask_image: "https://e.com/m.png" });
    expect(textOf(wand)).toMatch(/prompt, remove=true, or a material_image/);
    const pattern = await call("luw_generate_pattern", { prompt: "tiles", size: 1024 });
    expect(textOf(pattern)).toMatch(/512 or 768/);
    expect(luw.calls).toHaveLength(0);
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
    await call("luw_image_tools", { operation: "expand", image: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` });
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
  it("ArchiGPT sends history with ids and returns the answer", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, message: "Put the bed on the solid wall.", usage: 120, left: 880 }));
    const result = await (await connect(luw.fetch)).call("luw_archigpt", {
      message: "Where should the bed go?",
      history: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
      ],
      language: "en",
    });
    expect(textOf(result)).toContain("Put the bed on the solid wall.");
    const body = luw.generates()[0]!.json;
    expect(body).toMatchObject({ model: "archigpt", prompt: "Where should the bed go?", lang: "en" });
    expect(body.history).toHaveLength(2);
    expect(new Set(body.history.map((h: any) => h.id)).size).toBe(2);
    expect(body.history[1]).toMatchObject({ role: "assistant", content: "Hello!" });
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
});
