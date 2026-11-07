import { Ajv } from "ajv";
import { afterEach, describe, expect, it, vi } from "vitest";

// The engine entry (src/engine, published as @luw-ai/mcp/engine): the Studio scene tools on a scene the
// caller holds, with no project I/O.

type Engine = typeof import("../src/engine/index.js");
const engine = (): Promise<Engine> => import("../src/engine/index.js");
const json = (run: { result: { content: { type: string; text?: string }[] } }) => JSON.parse(run.result.content[0]!.text!);
const ofType = (graph: { nodes: Record<string, unknown> }, type: string) =>
  Object.values(graph.nodes).filter((node) => (node as { type?: string }).type === type);
const NO_CATALOG = { catalogUrl: "" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("engine entry", () => {
  it("makes no network call on import, listing its tools or starting a scene", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in this test"));
    vi.resetModules();
    const { apiToolDefinitions, defaultScene, studioGuide } = await engine();
    apiToolDefinitions();
    studioGuide({ forApi: true });
    await defaultScene();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists the Studio scene tools as valid JSON Schemas without tuples or project_id", async () => {
    const { apiToolDefinitions } = await engine();
    const defs = apiToolDefinitions();
    const names = defs.map((d) => d.name);
    for (const name of [
      "create_room",
      "add_door",
      "add_window",
      "furnish_room",
      "get_level_summary",
      "paint",
      "run_batch",
      "verify_scene",
      "set_checkpoint",
      "kitchen_add_run",
      "bathroom_add",
      "create_roof",
    ]) {
      expect(names).toContain(name);
    }
    for (const name of ["add_object", "view_scene", "clear_scene", "undo", "redo", "export_glb", "export_json", "author_scene", "design_brief", "kitchen_check_clearance"]) {
      expect(names).not.toContain(name);
    }
    expect(names.filter((n) => n.startsWith("luw_studio"))).toEqual([]);
    const ajv = new Ajv({ strict: false });
    for (const def of defs) {
      const text = JSON.stringify(def.input_schema);
      expect(def.input_schema.type, def.name).toBe("object");
      expect(text, def.name).not.toMatch(/"items":\[|"additionalItems"/);
      expect(text, def.name).not.toContain("project_id");
      expect(def.input_schema, def.name).not.toHaveProperty("$schema");
      expect(() => ajv.compile(def.input_schema), def.name).not.toThrow();
      expect(def.description.length, def.name).toBeGreaterThan(0);
      expect(def.description, def.name).not.toMatch(/\bPascal\b/);
    }
    expect(defs.find((d) => d.name === "get_level_summary")?.read_only).toBe(true);
    expect(defs.find((d) => d.name === "create_room")?.read_only).toBe(false);
    // The host's own input, as the MCP server lists it.
    expect(JSON.stringify(defs.find((d) => d.name === "verify_scene")?.input_schema)).toContain('"since"');
  });

  it("runs create_room, add_door and furnish_room on the starting scene", async () => {
    const { defaultScene, runToolOnGraph } = await engine();
    const start = await defaultScene();
    const options = { ...NO_CATALOG, projectId: 7 };
    const room = await runToolOnGraph(start, null, "create_room", { name: "Bedroom", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }, options);
    expect(room.result.isError).toBeFalsy();
    expect(room.changed).toBe(true);
    expect(ofType(room.graph, "wall")).toHaveLength(4);
    expect(ofType(start, "wall")).toHaveLength(0); // the scene passed in is left as it was
    const made = json(room);
    expect(made.unsaved).toBeUndefined();
    const wallId = made.wallIds[0];
    expect(typeof wallId).toBe("string");

    const door = await runToolOnGraph(room.graph, room.session, "add_door", { wallId, t: 0.5 }, options);
    expect(door.result.isError, JSON.stringify(door.result)).toBeFalsy();
    expect(door.changed).toBe(true);
    expect(ofType(door.graph, "door")).toHaveLength(1);

    const furnished = await runToolOnGraph(door.graph, door.session, "furnish_room", { zoneId: made.zoneId, roomType: "bedroom" }, options);
    expect(furnished.result.isError, JSON.stringify(furnished.result)).toBeFalsy();
    expect(furnished.changed).toBe(true);
    expect(ofType(furnished.graph, "item").length).toBeGreaterThan(0);
  });

  it("reports no change for a read, a refusal, a bad argument or a tool it doesn't offer", async () => {
    const { defaultScene, runToolOnGraph } = await engine();
    const start = await defaultScene();
    for (const name of ["get_level_summary", "list_levels", "get_walls"]) {
      const read = await runToolOnGraph(start, null, name, {}, NO_CATALOG);
      expect(read.result.isError, name).toBeFalsy();
      expect(read.changed, name).toBe(false);
      expect(read.graph).toBe(start);
    }
    const bad = await runToolOnGraph(start, null, "create_room", { name: "X", polygon: "square" }, NO_CATALOG);
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0]!.text).toContain("Input validation error: Invalid arguments for tool create_room");
    expect(bad.changed).toBe(false);
    for (const name of ["view_scene", "clear_scene", "no_such_tool"]) {
      const missing = await runToolOnGraph(start, null, name, {}, NO_CATALOG);
      expect(missing.result.isError, name).toBe(true);
      expect(missing.changed, name).toBe(false);
    }
    const room = await runToolOnGraph(start, null, "create_room", { name: "Hall", polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] }, NO_CATALOG);
    const template = await runToolOnGraph(room.graph, room.session, "create_from_template", { id: "anything" }, NO_CATALOG);
    expect(template.result.isError).toBe(true);
    expect(template.result.content[0]!.text).toContain("replaces the whole scene");
    expect(template.graph).toBe(room.graph);
  });

  it("applies the tool's units, as the MCP server's schema check does", async () => {
    const { defaultScene, runToolOnGraph } = await engine();
    const run = await runToolOnGraph(await defaultScene(), null, "add_wall", { start: [0, 0], end: [4, 0], height: "250 cm" }, NO_CATALOG);
    expect(run.result.isError, JSON.stringify(run.result)).toBeFalsy();
    const wall = ofType(run.graph, "wall")[0] as { height?: number };
    expect(wall.height).toBeCloseTo(2.5);
  });

  it("carries the assistant's session from one call to the next", async () => {
    const { defaultScene, runToolOnGraph } = await engine();
    const start = await defaultScene();
    const mark = await runToolOnGraph(start, null, "set_checkpoint", { name: "before-walls" }, NO_CATALOG);
    expect(mark.result.isError, JSON.stringify(mark.result)).toBeFalsy();
    expect(JSON.stringify(mark.session)).toContain("before-walls");
    const wall = await runToolOnGraph(start, mark.session, "add_wall", { start: [0, 0], end: [4, 0] }, NO_CATALOG);
    const check = await runToolOnGraph(wall.graph, wall.session, "verify_scene", { since: "before-walls" }, NO_CATALOG);
    expect(check.result.isError, JSON.stringify(check.result)).toBeFalsy();
    expect(JSON.stringify(check.result)).toContain("wall");
    // A session that isn't one starts an empty one.
    const fresh = await runToolOnGraph(start, "not a session", "list_levels", {}, NO_CATALOG);
    expect(JSON.stringify(fresh.session)).not.toContain("before-walls");
  });

  it("reads and writes scenes as Studio stores them", async () => {
    const { defaultScene, parseScene, serializeScene, SCENE_FORMAT } = await engine();
    const graph = await defaultScene();
    const raw = serializeScene(graph);
    expect(JSON.parse(raw).luwFormat).toBe(SCENE_FORMAT);
    const back = parseScene(raw);
    expect(back.kind).toBe("scene");
    expect(back.kind === "scene" && back.legacy).toBe(false);
    expect(back.kind === "scene" && Object.keys(back.graph.nodes).length).toBe(Object.keys(graph.nodes).length);
    expect(parseScene("")).toEqual({ kind: "empty" });
    const legacy = parseScene(JSON.stringify(graph));
    expect(legacy.kind === "scene" && legacy.legacy).toBe(true);
  });

  it("writes the guide for a host that has the project open, without the MCP workflow", async () => {
    const { studioGuide } = await engine();
    const api = studioGuide({ forApi: true });
    expect(api).not.toContain("project_id");
    expect(api).not.toContain("luw_studio_");
    expect(api).not.toContain("luw://");
    expect(api).toContain("kitchen_add_run");
    expect(api).toContain("## Scene Creation Rules");
    expect(studioGuide()).toContain("luw_studio_list_projects");
  });
});
