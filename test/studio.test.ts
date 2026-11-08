import type { AssetInput } from "@pascal-app/core";
import { describe, expect, it } from "vitest";
import { FALLBACK_CATALOG } from "../src/studio/catalog.js";
import { connect, fakeLuw, textOf, type Recorded } from "./helpers.js";

// The studio toolset against a fake Luw.ai API that keeps one project's trainings in memory.

const STUDIO = { LUW_TOOLSETS: "studio", LUW_STUDIO_CATALOG_URL: "" };

type Training = { id: number; slot: number; extras: string; image?: string };

/** A Luw Studio project (persona 7) whose trainings live in `trainings`, served the way Rails serves them. */
function studioProject(initial: Training[] = [], opts: { profession?: string } = {}) {
  const trainings = new Map<number, Training>(initial.map((t) => [t.slot, { ...t }]));
  let nextId = 900;
  let studioSave: string | null = null;
  const persona = { id: 7, name: "Beach house", title: null as string | null, profession: opts.profession ?? "Studio" };
  const luw = fakeLuw()
    .on("GET", "/personas/7", () => ({ status: true, persona: { ...persona, trainings: [...trainings.values()] } }))
    .on("GET", /\/personas\/7\/trainings\/\d+$/, (req: Recorded) => {
      const id = Number(req.url.pathname.split("/").pop());
      const training = [...trainings.values()].find((t) => t.id === id);
      if (training && studioSave !== null) {
        training.extras = studioSave;
        studioSave = null;
      }
      return { status: true, training };
    })
    .on("POST", "/personas/7/trainings", (req: Recorded) => {
      const existing = trainings.get(req.json.slot);
      if (existing) Object.assign(existing, req.json);
      else trainings.set(req.json.slot, { id: nextId++, ...req.json });
      return { status: true };
    })
    .on("PUT", /\/personas\/7\/trainings\/\d+$/, (req: Recorded) => {
      const id = Number(req.url.pathname.split("/").pop());
      const training = [...trainings.values()].find((t) => t.id === id)!;
      Object.assign(training, req.json);
      return { status: true };
    })
    .on("PUT", "/personas/7", (req: Recorded) => {
      Object.assign(persona, req.json);
      return { status: true };
    });
  return {
    luw,
    trainings,
    persona,
    /** Writes to the project's scene (the assistant's session, slot 1011, travels with every call). */
    writes: () => luw.calls.filter((c) => c.method !== "GET" && c.json?.slot !== 1011),
    session: () => (trainings.get(1011) ? JSON.parse(trainings.get(1011)!.extras) : null),
    studioSavesBeforeNextCheck: (extras: string) => {
      studioSave = extras;
    },
  };
}

const scene = (raw: string) => JSON.parse(raw) as { nodes: Record<string, { type: string; [k: string]: unknown }>; rootNodeIds: string[]; luwFormat?: string };
const ofType = (raw: string, type: string) => Object.values(scene(raw).nodes).filter((n) => n.type === type);

/** A stored Studio scene with one level and one wall, made through the tools themselves. */
async function sceneWithWall(): Promise<string> {
  const p = studioProject();
  const { call } = await connect(p.luw.fetch, {}, STUDIO);
  const levels = JSON.parse(textOf(await call("list_levels", { project_id: 7 })));
  const levelId = levels.levels?.[0]?.id ?? levels[0]?.id;
  const added = await call("add_wall", { project_id: 7, levelId, start: [0, 0], end: [4, 0] });
  expect(added.isError).toBeFalsy();
  return p.trainings.get(8)!.extras;
}

describe("studio toolset", () => {
  it("is off by default and, when on, offers Pascal's scene tools with a project_id", async () => {
    const off = await connect(fakeLuw().fetch);
    expect((await off.client.listTools()).tools.some((t) => t.name.startsWith("luw_studio"))).toBe(false);

    const { client } = await connect(fakeLuw().fetch, {}, STUDIO);
    const tools = (await client.listTools()).tools;
    const names = tools.map((t) => t.name);
    for (const name of ["luw_studio_list_projects", "luw_studio_create_project", "luw_studio_rename_project", "luw_studio_undo", "create_room", "furnish_room", "add_door", "get_level_summary", "paint", "get_site", "place_building", "add_fence", "run_batch", "set_checkpoint", "view_assets", "place_design", "set_ground_level", "kitchen_add_run", "kitchen_finish_run", "bathroom_add"]) {
      expect(names).toContain(name);
    }
    for (const name of ["add_object", "view_scene", "clear_scene", "undo", "redo", "export_glb", "save_scene", "load_scene", "author_scene", "design_brief", "kitchen_check_clearance"]) {
      expect(names).not.toContain(name);
    }
    const sceneTools = tools.filter((t) => !t.name.startsWith("luw_"));
    expect(sceneTools.length).toBeGreaterThan(40);
    for (const tool of sceneTools) expect(tool.inputSchema.required).toContain("project_id");
    expect(tools.find((t) => t.name === "create_from_template")?.inputSchema.properties).not.toHaveProperty("save");
  });

  it("answers a tool Pascal retired with its replacement, and no tool names Pascal as the library", async () => {
    const { client, call } = await connect(fakeLuw().fetch, {}, STUDIO);
    const tools = (await client.listTools()).tools;
    const names = tools.map((t) => t.name);
    for (const name of ["find_nodes", "describe_node", "validate_scene"]) expect(names).not.toContain(name);
    for (const name of ["find_by_type", "get_node", "verify_scene", "search_materials"]) expect(names).toContain(name);
    const retired = await call("find_nodes", { project_id: 7, type: "wall" });
    expect(retired.isError).toBe(true);
    expect(textOf(retired)).toContain("tool_retired");
    expect(textOf(retired)).toContain("find_by_type");
    // None says it is the library (luw-name.test.ts checks every name).
    const naming = tools.filter((t) => /\bPascal\b/.test(JSON.stringify(t)));
    expect(naming.map((t) => t.name)).toEqual([]);
  });

  it("lists input schemas ChatGPT accepts: no tuples (paint's texture repeat was one)", async () => {
    const { client, call } = await connect(fakeLuw().fetch, {}, STUDIO);
    const tools = (await client.listTools()).tools;
    const tuples = tools.filter((t) => /"items":\[|"additionalItems"/.test(JSON.stringify(t.inputSchema))).map((t) => t.name);
    expect(tuples).toEqual([]);
    const paint = JSON.stringify(tools.find((t) => t.name === "paint")?.inputSchema);
    expect(paint).toContain('"repeat":{"type":"array","items":{"type":"number"},"minItems":2,"maxItems":2}');
    // The tuple still checks what comes in.
    const wrong = await call("paint", { project_id: 1, targets: ["wall_1"], material: { texture: { url: "https://cdn/t.png", repeat: [1, 2, 3] } } });
    expect(textOf(wrong)).toContain("Input validation error");
  });

  it("lists projects without their scenes", async () => {
    const luw = fakeLuw().on("GET", "/personas/ft-Studio", () => ({
      status: true,
      personas: [{ id: 7, name: "Beach house", knows: "https://cdn/plan.png", updated_at: "2026-10-13", trainings: [{ id: 1, slot: 8, image: "https://cdn/cover.png" }] }],
    }));
    const { call } = await connect(luw.fetch, {}, STUDIO);
    const result = JSON.parse(textOf(await call("luw_studio_list_projects", {})));
    expect(luw.calls[0]!.url.searchParams.get("slim")).toBe("1");
    expect(luw.calls[0]!.url.searchParams.get("provider")).toBe("luw");
    expect(result.projects[0]).toMatchObject({ project_id: 7, name: "Beach house", cover: "https://cdn/cover.png", floor_plan: "https://cdn/plan.png", studio_url: "https://studio.luw.ai/?project=7" });
  });

  it("starts an empty project from Pascal's site, building and level, and saves the edit in Studio's format", async () => {
    const p = studioProject();
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const levels = JSON.parse(textOf(await call("list_levels", { project_id: 7 })));
    // The starting scene is saved on first use, so its ids hold from one call to the next.
    expect(p.writes().map((c) => [c.method, c.json.slot])).toEqual([["POST", 8]]);
    // The assistant's session began with this call: its start is the scene it found.
    expect(Object.keys(p.session().record.checkpoints)).toEqual(["start"]);
    expect(ofType(p.trainings.get(8)!.extras, "level")).toHaveLength(1);
    const levelId = levels.levels?.[0]?.id ?? levels[0]?.id;
    const result = await call("add_wall", { project_id: 7, levelId, start: [0, 0], end: [4, 0] });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Saved to Luw Studio project 7");
    // Pascal's own "not saved to any project" note would be untrue here.
    expect(textOf(result)).not.toMatch(/unsaved|in-memory|Not saved/);
    expect(result.structuredContent).toMatchObject({ project: "7" });
    const saved = p.trainings.get(8)!;
    expect(saved.extras).toBeTruthy();
    expect(scene(saved.extras).luwFormat).toBe("luw-1");
    expect(ofType(saved.extras, "wall")).toHaveLength(1);
    expect(p.persona.title).toMatch(/^assistant-edit:\d+$/);
    expect(ofType(p.trainings.get(1009)!.extras, "wall")).toHaveLength(0); // undo goes back to the empty level
  });

  it("keeps the scene it replaced for undo, and undo swaps it back (twice redoes)", async () => {
    const base = await sceneWithWall();
    const p = studioProject([{ id: 1, slot: 8, extras: base }]);
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const wall = ofType(base, "wall")[0]!;
    const deleted = await call("add_wall", { project_id: 7, levelId: wall.parentId, start: [4, 0], end: [4, 3] });
    expect(deleted.isError).toBeFalsy();
    expect(ofType(p.trainings.get(8)!.extras, "wall")).toHaveLength(2);
    expect(p.trainings.get(1009)!.extras).toBe(base);

    await call("luw_studio_undo", { project_id: 7 });
    expect(p.trainings.get(8)!.extras).toBe(base);
    await call("luw_studio_undo", { project_id: 7 });
    expect(ofType(p.trainings.get(8)!.extras, "wall")).toHaveLength(2);
  });

  it("reads a 0.9 Studio project but refuses to edit it", async () => {
    const base = scene(await sceneWithWall());
    delete base.luwFormat;
    const p = studioProject([{ id: 1, slot: 8, extras: JSON.stringify(base) }]);
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    expect((await call("get_walls", { project_id: 7 })).isError).toBeFalsy();
    expect((await call("get_walls", { project_id: "luw-7" })).isError).toBeFalsy(); // as Studio's Settings shows it
    const wall = Object.values(base.nodes).find((n) => n.type === "wall")!;
    const edit = await call("add_wall", { project_id: 7, levelId: wall.parentId, start: [4, 0], end: [4, 3] });
    expect(edit.isError).toBe(true);
    expect(textOf(edit)).toMatch(/previous Luw Studio/);
    expect(p.writes()).toHaveLength(0);
  });

  it("runs the edit again on the newer scene when Studio saved in between", async () => {
    const base = await sceneWithWall();
    const p = studioProject([{ id: 1, slot: 8, extras: base }]);
    // Studio's autosave lands after this call read the project and before it writes.
    p.studioSavesBeforeNextCheck(base.replace('"luwFormat"', '"savedByStudio":true,"luwFormat"'));
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const wall = ofType(base, "wall")[0]!;
    const result = await call("add_wall", { project_id: 7, levelId: wall.parentId, start: [4, 0], end: [4, 3] });
    expect(result.isError).toBeFalsy();
    const saved = scene(p.trainings.get(8)!.extras) as ReturnType<typeof scene> & { savedByStudio?: boolean };
    expect(saved.savedByStudio).toBe(true); // Studio's save is kept
    expect(ofType(p.trainings.get(8)!.extras, "wall")).toHaveLength(2); // and the edit is on it
    expect(p.luw.calls.filter((c) => c.method === "GET" && c.url.pathname === "/v2/personas/7")).toHaveLength(2);
  });

  it("refuses an edit that would empty the project", async () => {
    const base = await sceneWithWall();
    const p = studioProject([{ id: 1, slot: 8, extras: base }]);
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const wall = ofType(base, "wall")[0]!;
    const result = await call("delete_node", { project_id: 7, id: wall.id });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/empty the project/);
    expect(p.writes()).toHaveLength(0);
  });

  it("keeps nodes it doesn't know (Luw's and plugins') and top-level keys through an edit", async () => {
    const base = scene(await sceneWithWall());
    const wall = Object.values(base.nodes).find((n) => n.type === "wall")!;
    const level = base.nodes[wall.parentId as string]!;
    base.nodes.luwthing_1 = { object: "node", id: "luwthing_1", type: "luw-thing", parentId: level.id, visible: true, metadata: { kept: true } } as never;
    (level.children as string[]).push("luwthing_1");
    (base as Record<string, unknown>).luwEnvironment = { preset: "neon" };
    const p = studioProject([{ id: 1, slot: 8, extras: JSON.stringify(base) }]);
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const result = await call("add_wall", { project_id: 7, levelId: level.id, start: [4, 0], end: [4, 3] });
    expect(result.isError).toBeFalsy();
    const saved = scene(p.trainings.get(8)!.extras) as ReturnType<typeof scene> & { luwEnvironment?: unknown };
    expect(saved.nodes.luwthing_1).toMatchObject({ type: "luw-thing", metadata: { kept: true } });
    expect(saved.luwEnvironment).toEqual({ preset: "neon" });
  });

  it("views a catalog piece from Studio's own files, as Studio links them", async () => {
    const p = studioProject([{ id: 1, slot: 8, extras: await sceneWithWall() }]);
    const asked: string[] = [];
    p.luw.on("GET", /^https:\/\/studio\.luw\.ai\/items\//, (req: Recorded) => {
      asked.push(`${req.url.href} ${req.headers.get("range") ?? ""}`.trim());
      return new Response("gone", { status: 404 });
    });
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const viewed = await call("view_assets", { project_id: 7, ids: ["luw-vanity-single"] });
    expect(asked[0]).toMatch(/^https:\/\/studio\.luw\.ai\/items\/luw\/luw-vanity-single\/model\.glb bytes=0-/);
    expect(textOf(viewed)).toContain("luw-vanity-single");
    expect(p.writes()).toHaveLength(0);
  });

  it("builds and furnishes rooms with Luw's core: a small bathroom gets Luw's single vanity", async () => {
    const p = studioProject();
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const json = async (name: string, args: Record<string, unknown>) => {
      const result = await call(name, { project_id: 7, ...args });
      expect(result.isError, textOf(result)).toBeFalsy();
      return JSON.parse((result.content[0] as { text: string }).text);
    };
    const levelId = (await json("list_levels", {})).levels[0].id;
    await json("create_room", { levelId, name: "Living", polygon: [[0, 0], [6, 0], [6, 5], [0, 5]], doors: [{ wallIndex: 0 }], windows: [{ wallIndex: 2 }] });
    const bath = await json("create_room", { levelId, name: "Bathroom", polygon: [[6, 0], [8, 0], [8, 2.5], [6, 2.5]] });
    const furnished = await json("furnish_room", { zoneId: bath.zoneId, roomType: "bathroom" });
    // Pascal alone reaches for its 2 m double vanity here; Luw's core picks what fits the wall.
    expect(JSON.stringify(furnished)).not.toContain("bathroom-sink");
    expect(JSON.stringify(furnished)).toContain("luw-vanity-single");
    const saved = p.trainings.get(8)!.extras;
    expect(ofType(saved, "wall").length).toBe(8);
    expect(ofType(saved, "door")).toHaveLength(1);
  });

  it("searches Studio's catalog and furnishes from all of it: Luw's rug and plant in a living room, Luw's vanity in a small bathroom", async () => {
    // Studio's /api/catalog: Pascal's library and Luw's pieces, here a rug and a plant Pascal's starter list lacks.
    const rug: AssetInput = { id: "luw-rug-wool", category: "furniture", name: "Wool Rug", tags: ["rug", "floor", "living"], thumbnail: "/items/luw/luw-rug-wool/thumbnail.webp", src: "/items/luw/luw-rug-wool/model.glb", dimensions: [2.4, 0.02, 1.7], offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    const plant: AssetInput = { id: "luw-fiddle-fig", category: "furniture", name: "Fiddle Leaf Fig", tags: ["plant", "floor", "living"], thumbnail: "/items/luw/luw-fiddle-fig/thumbnail.webp", src: "/items/luw/luw-fiddle-fig/model.glb", dimensions: [0.6, 1.6, 0.6], offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    const url = "https://studio.test/api/catalog/en";
    const p = studioProject();
    p.luw.on("GET", url, () => ({ items: [...FALLBACK_CATALOG, rug, plant] }));
    const { call } = await connect(p.luw.fetch, {}, { ...STUDIO, LUW_STUDIO_CATALOG_URL: url });
    const json = async (name: string, args: Record<string, unknown>) => {
      const result = await call(name, { project_id: 7, ...args });
      expect(result.isError, textOf(result)).toBeFalsy();
      return JSON.parse((result.content[0] as { text: string }).text);
    };
    const found = await json("search_assets", { queries: [{ query: "vanity" }, { query: "rug" }, { query: "fig plant" }] });
    const ids = (group: { results: { id: string }[] }) => group.results.map((item) => item.id);
    expect(ids(found.groups[0])).toEqual(expect.arrayContaining(["luw-vanity-single", "luw-vanity-compact"]));
    expect(ids(found.groups[1])).toEqual(["luw-rug-wool"]);
    expect(ids(found.groups[2])).toEqual(["luw-fiddle-fig"]);
    const levelId = (await json("list_levels", {})).levels[0].id;
    const living = await json("create_room", { levelId, name: "Living", polygon: [[0, 0], [6, 0], [6, 5], [0, 5]], doors: [{ wallIndex: 0 }], windows: [{ wallIndex: 2 }] });
    const dressed = JSON.stringify(await json("furnish_room", { zoneId: living.zoneId, roomType: "living" }));
    // furnish_room reads the whole catalog, not only Pascal's set for the room: its rug and plant are Luw's.
    expect(dressed).toContain("Wool Rug (2.4 × 1.7 m)");
    expect(dressed).toContain("Fiddle Leaf Fig");
    // 2.5 m square: Pascal's 2 m double vanity can't share the back wall with the toilet, Luw's single one does.
    const bath = await json("create_room", { levelId, name: "Bathroom", polygon: [[6, 0], [8.5, 0], [8.5, 2.5], [6, 2.5]] });
    const furnished = await json("furnish_room", { zoneId: bath.zoneId, roomType: "bathroom" });
    expect(furnished.pieces.join(" | ")).toContain("Single Vanity (0.6 × 0.46 m)");
    expect(JSON.stringify(furnished)).not.toContain("bathroom-sink");
    const items = ofType(p.trainings.get(8)!.extras, "item").map((n) => (n.asset as { id: string }).id);
    expect(items).toEqual(expect.arrayContaining(["luw-rug-wool", "luw-fiddle-fig", "luw-vanity-single", "sofa"]));
    // Fetched once for every call (cached for an hour).
    expect(p.luw.calls.filter((c) => c.url.href === url)).toHaveLength(1);
  });

  it("keeps a window and a door Studio saved with Pascal's newer options through edits: a tilt-and-turn window with shutters, a 6-leaf folding door", async () => {
    // Made with the tools, then given what Studio's inspector sets since its 2026-11-07 merge.
    const first = studioProject();
    const made = await connect(first.luw.fetch, {}, STUDIO);
    const make = async (name: string, args: Record<string, unknown>) => {
      const result = await made.call(name, { project_id: 7, ...args });
      expect(result.isError, textOf(result)).toBeFalsy();
      return JSON.parse((result.content[0] as { text: string }).text);
    };
    const levelId = (await make("list_levels", {})).levels[0].id;
    const { wallId } = await make("add_wall", { levelId, start: [0, 0], end: [6, 0] });
    await make("add_door", { wallId, t: 0.3, width: 2.4 });
    await make("add_window", { wallId, t: 0.8, width: 1, height: 1.2 });
    const studioScene = scene(first.trainings.get(8)!.extras);
    const door = Object.assign(Object.values(studioScene.nodes).find((n) => n.type === "door")!, { doorType: "folding", leafCount: 6, handleStyle: "bar" });
    const win = Object.assign(Object.values(studioScene.nodes).find((n) => n.type === "window")!, {
      windowType: "tilt-turn",
      tiltTurnMode: "turn",
      openingDirection: "inward",
      shutters: "louvered",
      shutterSides: "both",
      shutterOpen: 1,
    });
    const studioSaved = structuredClone(studioScene);

    const p = studioProject([{ id: 1, slot: 8, extras: JSON.stringify(studioScene) }]);
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const json = async (name: string, args: Record<string, unknown>) => {
      const result = await call(name, { project_id: 7, ...args });
      expect(result.isError, textOf(result)).toBeFalsy();
      return JSON.parse((result.content[0] as { text: string }).text);
    };
    // An edit elsewhere keeps both as Studio saved them.
    await json("add_wall", { levelId, start: [6, 0], end: [6, 4] });
    const afterWall = scene(p.trainings.get(8)!.extras);
    expect(afterWall.nodes[door.id as string]).toEqual(studioSaved.nodes[door.id as string]);
    expect(afterWall.nodes[win.id as string]).toEqual(studioSaved.nodes[win.id as string]);
    // The tools read them as they are, and verify_scene finds nothing invalid in them.
    expect(await json("get_node", { id: door.id })).toMatchObject({ node: { doorType: "folding", leafCount: 6, handleStyle: "bar" } });
    expect(await json("get_node", { id: win.id })).toMatchObject({ node: { windowType: "tilt-turn", tiltTurnMode: "turn", shutters: "louvered" } });
    const verified = JSON.stringify(await json("verify_scene", {}));
    expect(verified).not.toMatch(new RegExp(`schema_invalid[^}]*(${door.id}|${win.id})`));
    // And an edit of their own: a knob, the sash tilted, the shutters closed.
    await json("apply_patch", {
      patches: [
        { op: "update", id: door.id, data: { handleStyle: "knob" } },
        { op: "update", id: win.id, data: { tiltTurnMode: "tilt", shutterOpen: 0 } },
      ],
    });
    const edited = scene(p.trainings.get(8)!.extras);
    expect(edited.nodes[door.id as string]).toMatchObject({ doorType: "folding", leafCount: 6, handleStyle: "knob" });
    expect(edited.nodes[win.id as string]).toMatchObject({ windowType: "tilt-turn", tiltTurnMode: "tilt", openingDirection: "inward", shutters: "louvered", shutterSides: "both", shutterOpen: 0 });
  });

  it("lays a modular kitchen with Luw Studio's kitchen_add_run: an L with a sink, a cooktop and wall cabinets", async () => {
    const p = studioProject();
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const json = async (name: string, args: Record<string, unknown>) => {
      const result = await call(name, { project_id: 7, ...args });
      expect(result.isError, textOf(result)).toBeFalsy();
      return JSON.parse((result.content[0] as { text: string }).text);
    };
    const levelId = (await json("list_levels", {})).levels[0].id;
    const room = await json("create_room", { levelId, name: "Kitchen", polygon: [[0, 0], [4.2, 0], [4.2, 3.4], [0, 3.4]], doors: [{ wallIndex: 2, t: 0.75 }] });
    const kitchen = await json("kitchen_add_run", { walls: [room.wallIds[0], room.wallIds[1]] });
    expect(kitchen.runs).toHaveLength(2);
    const pieces = kitchen.runs.flatMap((run: { modules: { piece: string }[] }) => run.modules.map((m) => m.piece));
    expect(pieces).toEqual(expect.arrayContaining(["fridge", "sink", "dishwasher", "cooktop"]));
    expect(kitchen.wallCabinets).toBeGreaterThan(2);
    expect(kitchen.hoods).toBe(1);
    const saved = p.trainings.get(8)!.extras;
    expect(ofType(saved, "cabinet").length).toBeGreaterThan(1);
    expect(ofType(saved, "cabinet-module").length).toBeGreaterThan(8);
    const finished = await json("kitchen_finish_run", { runId: kitchen.runId, action: "fill" });
    expect(finished.runId).toBe(kitchen.runId);
  });

  it("lays a bathroom with Luw Studio's bathroom_add: Bath Space's toilet, vanity and shower, which verify_scene reads", async () => {
    const p = studioProject();
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const json = async (name: string, args: Record<string, unknown>) => {
      const result = await call(name, { project_id: 7, ...args });
      expect(result.isError, textOf(result)).toBeFalsy();
      return JSON.parse((result.content[0] as { text: string }).text);
    };
    const levelId = (await json("list_levels", {})).levels[0].id;
    const room = await json("create_room", { levelId, name: "Bathroom", polygon: [[0, 0], [2.8, 0], [2.8, 2.4], [0, 2.4]], doors: [{ wallIndex: 2, t: 0.75 }] });
    const bathroom = await json("bathroom_add", { roomId: room.zoneId });
    const kinds = bathroom.fixtures.map((f: { kind: string }) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(["wall-hung toilet", "vanity", "shower glass"]));
    const saved = JSON.parse(p.trainings.get(8)!.extras) as { nodes: Record<string, { type: string; parentId?: string }> };
    const fixtures = Object.values(saved.nodes).filter((n) => n.type.startsWith("bath-space:"));
    expect(fixtures.map((n) => n.type)).toEqual(expect.arrayContaining(["bath-space:wall-hung-toilet", "bath-space:wall-mounted-vanity", "bath-space:shower-divider"]));
    // A wall holding a fixture is read, not called schema_invalid (Luw Studio's verify_scene).
    const verified = await json("verify_scene", {});
    expect(JSON.stringify(verified.issues ?? [])).not.toContain("schema_invalid");
    const again = await call("bathroom_add", { project_id: 7, roomId: room.zoneId });
    expect(again.isError).toBe(true);
    expect(textOf(again)).toContain("bathroom_not_empty");
  });

  it("keeps the assistant's checkpoints from call to call, as Pascal's server does for a connection", async () => {
    const base = await sceneWithWall();
    const p = studioProject([{ id: 1, slot: 8, extras: base }]);
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const wall = ofType(base, "wall")[0]!;
    const checkpoint = await call("set_checkpoint", { project_id: 7, name: "before the second wall" });
    expect(checkpoint.isError, textOf(checkpoint)).toBeFalsy();
    expect(p.writes()).toHaveLength(0); // a checkpoint changes nothing in the scene
    const added = await call("add_wall", { project_id: 7, levelId: wall.parentId, start: [4, 0], end: [4, 3] });
    const wallId = JSON.parse((added.content[0] as { text: string }).text).wallId as string;
    const verified = await call("verify_scene", { project_id: 7, since: "before the second wall" });
    expect(verified.isError, textOf(verified)).toBeFalsy();
    expect(textOf(verified)).toContain(wallId);
    const session = p.session();
    expect(Object.keys(session.record.checkpoints).sort()).toEqual(["before the second wall", "start"]);
    expect(session.record.made.map((m: { id: string }) => m.id)).toContain(wallId);
  });

  it("starts a new session after an hour without a call", async () => {
    const base = await sceneWithWall();
    const p = studioProject([{ id: 1, slot: 8, extras: base }]);
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    await call("set_checkpoint", { project_id: 7, name: "yesterday" });
    p.trainings.get(1011)!.extras = JSON.stringify({ ...p.session(), at: Date.now() - 2 * 60 * 60 * 1000 });
    const stale = await call("verify_scene", { project_id: 7, since: "yesterday" });
    expect(stale.isError).toBe(true);
    expect(textOf(stale)).toContain("checkpoint_not_found");
  });

  it("creates a project from a template", async () => {
    const created: Recorded[] = [];
    const luw = fakeLuw()
      .on("POST", "/personas", (req: Recorded) => (created.push(req), { status: true, persona: { id: 12 } }))
      .on("POST", "/personas/12/trainings", (req: Recorded) => (created.push(req), { status: true, training_id: 99 }));
    const { call } = await connect(luw.fetch, {}, STUDIO);
    const result = JSON.parse(textOf(await call("luw_studio_create_project", { name: "Garden", template: "garden-house" })));
    expect(result).toMatchObject({ project_id: 12, studio_url: "https://studio.luw.ai/?project=12" });
    expect(created[0]!.json).toEqual({ name: "Garden", profession: "Studio" });
    expect(created[1]!.json.slot).toBe(8);
    expect(ofType(created[1]!.json.extras, "wall").length).toBeGreaterThan(0);
    expect(scene(created[1]!.json.extras).luwFormat).toBe("luw-1");
  });

  it("won't replace a design with a template", async () => {
    const p = studioProject([{ id: 1, slot: 8, extras: await sceneWithWall() }]);
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const result = await call("create_from_template", { project_id: 7, id: "two-bedroom" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/already has a design/);
    expect(p.writes()).toHaveLength(0);
  });

  it("says when a persona isn't a Studio project", async () => {
    const p = studioProject([], { profession: "Interior" });
    const { call } = await connect(p.luw.fetch, {}, STUDIO);
    const result = await call("get_walls", { project_id: 7 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not a Luw Studio project/);
  });
});
