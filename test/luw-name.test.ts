import { describe, expect, it } from "vitest";
import { connect, fakeLuw, textOf } from "./helpers.js";

// What the server and the engine entry hand a model or a user names Luw Studio, never the editor it runs on.

/** Ids a model may have to send back as they are: luwName (src/luw-name.ts) keeps them. */
const IDENTIFIERS = ["pascalNodeId"];
const named = (text: string) => IDENTIFIERS.reduce((rest, id) => rest.replaceAll(id, ""), text).match(/.{0,60}pascal.{0,60}/gi) ?? [];

const ALL = { LUW_TOOLSETS: "all", LUW_STUDIO_CATALOG_URL: "" };

/** A Studio project with nothing saved yet, as Rails serves it. */
const emptyProject = () =>
  fakeLuw()
    .on("GET", "/personas/7", () => ({ status: true, persona: { id: 7, name: "Beach house", profession: "Studio", trainings: [] } }))
    .on("POST", "/personas/7/trainings", () => ({ status: true, training_id: 900 }));

describe("Luw Studio's name", () => {
  it("is the only one in what either entry lists: instructions, tools, resources, guides and prompts", async () => {
    for (const mode of ["local", "remote"] as const) {
      const { client } = await connect(fakeLuw().fetch, { mode }, ALL);
      const prompts = (await client.listPrompts()).prompts;
      const served = {
        instructions: client.getInstructions(),
        tools: (await client.listTools()).tools,
        resources: (await client.listResources()).resources,
        templates: (await client.listResourceTemplates()).resourceTemplates,
        prompts,
        promptTexts: await Promise.all(
          prompts.map((p) => client.getPrompt({ name: p.name, arguments: Object.fromEntries((p.arguments ?? []).map((a) => [a.name, "x"])) })),
        ),
        guides: await Promise.all(["luw://guide", "luw://studio/guide", "luw://studio/design-schema"].map((uri) => client.readResource({ uri }))),
      };
      expect(served.tools.length, mode).toBeGreaterThan(80);
      expect(named(JSON.stringify(served)), mode).toEqual([]);
    }
    const engine = await import("../src/engine/index.js");
    const tools = engine.apiToolDefinitions();
    expect(tools.length).toBeGreaterThan(60);
    const guides = [engine.studioGuide({ forApi: true }), engine.studioGuide(), engine.LEGACY_MESSAGE];
    expect(named(JSON.stringify({ tools, guides }))).toEqual([]);
  });

  it("is what a vendored tool's refusal says, and where its answer points", async () => {
    const { client, call } = await connect(emptyProject().fetch, {}, ALL);
    await client.listTools(); // the client checks a result against the output schema it listed
    // add_door offers no nodeId here (it only rebuilds a script), so this is the refusal for a door with no wall.
    const refused = await call("add_door", { project_id: 7, nodeId: "door_1" });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/wall/i);
    const unparsed = await call("validate_design", { project_id: 7, design: "{}" });
    expect(unparsed.isError, textOf(unparsed)).toBeFalsy();
    expect(unparsed.structuredContent).toMatchObject({ valid: false, schemaUri: "luw://studio/design-schema" });
    expect(named(JSON.stringify([refused, unparsed]))).toEqual([]);

    // Pascal's own tool, past Luw's schema, still refuses a script rebuild, and says so in Luw Studio's name.
    const { defaultScene, pascalTools, runOnScene } = await import("../src/studio/engine.js");
    const { luwNamed } = await import("../src/luw-name.js");
    const signal = new AbortController().signal;
    const extra = { signal, mcpReq: { signal }, requestId: 0, sendNotification: async () => {}, sendRequest: async () => ({}) };
    const run = await runOnScene(await defaultScene(), pascalTools().get("add_door")!, { nodeId: "door_1" }, extra as never, async () => []);
    const script = luwNamed(run.result);
    expect(script.isError).toBe(true);
    expect(JSON.stringify(script.content)).toContain("This Luw Studio server cannot run geometry scripts.");
    expect(named(JSON.stringify(script))).toEqual([]);
  });

  it("hands a scene's ids out as luw:, and reads them back as the scene spells them", async () => {
    const { luwNamed, studioIds } = await import("../src/luw-name.js");
    const scene = { installedPlugins: ["pascal:trees", "webxr:core"], plugins: { "pascal:pool": { on: true } }, $schema: "pascal://schema/design" };
    const out = luwNamed(scene);
    expect(out).toEqual({ installedPlugins: ["luw:trees", "webxr:core"], plugins: { "luw:pool": { on: true } }, $schema: "luw://studio/design-schema" });
    expect(luwNamed('{"installedPlugins":["pascal:landscape"]}')).toBe('{"installedPlugins":["luw:landscape"]}');
    expect(studioIds(out)).toEqual({ ...scene, $schema: "luw://studio/design-schema" });
    expect(studioIds({ note: "luw: is the prefix", ref: "luw://studio/guide" })).toEqual({ note: "luw: is the prefix", ref: "luw://studio/guide" });
  });

  it("leaves the answers of Luw's own tools as they are: they are the user's", async () => {
    const luw = fakeLuw().on("GET", "/personas/ft-Studio", () => ({ status: true, personas: [{ id: 7, name: "Pascal's house" }] }));
    const { call } = await connect(luw.fetch, {}, ALL);
    expect(textOf(await call("luw_studio_list_projects", {}))).toContain("Pascal's house");
  });
});
