import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AssetInput } from "@pascal-app/core";
import {
  type AssetViewLoader,
  createAssetViewLoader,
  createFetchAssetViewIO,
  parseSessionRecord,
  recordMade,
  type SceneNodes,
} from "@pascal-app/core/agent-operations";
import useScene from "@pascal-app/core/store";
import { SceneBridge } from "@pascal-app/mcp/bridge";
import { createSceneOperations } from "@pascal-app/mcp/operations";
import { registerTools } from "@pascal-app/mcp/tools/index";
import type { ZodType } from "zod";
import type { Extra } from "../context.js";
import type { SceneGraphJson } from "./projects.js";

// Pascal's own MCP tools (@pascal-app/mcp, MIT), run headless on Pascal's core store: the same tools
// editor.pascal.app's MCP offers and Luw Studio's assistant runs in the browser. Luw keeps no scene
// between calls: each call loads its project's scene and the assistant's session (its checkpoints and
// what it made, which Pascal's server keeps for a connection) into the store, runs the tool and reads
// both back out (tools.ts saves them). The store is one per process, so calls take turns.

export type PascalToolConfig = {
  title?: string;
  description?: string;
  /** An object schema (Pascal's tools for the MCP SDK v2) or its fields. */
  inputSchema?: Record<string, ZodType> | ZodType;
  outputSchema?: Record<string, ZodType> | ZodType;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; title?: string };
};
type PascalCallback = (args: Record<string, unknown>, extra: Extra) => CallToolResult | Promise<CallToolResult>;
export type PascalTool = { name: string; config: PascalToolConfig; callback: PascalCallback };

interface Runtime {
  bridge: SceneBridge;
  tools: Map<string, PascalTool>;
}

let runtime: Runtime | null = null;
/** The catalog the call in progress reads (a call's server may have its own catalog address). */
let activeCatalog: () => Promise<readonly AssetInput[]> = async () => [];
/** Pascal's own reader of catalog models and pictures, for absolute links. */
const plainAssetViews = createAssetViewLoader(createFetchAssetViewIO());
/** What view_assets and paint read of catalog pieces in the call in progress (Studio's links are relative). */
let activeAssetViews: AssetViewLoader = plainAssetViews;

function pascal(): Runtime {
  if (runtime) return runtime;
  const bridge = new SceneBridge();
  const operations = createSceneOperations({ bridge });
  // As in Luw Studio's own assistant: furnishing isn't held behind a design brief. The catalog comes
  // first, place_design makes what it lacks; Pascal's server refuses to place until design_brief ran.
  operations.designBriefRequired = false;
  // A stand-in server that only collects what Pascal registers. Pascal writes its tools for the MCP
  // SDK v2 (@modelcontextprotocol/server), Luw's server runs v1: tools.ts hands them over.
  const collector = new McpServer({ name: "pascal-tools", version: "0" });
  const tools = new Map<string, PascalTool>();
  collector.registerTool = ((name: string, config: PascalToolConfig, callback: PascalCallback) => {
    tools.set(name, { name, config, callback });
    return { enable() {}, disable() {}, remove() {}, update() {} };
  }) as unknown as McpServer["registerTool"];
  registerTools(collector, operations, {
    catalog: () => activeCatalog(),
    assetViews: (subjects, options) => activeAssetViews(subjects, options),
  });
  runtime = { bridge, tools };
  return runtime;
}

export function pascalTools(): Map<string, PascalTool> {
  return pascal().tools;
}

let turn: Promise<unknown> = Promise.resolve();

/** One call at a time on the shared store. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = turn.then(fn, fn);
  turn = run.catch(() => {});
  return run;
}

/** Lets what the store queues on a frame or a timer (dirty marks, normalisation) settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function snapshot(bridge: SceneBridge): SceneGraphJson {
  return bridge.exportJSON() as unknown as SceneGraphJson;
}

export interface SceneRun {
  result: CallToolResult;
  changed: boolean;
  /** The scene after the call, with the stored scene's other top-level keys kept. */
  graph: SceneGraphJson;
  /** The assistant's session after the call (Pascal's session record). */
  session: unknown;
}

/**
 * Runs one Pascal tool on a scene, inside the assistant's session (`session` as stored; anything
 * that isn't a session record starts an empty one), and reports whether it changed the scene.
 */
export function runOnScene(
  graph: SceneGraphJson,
  tool: PascalTool,
  args: Record<string, unknown>,
  extra: Extra,
  catalog: () => Promise<readonly AssetInput[]>,
  session?: unknown,
  assetViews: AssetViewLoader = plainAssetViews,
): Promise<SceneRun> {
  const { bridge } = pascal();
  return exclusive(async () => {
    activeCatalog = catalog;
    activeAssetViews = assetViews;
    // Nothing of the last call's project may remain: loadDefault keeps a scene already in the store,
    // and setScene keeps the plugin state of a scene that names none.
    useScene.getState().unloadScene();
    bridge.loadJSON(graph as never);
    // After the load, which starts an empty session.
    bridge.agentSession.replace(parseSessionRecord(session));
    await settle();
    // Nothing before this call can be undone through it.
    useScene.temporal.getState().clear();
    const before = JSON.stringify(snapshot(bridge));
    // As Pascal's server runs every tool: the session's start is taken on its first call, and what a
    // call created joins what the assistant made (verify_scene reads both).
    const result = await recordMade(
      {
        getNodes: () => useScene.getState().nodes as SceneNodes,
        readSession: () => bridge.agentSession.read(),
        keep: (keep) => bridge.agentSession.keep(keep),
      },
      () => call(tool, args, extra),
    );
    await settle();
    const after = snapshot(bridge);
    const changed = JSON.stringify(after) !== before;
    return { result, changed, graph: { ...graph, ...after }, session: bridge.agentSession.read() };
  });
}

/** Pascal's starting scene for an empty project: a site, a building and one level. */
export function defaultScene(): Promise<SceneGraphJson> {
  const { bridge } = pascal();
  return exclusive(async () => {
    useScene.getState().unloadScene();
    bridge.loadDefault();
    await settle();
    return snapshot(bridge);
  });
}

/** A tool that throws (Pascal's tools throw McpError for bad requests) answers with the error, as Pascal's server does. */
async function call(tool: PascalTool, args: Record<string, unknown>, extra: Extra): Promise<CallToolResult> {
  try {
    return await tool.callback(args, extra);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^MCP error -?\d+: /, "") : String(error);
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

/** Building content in a scene: everything but the site, building and level scaffold. */
export function contentCount(graph: SceneGraphJson | null): number {
  if (!graph) return 0;
  return Object.values(graph.nodes).filter((node) => {
    const type = (node as { type?: unknown })?.type;
    return type !== "site" && type !== "building" && type !== "level";
  }).length;
}
