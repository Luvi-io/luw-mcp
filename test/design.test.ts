import { Ajv } from "ajv";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeLuw } from "./helpers.js";

// The engine entry's design tools (designToolDefinitions, runDesignTool): the MCP server's generation
// tools without the server, run with a caller's key, as luw-api's archiagent-design model runs them.

type Engine = typeof import("../src/engine/index.js");
const engine = (): Promise<Engine> => import("../src/engine/index.js");
const API = "https://api.test/v2";
const textOf = (r: { content: { type: string; text?: string }[] }) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("design tools", () => {
  it("lists the generate tools with get_result and list_options, as valid JSON Schemas, without a network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in this test"));
    const { designToolDefinitions } = await engine();
    const defs = designToolDefinitions();
    const names = defs.map((d) => d.name);
    for (const name of ["luw_interior_design", "luw_exterior_design", "luw_generate_image", "luw_edit_image", "luw_generate_video", "luw_image_to_3d", "luw_remove_furniture", "luw_get_result", "luw_list_options"]) {
      expect(names).toContain(name);
    }
    for (const name of ["luw_upload_file", "luw_run_model", "luw_archigpt", "create_room"]) expect(names).not.toContain(name);
    const ajv = new Ajv({ strict: false });
    for (const def of defs) {
      expect(def.description.length, def.name).toBeGreaterThan(20);
      expect(() => ajv.compile(def.input_schema), def.name).not.toThrow();
    }
    expect(defs.find((d) => d.name === "luw_get_result")?.read_only).toBe(true);
    expect(defs.find((d) => d.name === "luw_interior_design")?.read_only).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs a generation with the caller's key and answers as the MCP server does", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/out.png" }));
    const { runDesignTool } = await engine();
    const result = await runDesignTool(
      "luw_interior_design",
      { image: "https://example.com/room.jpg", prompt: "japandi", engine: "symphony" },
      { apiKey: "sk-caller", baseUrl: API, fetch: luw.fetch, inlineImages: false },
    );
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("https://cdn.test/out.png");
    expect(result.structuredContent).toMatchObject({ status: "completed", outputs: ["https://cdn.test/out.png"] });
    const [gen] = luw.generates();
    expect(gen!.headers.get("authorization")).toBe("Bearer sk-caller");
    expect(gen!.json).toMatchObject({ model: "interior", image: "https://example.com/room.jpg", prompt: "japandi", luwmodel: "symphony-3" });
  });

  it("never reads a file on the host: a path is refused before any request", async () => {
    const luw = fakeLuw();
    const { runDesignTool } = await engine();
    const result = await runDesignTool("luw_interior_design", { image: "/etc/passwd" }, { apiKey: "sk-caller", baseUrl: API, fetch: luw.fetch });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("is not a URL");
    expect(luw.calls).toHaveLength(0);
  });

  it("refuses a tool outside the design set and arguments its schema refuses", async () => {
    const luw = fakeLuw();
    const { runDesignTool } = await engine();
    const options = { apiKey: "sk-caller", baseUrl: API, fetch: luw.fetch };
    const upload = await runDesignTool("luw_upload_file", { source: "data:image/png;base64,AA==" }, options);
    expect(upload.isError).toBe(true);
    expect(textOf(upload)).toContain("Unknown tool: luw_upload_file");
    const missing = await runDesignTool("luw_interior_design", { prompt: "no image" }, options);
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain("Input validation error");
    expect(luw.calls).toHaveLength(0);
  });

  it("answers a missing key with the reason instead of throwing", async () => {
    const luw = fakeLuw();
    const { runDesignTool } = await engine();
    const result = await runDesignTool("luw_interior_design", { image: "https://example.com/room.jpg" }, { apiKey: "", baseUrl: API, fetch: luw.fetch });
    expect(result.isError).toBe(true);
    expect(luw.calls).toHaveLength(0);
  });
});
