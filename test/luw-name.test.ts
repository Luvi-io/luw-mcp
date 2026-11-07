import { describe, expect, it } from "vitest";
import { connect, fakeLuw, textOf } from "./helpers.js";

// What the server and the engine entry hand a model or a user names Luw Studio, never the editor it runs on.

/** Ids a model may have to send back as they are: luwName (src/luw-name.ts) keeps them. */
const IDENTIFIERS = ["pascal:core", "pascalNodeId"];
const named = (text: string) => IDENTIFIERS.reduce((rest, id) => rest.replaceAll(id, ""), text).match(/.{0,60}pascal.{0,60}/gi) ?? [];

const ALL = { LUW_TOOLSETS: "all", LUW_STUDIO_CATALOG_URL: "" };
const NO_CATALOG = { catalogUrl: "" };

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
    const refused = await call("add_door", { project_id: 7, nodeId: "door_1" });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("This Luw Studio server cannot run geometry scripts.");
    const unparsed = await call("validate_design", { project_id: 7, design: "{}" });
    expect(unparsed.isError, textOf(unparsed)).toBeFalsy();
    expect(unparsed.structuredContent).toMatchObject({ valid: false, schemaUri: "luw://studio/design-schema" });
    expect(named(JSON.stringify([refused, unparsed]))).toEqual([]);

    const { defaultScene, runToolOnGraph } = await import("../src/engine/index.js");
    const run = await runToolOnGraph(await defaultScene(), null, "add_door", { nodeId: "door_1" }, NO_CATALOG);
    expect(run.result.isError).toBe(true);
    expect(run.result.content[0]!.text).toContain("This Luw Studio server cannot run geometry scripts.");
    expect(named(JSON.stringify(run.result))).toEqual([]);
  });

  it("leaves the answers of Luw's own tools as they are: they are the user's", async () => {
    const luw = fakeLuw().on("GET", "/personas/ft-Studio", () => ({ status: true, personas: [{ id: 7, name: "Pascal's house" }] }));
    const { call } = await connect(luw.fetch, {}, ALL);
    expect(textOf(await call("luw_studio_list_projects", {}))).toContain("Pascal's house");
  });
});
