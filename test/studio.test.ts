import { describe, expect, it } from "vitest";
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
    for (const name of ["luw_studio_list_projects", "luw_studio_create_project", "luw_studio_rename_project", "luw_studio_undo", "create_room", "furnish_room", "add_door", "get_level_summary", "paint", "get_site", "place_building", "add_fence", "run_batch", "set_checkpoint"]) {
      expect(names).toContain(name);
    }
    for (const name of ["add_object", "view_scene", "clear_scene", "undo", "redo", "export_glb", "save_scene", "load_scene"]) {
      expect(names).not.toContain(name);
    }
    const sceneTools = tools.filter((t) => !t.name.startsWith("luw_"));
    expect(sceneTools.length).toBeGreaterThan(40);
    for (const tool of sceneTools) expect(tool.inputSchema.required).toContain("project_id");
    expect(tools.find((t) => t.name === "create_from_template")?.inputSchema.properties).not.toHaveProperty("save");
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
    expect(scene(saved.extras).luwFormat).toBe("pascal-1");
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
    expect(scene(created[1]!.json.extras).luwFormat).toBe("pascal-1");
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
