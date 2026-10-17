import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeDesignSchema } from "@pascal-app/core/procedural-items";
import { answerRetiredTools } from "@pascal-app/mcp/tools/retired-tools";
import { z, type ZodType } from "zod";
import { handler, json, type Deps, type Extra, type Server, type ToolContext } from "../context.js";
import { InputError } from "../files.js";
import { loadCatalog } from "./catalog.js";
import { PASCAL_SCENE_RULES } from "./pascal-guide.js";
import { contentCount, defaultScene, pascalTools, runOnScene, type PascalTool } from "./engine.js";
import {
  createProject,
  listProjects,
  loadProject,
  parseScene,
  renameProject,
  saveScene,
  saveSession,
  SceneChangedError,
  type SceneGraphJson,
  serializeScene,
  startScene,
  studioUrl,
  swapUndo,
} from "./projects.js";

// Luw Studio projects for assistants: Pascal's scene tools (engine.ts) on the user's own Luw Studio
// projects, each call naming its project. An edit is saved to the project as it is made, keeps the
// scene it replaced for luw_studio_undo, and shows up in a Studio tab that has the project open.

/**
 * Pascal tools Luw leaves out, and why:
 * - add_object, get_source: compiled geometry scripts need a store Luw doesn't have yet.
 * - view_scene, export_glb: they render, and this server has no renderer.
 * - export_json: get_scene reads the scene; a whole export floods the context.
 * - clear_scene: empties the project; that is done in Studio.
 * - undo, redo: history lives one call long here; luw_studio_undo undoes an edit.
 * - create_house_from_brief: it creates and publishes a Pascal project.
 */
const LEFT_OUT = new Set([
  "add_object",
  "get_source",
  "view_scene",
  "export_glb",
  "export_json",
  "clear_scene",
  "undo",
  "redo",
  "create_house_from_brief",
]);

/** Tools that replace the whole scene: only for a project with nothing built in it. */
const REPLACES_SCENE = new Set(["create_from_template"]);

/**
 * Inputs Pascal's operations read that its open package leaves out of the tool's schema: a host
 * adds them (core's extendVerifyScene, which Pascal's hosted app uses and core doesn't export).
 */
const HOST_INPUTS: Record<string, { input: Record<string, ZodType>; description: string }> = {
  verify_scene: {
    input: {
      since: z
        .string()
        .min(1)
        .optional()
        .describe("A checkpoint's name (set_checkpoint, or \"start\"): also list what changed after it."),
    },
    description:
      "With since: a checkpoint's name, it also lists what was created, changed and deleted after that checkpoint, by level and kind, and what you made that is gone.",
  },
};

/** Inputs that only mean something with Pascal's own project store. */
const STORE_INPUTS: Record<string, string[]> = { create_from_template: ["save", "projectId", "name"] };

const LEGACY =
  "This project was last saved by the previous Luw Studio. Open it once at studio.luw.ai (that upgrades it and keeps a backup of the old version); then it can be edited here. Reading it works now.";

export const STUDIO_GUIDE_URI = "luw://studio/guide";
const DESIGN_SCHEMA_URI = "luw://studio/design-schema";

/** A project's id, as listed here or as Studio's Settings shows it ("luw-1252130"). */
const projectId = z.union([z.number().int().positive(), z.string().regex(/^(luw-)?\d+$/)]);

function projectNumber(value: unknown): number {
  const id = typeof value === "number" ? value : Number(String(value).replace(/^luw-/, ""));
  if (!Number.isInteger(id) || id <= 0) throw new InputError("project_id is a project's number, e.g. 1252130 (or luw-1252130).");
  return id;
}

function guide(): string {
  return [
    "# Luw Studio: editing projects",
    "",
    "Luw Studio (studio.luw.ai) designs buildings in 3D on Pascal's editor. These tools edit the user's Luw Studio projects directly.",
    "",
    "## Workflow",
    "",
    "1. `luw_studio_list_projects` finds the project (newest first; `search` by name). For a new design, `luw_studio_create_project`, optionally from a template.",
    "2. Every scene tool takes `project_id`. A tool that changes the scene saves the project then and there: there is no load or save step.",
    "3. Read before you build: `get_level_summary`, `get_zones`, `get_walls`, `find_by_type`, `get_node`.",
    "4. Build with the semantic tools: `create_story_shell`, `create_room`, `add_door`, `add_window`, `furnish_room`, `place_items`, `paint`, `create_roof`.",
    "5. Check with `verify_scene`, then give the user the project's `studio_url`.",
    "6. `luw_studio_undo` puts back the scene from before the last edit made through these tools; calling it again redoes that edit.",
    "7. `set_checkpoint` names a moment before a big step (a floor, the roof); `verify_scene({ since })` then lists what changed after it. Checkpoints stay with the project while you keep working; after an hour without a call the next session starts afresh.",
    "",
    "A Studio tab that has the project open shows each edit within a few seconds. Edits the user is making in that tab at the same moment win: an edit here that would overwrite them is refused, and the tool says so.",
    "",
    PASCAL_SCENE_RULES,
  ].join("\n");
}

function withNote(result: CallToolResult, note: string): CallToolResult {
  return { ...result, content: [...(result.content ?? []), { type: "text", text: note }] };
}

/**
 * Pascal's write tools say where the change was persisted: with no Pascal project bound they answer
 * `project: null` and "not saved". Here the change is in the Luw project, which they name instead.
 */
function inProject(result: CallToolResult, projectId: number): CallToolResult {
  const fix = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    if (!("unsaved" in value || "persistence" in value || "project" in value)) return value;
    const { unsaved: _unsaved, persistence: _persistence, ...rest } = value as Record<string, unknown>;
    return { ...rest, project: String(projectId) };
  };
  const content = (result.content ?? []).map((part) => {
    if (part.type !== "text" || !part.text.startsWith("{")) return part;
    try {
      return { ...part, text: JSON.stringify(fix(JSON.parse(part.text))) };
    } catch {
      return part;
    }
  });
  return {
    ...result,
    content,
    ...(result.structuredContent ? { structuredContent: fix(result.structuredContent) as Record<string, unknown> } : {}),
  };
}

function inputShape(tool: PascalTool): Record<string, ZodType> {
  const omit = new Set(STORE_INPUTS[tool.name] ?? []);
  const own = Object.fromEntries(Object.entries(tool.config.inputSchema ?? {}).filter(([key]) => !omit.has(key)));
  const readOnly = tool.config.annotations?.readOnlyHint === true;
  return {
    project_id: projectId.describe(
      readOnly
        ? "The Luw Studio project to read: its number from luw_studio_list_projects, or the ID in Studio's Settings."
        : "The Luw Studio project to edit: its number from luw_studio_list_projects, or the ID in Studio's Settings. The change is saved to it.",
    ),
    ...own,
    ...HOST_INPUTS[tool.name]?.input,
  };
}

/**
 * One Pascal tool on a project: load, run, save what changed. A save that lost a race runs once more.
 * The assistant's session (checkpoints, what it made) goes along with every call, as on Pascal's server.
 */
async function runOnProject(tool: PascalTool, args: Record<string, unknown>, ctx: ToolContext, extra: Extra): Promise<CallToolResult> {
  const { project_id: id, ...input } = args;
  for (const key of STORE_INPUTS[tool.name] ?? []) delete input[key];
  const readOnly = tool.config.annotations?.readOnlyHint === true;
  const catalog = () => loadCatalog(ctx.config.studioCatalogUrl, ctx.fetch);
  for (let attempt = 1; ; attempt++) {
    let project = await loadProject(ctx, projectNumber(id));
    const stored = parseScene(project.raw);
    if (!readOnly && stored.kind === "scene" && stored.legacy) throw new InputError(LEGACY);
    let graph: SceneGraphJson;
    if (stored.kind === "scene") graph = stored.graph;
    else {
      graph = await defaultScene();
      project = await startScene(ctx, project, serializeScene(graph));
    }
    if (REPLACES_SCENE.has(tool.name) && contentCount(graph) > 0) {
      throw new InputError(
        `${tool.name} replaces the whole scene, and "${project.name}" already has a design. Start a new project with luw_studio_create_project (it takes a template) instead.`,
      );
    }
    const run = await runOnScene(graph, tool, input, extra, catalog, project.session);
    // Only a convenience: a session that can't be kept starts afresh next time, as Pascal's would.
    const keepSession = async () => {
      if (JSON.stringify(run.session) !== JSON.stringify(project.session))
        await saveSession(ctx, project.id, run.session).catch(() => {});
    };
    if (readOnly || run.result.isError) {
      await keepSession();
      return run.result;
    }
    if (!run.changed) {
      await keepSession();
      return inProject(run.result, project.id);
    }
    if (contentCount(graph) > 0 && contentCount(run.graph) === 0) {
      throw new InputError("This edit would empty the project, so it was not saved. Delete things one by one, or clear the project in Luw Studio.");
    }
    try {
      await saveScene(ctx, project, serializeScene(run.graph));
    } catch (error) {
      if (!(error instanceof SceneChangedError)) throw error;
      if (attempt < 2) continue;
      throw new InputError(
        "The project keeps changing: it is open in Luw Studio and being edited there. Nothing was saved; try again when that stops.",
      );
    }
    await keepSession();
    return withNote(inProject(run.result, project.id), `Saved to Luw Studio project ${project.id}: ${studioUrl(project.id)}`);
  }
}

/** Pascal's contracts name its own library ("Pascal's materials"); here the library is Luw Studio's. */
const asLuwStudio = (text: string | undefined) => text?.replace(/Pascal/g, "Luw Studio");

function registerPascalTool(server: Server, deps: Deps, tool: PascalTool) {
  const { title, outputSchema, annotations } = tool.config;
  const added = HOST_INPUTS[tool.name]?.description;
  const description = asLuwStudio(added ? `${tool.config.description ?? ""} ${added}`.trim() : tool.config.description);
  const call = (args: Record<string, unknown>, extra: Extra) =>
    handler<Record<string, unknown>>(deps, (a, ctx) => runOnProject(tool, a, ctx, extra))(args, extra);
  server.registerTool(
    tool.name,
    { title, description, inputSchema: inputShape(tool), ...(outputSchema ? { outputSchema } : {}), annotations },
    call as never,
  );
}

export function registerStudioTools(server: Server, deps: Deps) {
  server.registerTool(
    "luw_studio_list_projects",
    {
      title: "List Luw Studio projects",
      description:
        "The user's Luw Studio 3D projects, newest first: project_id, name, cover image and studio_url. Every Luw Studio scene tool takes a project_id from here. `search` matches names across all projects.",
      inputSchema: {
        search: z.string().optional().describe("Part of the project's name."),
        page: z.number().int().min(1).optional().describe("Page number (default 1)."),
        limit: z.number().int().min(1).max(50).optional().describe("Projects per page (default 15)."),
      },
      annotations: { title: "List projects", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    handler(deps, async (a, ctx) => json(await listProjects(ctx, a.page ?? 1, a.limit ?? 15, a.search))),
  );

  server.registerTool(
    "luw_studio_create_project",
    {
      title: "Create a Luw Studio project",
      description:
        "Creates a Luw Studio project for a new design: an empty site with one level, or one of Pascal's starter scenes (list_templates). Returns its project_id and studio_url.",
      inputSchema: {
        name: z.string().min(1).max(120).describe("The project's name."),
        template: z.string().optional().describe("A template id from list_templates. Omit for an empty site."),
      },
      annotations: { title: "Create project", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args, extra) =>
      handler<{ name: string; template?: string }>(deps, async (a, ctx) => {
        // Built before the project exists, so a template that fails leaves nothing behind.
        const start = await defaultScene();
        let scene = serializeScene(start);
        if (a.template) {
          const run = await runOnScene(start, pascalTools().get("create_from_template")!, { id: a.template }, extra, async () => []);
          if (run.result.isError) return run.result;
          scene = serializeScene(run.graph);
        }
        const id = await createProject(ctx, a.name.trim(), scene);
        return json({ project_id: id, name: a.name.trim(), template: a.template, studio_url: studioUrl(id) });
      })(args, extra),
  );

  server.registerTool(
    "luw_studio_rename_project",
    {
      title: "Rename a Luw Studio project",
      description: "Renames a Luw Studio project.",
      inputSchema: { project_id: projectId.describe("The project (luw_studio_list_projects)."), name: z.string().min(1).max(120) },
      annotations: { title: "Rename project", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    handler(deps, async (a, ctx) => {
      const id = projectNumber(a.project_id);
      await renameProject(ctx, id, a.name.trim());
      return json({ project_id: id, name: a.name.trim() });
    }),
  );

  server.registerTool(
    "luw_studio_undo",
    {
      title: "Undo the last assistant edit",
      description:
        "Puts back a Luw Studio project's scene from before the last edit made through these tools. Calling it again redoes that edit. Edits made in Studio itself are undone there.",
      inputSchema: { project_id: projectId.describe("The project (luw_studio_list_projects).") },
      annotations: { title: "Undo", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    handler(deps, async (a, ctx) => {
      const project = await loadProject(ctx, projectNumber(a.project_id));
      await swapUndo(ctx, project);
      return json({ project_id: project.id, undone: true, studio_url: studioUrl(project.id) });
    }),
  );

  for (const tool of pascalTools().values()) {
    if (!LEFT_OUT.has(tool.name)) registerPascalTool(server, deps, tool);
  }
  // A client or a saved script still calling a tool Pascal retired (find_nodes, describe_node,
  // validate_scene) is told its replacement and how to use it, as Pascal's own server answers.
  answerRetiredTools(server as never);

  server.registerResource(
    "studio-guide",
    STUDIO_GUIDE_URI,
    { title: "Luw Studio: editing projects", description: "How to design in Luw Studio projects with these tools.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide() }] }),
  );
  server.registerResource(
    "studio-design-schema",
    DESIGN_SCHEMA_URI,
    {
      title: "Design schema",
      description: "JSON Schema, limits, rules and an example for designs (procedural items) that place_design places. validate_design is the authority.",
      mimeType: "application/json",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(describeDesignSchema()) }] }),
  );
}
