// @luw-ai/mcp/engine: Luw Studio's scene tools without the MCP server, for a host that holds a project's
// scene itself and runs the tools on it in its own process (luw-api, Luw.ai Studio's API, runs agent
// turns with it). The same Pascal tools, inputs, descriptions and guide as the MCP server's Studio
// tools (src/studio), on a scene graph the caller passes in: nothing here reads or writes a project,
// and importing it makes no network call. A tool reads Studio's item catalog when it places furniture.
//
// Every type the entry exports is declared in this file, so its declarations (dist/engine.d.ts) stand
// alone.

import { z } from "zod";
import { STUDIO_CATALOG_URL } from "../config.js";
import { luwNamed } from "../luw-name.js";
import { flattenTuples } from "../schema-compat.js";
import { loadCatalog as loadStudioCatalog, studioAssetViews as studioViews } from "../studio/catalog.js";
import {
  inProject,
  LEFT_OUT,
  LEGACY,
  REPLACES_SCENE,
  STORE_INPUTS,
  studioGuide as guide,
  toolDescription,
  toolFields,
} from "../studio/catalog-of-tools.js";
import {
  contentCount as countContent,
  defaultScene as startingScene,
  pascalTools as tools,
  runOnScene as run,
  type PascalTool,
} from "../studio/engine.js";
import { parseScene as parseStored, SCENE_FORMAT as FORMAT, serializeScene as serialize } from "../studio/projects.js";
import { VERSION } from "../version.js";

/** A Luw Studio scene: Pascal's scene graph JSON, as Studio stores it without its `luwFormat` stamp. */
export interface SceneGraphJson {
  nodes: Record<string, unknown>;
  rootNodeIds: string[];
  [key: string]: unknown;
}

/** A project's stored scene as read: nothing saved yet, or a scene (`legacy`: saved by Studio 0.9). */
export type StoredScene = { kind: "empty" } | { kind: "scene"; graph: SceneGraphJson; legacy: boolean };

/** One part of a tool's answer (MCP content: text, or an image as base64 `data` with its `mimeType`). */
export interface ToolContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

/** A tool's answer, as an MCP server returns it. `isError`: the tool refused, and the text says why. */
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

/** A tool as a model calls it: a function with a JSON Schema for its input (no tuples, no project_id). */
export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** The tool only reads the scene. */
  read_only: boolean;
}

/** One tool call on a scene. */
export interface ToolRun {
  result: ToolResult;
  /** Whether the call changed the scene; a read, a refusal or an error never does. */
  changed: boolean;
  /** The scene after the call: the scene passed in when nothing changed. */
  graph: SceneGraphJson;
  /** The assistant's session after the call (its checkpoints and what it made), to pass to the next call. */
  session: unknown;
}

export interface RunToolOptions {
  /** Studio's item catalog (default https://studio.luw.ai/api/catalog); "" uses the built-in list. */
  catalogUrl?: string;
  /** How the catalog and catalog pieces' pictures are fetched (default the global fetch). */
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** The project the scene is, for the tools' answers that name where a change was saved. */
  projectId?: number | string;
}

/** An item of Studio's catalog. */
export interface CatalogItem {
  id: string;
  src: string;
  dimensions: number[];
  [key: string]: unknown;
}

/** A Pascal tool as the engine holds it. */
export interface EngineTool {
  name: string;
  config: {
    title?: string;
    description?: string;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; title?: string };
    [key: string]: unknown;
  };
}

/** The version of @luw-ai/mcp this engine came with. */
export const ENGINE_VERSION: string = VERSION;

/** What Studio stamps into a scene it saved; a stored scene without it is a Studio 0.9 ("legacy") project. */
export const SCENE_FORMAT: string = FORMAT;

/** What a host answers when asked to edit a legacy scene (it can be read). */
export const LEGACY_MESSAGE: string = LEGACY;

/** Every Pascal tool the engine registered, Luw's left-out ones included (apiToolDefinitions leaves them out). */
export const pascalTools: () => ReadonlyMap<string, EngineTool> = tools as unknown as () => ReadonlyMap<string, EngineTool>;

/** Pascal's starting scene for an empty project: a site, a building and one level. */
export const defaultScene: () => Promise<SceneGraphJson> = startingScene;

/** Building content in a scene: everything but the site, building and level scaffold. */
export const contentCount: (graph: SceneGraphJson | null) => number = countContent;

/** A stored scene (a project's slot-8 `extras`), read the way Studio reads it. Throws on damaged JSON. */
export const parseScene: (raw: string) => StoredScene = parseStored;

/** A scene as Studio stores it (stamped with SCENE_FORMAT). */
export const serializeScene: (graph: SceneGraphJson) => string = serialize;

/** Studio's catalog, fetched at most hourly; the built-in list when it can't be read. */
export const loadCatalog: (url: string, fetchImpl: typeof fetch) => Promise<readonly CatalogItem[]> = loadStudioCatalog as unknown as (
  url: string,
  fetchImpl: typeof fetch,
) => Promise<readonly CatalogItem[]>;

/** What view_assets and paint read of a catalog piece, for runOnScene. */
export const studioAssetViews: (catalogUrl: string, fetchImpl: typeof fetch) => unknown = studioViews;

/** One Pascal tool on a scene, as the MCP server runs it, without Luw's checks: runToolOnGraph adds them. */
export const runOnScene: (
  graph: SceneGraphJson,
  tool: EngineTool,
  args: Record<string, unknown>,
  extra: unknown,
  catalog: () => Promise<readonly CatalogItem[]>,
  session?: unknown,
  assetViews?: unknown,
) => Promise<ToolRun> = run as unknown as (
  graph: SceneGraphJson,
  tool: EngineTool,
  args: Record<string, unknown>,
  extra: unknown,
  catalog: () => Promise<readonly CatalogItem[]>,
  session?: unknown,
  assetViews?: unknown,
) => Promise<ToolRun>;

/**
 * How to design in Luw Studio with these tools, as the MCP server's luw://studio/guide says it.
 * `forApi`: for a host that has the project open itself, without the MCP workflow's project_id and
 * luw_studio_* steps.
 */
export const studioGuide: (options?: { forApi?: boolean }) => string = guide;

/** The tools a host offers a model: the MCP server's Studio scene tools (Pascal's, minus Luw's left-out ones). */
function offered(): PascalTool[] {
  return [...tools().values()].filter((tool) => !LEFT_OUT.has(tool.name));
}

function jsonSchema(tool: PascalTool): Record<string, unknown> {
  // As the MCP SDK lists a tool (draft-07, the input side), then without tuples (schema-compat.ts).
  const schema = z.toJSONSchema(z.object(toolFields(tool)), { target: "draft-7", io: "input" }) as Record<string, unknown>;
  const { $schema: _schema, ...rest } = flattenTuples(schema) as Record<string, unknown>;
  return rest;
}

/**
 * The scene tools as a model calls them: `{name, description, input_schema}` for every tool the MCP
 * server's Studio toolset offers, with the same descriptions and inputs, but no project_id (the host
 * has the project open). The schemas have no tuples.
 */
export function apiToolDefinitions(): ToolDefinition[] {
  return luwNamed(offered().map((tool) => ({
    name: tool.name,
    ...(tool.config.title ? { title: tool.config.title } : {}),
    description: toolDescription(tool) ?? tool.name,
    input_schema: jsonSchema(tool),
    read_only: tool.config.annotations?.readOnlyHint === true,
  })));
}

const refusal = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

/** How the MCP SDK words arguments a tool's schema refuses. */
function invalidArguments(name: string, error: z.ZodError): string {
  const issues = error.issues
    .map((issue) => (issue.path.length ? `${issue.message} at ${issue.path.map(String).join(".")}` : issue.message))
    .join("\n");
  return `Input validation error: Invalid arguments for tool ${name}: ${issues}`;
}

/**
 * Runs one scene tool on a scene, as the MCP server runs it on a project: the arguments checked against
 * the tool's schema (and its defaults and units applied), a tool that replaces the scene refused on a
 * scene with something built in it, an edit that would empty the scene refused, and the answer naming
 * the project rather than "not saved". The caller saves `graph` when `changed`, and passes `session`
 * to its next call. A tool the engine doesn't offer, and every refusal, answer with `isError` (the text
 * says why) and change nothing.
 */
export async function runToolOnGraph(
  graph: SceneGraphJson,
  session: unknown,
  name: string,
  args: Record<string, unknown> | undefined,
  options: RunToolOptions = {},
): Promise<ToolRun> {
  const unchanged = (result: ToolResult, nextSession: unknown = session): ToolRun => ({ result, changed: false, graph, session: nextSession });
  const tool = LEFT_OUT.has(name) ? undefined : tools().get(name);
  if (!tool) return unchanged(refusal(`Unknown tool: ${name}. The scene tools are listed with their inputs.`));
  const input: Record<string, unknown> = { ...(args ?? {}) };
  for (const key of STORE_INPUTS[name] ?? []) delete input[key];
  if (REPLACES_SCENE.has(name) && countContent(graph) > 0) {
    return unchanged(refusal(`${name} replaces the whole scene, and this project already has a design. It only starts an empty project.`));
  }
  const parsed = await z.object(toolFields(tool)).safeParseAsync(input);
  if (!parsed.success) return unchanged(refusal(invalidArguments(name, parsed.error)));

  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const catalogUrl = options.catalogUrl ?? STUDIO_CATALOG_URL;
  const signal = options.signal ?? new AbortController().signal;
  // What Pascal's tools read of the MCP request they run in: only its signal.
  const extra = { signal, mcpReq: { signal }, requestId: 0, sendNotification: async () => {}, sendRequest: async () => ({}) };
  const done = await run(
    graph,
    tool,
    parsed.data as Record<string, unknown>,
    extra as never,
    () => loadStudioCatalog(catalogUrl, fetchImpl),
    session,
    studioViews(catalogUrl, fetchImpl),
  );
  const result = luwNamed(done.result) as unknown as ToolResult;
  // As the MCP server answers: a read or a refusal as the tool gave it, an edit naming the project.
  if (tool.config.annotations?.readOnlyHint === true || result.isError) return unchanged(result, done.session);
  const answer = options.projectId === undefined ? result : (inProject(result as never, options.projectId) as unknown as ToolResult);
  if (!done.changed) return unchanged(answer, done.session);
  if (countContent(graph) > 0 && countContent(done.graph) === 0) {
    return unchanged(refusal("This edit would empty the project, so it was not made. Delete things one by one, or clear the project in Luw Studio."), done.session);
  }
  return { result: answer, changed: true, graph: done.graph, session: done.session };
}
