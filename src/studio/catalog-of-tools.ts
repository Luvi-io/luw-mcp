import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BATCHABLE_TOOLS } from "@pascal-app/core/agent-tools";
import { z, type ZodType } from "zod";
import { luwName, luwNamed } from "../luw-name.js";
import type { PascalTool, PascalToolConfig } from "./engine.js";
import { PASCAL_SCENE_RULES } from "./pascal-guide.js";

// Which of Pascal's tools Luw offers and with which inputs, and the guide that goes with them: shared by
// the MCP server's Studio tools (tools.ts, each call naming its project) and the engine entry
// (src/engine, for a host that holds the scene itself, as luw-api does).

/**
 * Pascal tools Luw leaves out, and why:
 * - add_object, get_source: compiled geometry scripts need a store Luw doesn't have yet.
 * - view_scene, export_glb: they render, and this server has no renderer.
 * - export_json: get_scene reads the scene; a whole export floods the context.
 * - clear_scene: empties the project; that is done in Studio.
 * - undo, redo: history lives one call long here; luw_studio_undo undoes an edit.
 * - create_house_from_brief: it creates and publishes a Pascal project.
 * - author_scene: it compiles item modules, which need the same store as add_object.
 * - design_brief: furnishing isn't held behind a brief here (engine.ts), as in Studio's assistant.
 * - kitchen_check_clearance: it reads every kind's definitions (doors, items), which this server doesn't load.
 */
export const LEFT_OUT: ReadonlySet<string> = new Set([
  "add_object",
  "get_source",
  "view_scene",
  "export_glb",
  "export_json",
  "clear_scene",
  "undo",
  "redo",
  "create_house_from_brief",
  "author_scene",
  "design_brief",
  "kitchen_check_clearance",
]);

/** Tools that replace the whole scene: only for a project with nothing built in it. */
export const REPLACES_SCENE: ReadonlySet<string> = new Set(["create_from_template"]);

/**
 * Inputs Pascal's operations read that its open package leaves out of the tool's schema: a host
 * adds them (core's extendVerifyScene, which Pascal's hosted app uses and core doesn't export).
 */
export const HOST_INPUTS: Record<string, { input: Record<string, ZodType>; description: string }> = {
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
export const STORE_INPUTS: Record<string, string[]> = { create_from_template: ["save", "projectId", "name"] };

/** The tools run_batch runs here: Pascal's batchable tools, less those Luw leaves out (add_object). */
export const BATCH_TOOLS = BATCHABLE_TOOLS.filter((name) => !LEFT_OUT.has(name)) as [string, ...string[]];

/**
 * Descriptions Luw writes itself, where Pascal's names what this host doesn't offer: run_batch's lists
 * add_object, and create_from_template's speaks of Pascal's bridge and project store. ChatGPT's
 * directory scan flags both (an operation run that isn't offered on its own; an unclear description).
 */
const OWN_DESCRIPTIONS: Record<string, string> = {
  create_from_template:
    "Replaces the scene of an empty Luw Studio project with a starter template (ids from list_templates), with fresh ids. Only for a project with nothing built in it; for a new design, luw_studio_create_project takes a template too.",
  run_batch:
    "Runs several scene tools in one call, in order, each on the scene the calls before it left. The batch is one undo step and the result reports each call. For repeated or known-in-advance work; every tool it runs is also offered on its own, with the same input. A call can't use an id another call of the same batch creates: the report gives created ids for later calls. onRefusal stop (default): a refused call (an invalid input or a refused edit) stops the batch and nothing is applied; skip: the other calls are applied and each refusal is reported. " +
    `Tools: ${BATCH_TOOLS.join(", ")}.`,
};

/**
 * What Luw adds to a description of Pascal's. place_items takes a turn without saying which way 0 faces:
 * an assistant furnishing a bedroom guessed, and the bed stood with its foot to the wall.
 */
const OWN_NOTES: Record<string, string> = {
  place_items:
    "At rotation 0 a floor item's front faces +z and its back (a bed's headboard, the back of a sofa, wardrobe or cabinet) is toward -z; 90 turns the front to +x, 180 to -z, -90 to -x. A piece against a wall has its back to that wall and its front to the room: place_in_room works out that spot and turn by itself.",
};

/** Inputs Luw words itself: run_batch names its tools in the schema, so only those can be called. */
const OWN_INPUTS: Record<string, Record<string, ZodType>> = {
  run_batch: {
    calls: z
      .array(
        z.object({
          tool: z.enum(BATCH_TOOLS).describe("The scene tool to run."),
          input: z.record(z.string(), z.unknown()).optional().describe("That tool's input, as when calling it on its own."),
        }),
      )
      .min(1)
      .max(64),
  },
};

/**
 * Inputs for geometry scripts, which this host can't run (it answers scripts_unavailable): left out of
 * every tool that takes `code`, so no tool offers what it refuses. add_door and add_window's nodeId only
 * rebuilds a script, so it goes too; add_column's also resizes a column by its fields, so it stays,
 * described without scripts.
 */
const SCRIPT_INPUTS = ["code", "language", "params"];
const SCRIPT_ONLY_REBUILD: ReadonlySet<string> = new Set(["add_door", "add_window"]);
const OWN_FIELD_DESCRIPTIONS: Record<string, Record<string, string>> = {
  add_column: { nodeId: "Change this column instead of adding one: the size fields you pass replace its current ones." },
};

/**
 * Sentences that send the assistant to scripts or to tools Luw leaves out (add_object, get_source,
 * view_scene), dropped from these tools' descriptions; Pascal's wording is otherwise kept.
 */
const SCRIPT_SENTENCE_TOOLS: ReadonlySet<string> = new Set(["add_door", "add_window", "add_column", "furnish_room"]);
const SCRIPT_SENTENCE = /\b(add_object|get_source|view_scene|run_batch)\b|\bscript|^Params named/;
function withoutScripts(description: string): string {
  return description
    .replace(/; what (?:they|it) cannot express \([^)]*\) is written as a script in code, never left as not possible\./g, ".")
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .filter((sentence) => !SCRIPT_SENTENCE.test(sentence))
    .join(" ");
}

/** What refuses an edit to a scene Studio 0.9 saved, until Studio upgrades it. */
export const LEGACY =
  "This project was last saved by the previous Luw Studio. Open it once at studio.luw.ai (that upgrades it and keeps a backup of the old version); then it can be edited here. Reading it works now.";

/** A project's id, as listed here or as Studio's Settings shows it ("luw-1252130"). */
export const projectId = z.union([z.number().int().positive(), z.string().regex(/^(luw-)?\d+$/)]);

/** Pascal's SDK v2 tools give a whole object schema, the v1 ones gave its fields: either way, the fields. */
function pascalShape(schema: PascalToolConfig["inputSchema"]): Record<string, ZodType> {
  if (!schema) return {};
  return schema instanceof Object && "shape" in schema && typeof schema.shape === "object"
    ? (schema.shape as unknown as Record<string, ZodType>)
    : (schema as unknown as Record<string, ZodType>);
}

/** A tool's own inputs as Luw offers them: without the store-only ones, with the host's, worded for Luw Studio. */
export function toolFields(tool: PascalTool): Record<string, ZodType> {
  const shape = pascalShape(tool.config.inputSchema);
  const omit = new Set(STORE_INPUTS[tool.name] ?? []);
  if ("code" in shape) for (const key of SCRIPT_INPUTS) omit.add(key);
  if (SCRIPT_ONLY_REBUILD.has(tool.name)) omit.add("nodeId");
  const worded = OWN_FIELD_DESCRIPTIONS[tool.name] ?? {};
  const own = Object.fromEntries(
    Object.entries(shape)
      .filter(([key]) => !omit.has(key))
      .map(([key, field]) => {
        const description = worded[key] ?? field.description;
        return [key, description ? field.describe(luwName(description)) : field];
      }),
  );
  return { ...own, ...OWN_INPUTS[tool.name], ...HOST_INPUTS[tool.name]?.input };
}

/** The MCP server's inputs for a tool: its fields after the project it works on. */
export function inputShape(tool: PascalTool): Record<string, ZodType> {
  const readOnly = tool.config.annotations?.readOnlyHint === true;
  return {
    project_id: projectId.describe(
      readOnly
        ? "The Luw Studio project to read: its number from luw_studio_list_projects, or the ID in Studio's Settings."
        : "The Luw Studio project to edit: its number from luw_studio_list_projects, or the ID in Studio's Settings. The change is saved to it.",
    ),
    ...toolFields(tool),
  };
}

/** A tool's description as Luw offers it: worded for Luw Studio, with what the host's inputs add. */
export function toolDescription(tool: PascalTool): string | undefined {
  if (OWN_DESCRIPTIONS[tool.name]) return OWN_DESCRIPTIONS[tool.name];
  const added = [HOST_INPUTS[tool.name]?.description, OWN_NOTES[tool.name]].filter(Boolean).join(" ");
  const pascal = SCRIPT_SENTENCE_TOOLS.has(tool.name) && tool.config.description ? withoutScripts(tool.config.description) : tool.config.description;
  return luwNamed(added ? `${pascal ?? ""} ${added}`.trim() : pascal);
}

/**
 * Pascal's write tools say where the change was persisted: with no Pascal project bound they answer
 * `project: null` and "not saved". Here the change is in the Luw project, which they name instead.
 */
export function inProject(result: CallToolResult, projectId: number | string): CallToolResult {
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

const MCP_WORKFLOW = [
  "## Workflow",
  "",
  "1. `luw_studio_list_projects` finds the project (newest first; `search` by name). For a new design, `luw_studio_create_project`, optionally from a template.",
  "2. Every scene tool takes `project_id`. A tool that changes the scene saves the project then and there: there is no load or save step.",
  "3. Read before you build: `get_level_summary`, `get_zones`, `get_walls`, `find_by_type`, `get_node`.",
  "4. Build with the semantic tools: `create_story_shell`, `create_room`, `add_door`, `add_window`, `furnish_room`, `place_items`, `paint`, `create_roof`.",
  "5. Check with `verify_scene`, then give the user the project's `studio_url`.",
  "6. `luw_studio_undo` puts back the scene from before the last edit made through these tools; calling it again redoes that edit.",
  "7. `set_checkpoint` names a moment before a big step (a floor, the roof); `verify_scene({ since })` then lists what changed after it. Checkpoints stay with the project while you keep working; after an hour without a call the next session starts afresh.",
];

const API_WORKFLOW = [
  "## Workflow",
  "",
  "1. The project is already open: every scene tool works on it, and a tool that changes the scene saves it then and there. There is no load or save step.",
  "2. Read before you build: `get_level_summary`, `get_zones`, `get_walls`, `find_by_type`, `get_node`.",
  "3. Build with the semantic tools: `create_story_shell`, `create_room`, `add_door`, `add_window`, `furnish_room`, `place_items`, `paint`, `create_roof`.",
  "4. Check with `verify_scene` before you finish.",
  "5. `set_checkpoint` names a moment before a big step (a floor, the roof); `verify_scene({ since })` then lists what changed after it.",
];

/**
 * How to design in Luw Studio with these tools. `forApi`: for a host that has the project open itself
 * (luw-api), without the MCP workflow's project_id and luw_studio_* steps.
 */
export function studioGuide(options: { forApi?: boolean } = {}): string {
  const api = options.forApi === true;
  return [
    "# Luw Studio: editing projects",
    "",
    api
      ? "Luw Studio (studio.luw.ai) designs buildings in 3D. These tools edit one Luw Studio project directly."
      : "Luw Studio (studio.luw.ai) designs buildings in 3D. These tools edit the user's Luw Studio projects directly.",
    "",
    ...(api ? API_WORKFLOW : MCP_WORKFLOW),
    "",
    "Furniture comes from the catalog first: `search_assets`, and `view_assets` shows a piece's picture, size and paintable surfaces when the choice matters. A piece the catalog lacks, or one of the user's own size (a fitted shelf, an alcove desk, a built-in bench), is a design: check it with `validate_design`, then `place_design`" +
      (api ? "." : " (its schema is the luw://studio/design-schema resource)."),
    "",
    "A kitchen's cabinets are `kitchen_add_run`: a modular kitchen along one wall, or two or three walls meeting at corners (an L or a U), with the sink, cooktop, fridge, wall cabinets and hood, which the user edits in Studio like one they drew; not catalog counters. `kitchen_finish_run` aligns a run or closes small gaps at its ends. A bathroom's fixtures are `bathroom_add`: a toilet, a vanity with its basin and mirror, a walk-in shower or a bath, laid out against the room's walls with room to use each, which the user edits in Studio's Bathrooms plugin; not catalog pieces.",
    "",
    "Services wait for the finish: a draft has none, and they come only when the user asks to finalize the design or names them. Ducts, pipes and the air conditioner's lineset are `apply_patch` creates on the level: `duct-segment` and `pipe-segment` with a `path` of [x, y, z] points in metres on the level (y above its floor: ducts just under the ceiling, drains at the floor), sizes in inches (`diameter`), `system` supply or return for a duct and waste or vent for a pipe; `duct-terminal` (a register, diffuser or grille), `hvac-equipment` (furnace, air handler or condenser) and `pipe-trap` by `position`; `lineset` by `path` from the condenser to the indoor unit. A run that exists changes with `duct_edit`, `pipe_grade`, `pipe_resize`, `pipe_offset` and `pipe_connect`, which keep its joints together. The Skeleton X-ray (wall framing, foundation, and the wiring, plumbing and HVAC it sketches from the model) and streets are added in Studio, by its assistant or its panels. All of it is a concept sketch, not engineering: a licensed engineer designs the real systems, and none of it is code-compliant by being drawn here.",
    "",
    "A Studio tab that has the project open shows each edit within a few seconds. Edits the user is making in that tab at the same moment win: an edit here that would overwrite them is refused, and the tool says so.",
    "",
    api ? PASCAL_SCENE_RULES.replace(" Read `luw://studio/design-schema` for its JSON Schema, rules and a worked example.", "") : PASCAL_SCENE_RULES,
  ].join("\n");
}
