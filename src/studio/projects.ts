import { LuwApiError, type Params } from "../client.js";
import { STUDIO_URL } from "../config.js";
import type { ToolContext } from "../context.js";
import { InputError } from "../files.js";

// Luw Studio projects as the Luw.ai API stores them: a persona with the profession "Studio", its scene
// in the `extras` of the training in slot 8, as Pascal's scene graph JSON stamped `luwFormat`
// (studio.luw.ai, luw/lib/studio-projects.ts and scene-format.ts). Slot 1008 keeps a 0.9 Studio
// project's original scene and slot 1010 the project's media list; this server never touches those.

const PROFESSION = "Studio";
const MAIN_SLOT = 8;
/** The scene before the last assistant edit, which luw_studio_undo swaps back in. */
const UNDO_SLOT = 1009;
/**
 * The assistant's session on the project: its checkpoints and what it made, which Pascal's server
 * keeps for as long as a client stays connected. This server keeps no connection, so a session lasts
 * while the assistant keeps working: an hour without a call starts the next one afresh.
 */
const SESSION_SLOT = 1011;
const SESSION_IDLE_MS = 60 * 60 * 1000;
/** What Studio writes into a scene it saved; a scene without it is a 0.9 Studio ("legacy") project. */
export const SCENE_FORMAT = "pascal-1";
/**
 * Written to the persona's title after every edit. Studio never sets the title, so an open Studio tab
 * reads it from its project list (a few bytes) to notice an assistant's edit and load it.
 */
export const EDIT_STAMP_PREFIX = "assistant-edit:";

export interface SceneGraphJson {
  nodes: Record<string, unknown>;
  rootNodeIds: string[];
  [key: string]: unknown;
}

export interface StudioProject {
  id: number;
  name: string;
  /** Raw stored scene JSON ('' for a project nothing was saved to yet). */
  raw: string;
  mainTrainingId: number | null;
  /** Scene before the last assistant edit, '' when there is none. */
  undoRaw: string;
  /** The assistant's session as stored, or null when none is running (see SESSION_SLOT). */
  session: unknown;
}

export type StoredScene = { kind: "empty" } | { kind: "scene"; graph: SceneGraphJson; legacy: boolean };

interface Training {
  id: number;
  slot?: number | null;
  image?: string | null;
  control_image?: string | null;
  extras?: string | null;
  updated_at?: string;
}

interface Persona {
  id: number;
  name?: string;
  title?: string | null;
  knows?: string | null;
  profession?: string;
  updated_at?: string;
  trainings?: Training[];
}

export function studioUrl(projectId: number): string {
  return `${STUDIO_URL}/?project=${projectId}`;
}

function summary(p: Persona) {
  const main = p.trainings?.find((t) => t.slot === MAIN_SLOT);
  const floorPlan = typeof p.knows === "string" && /^https?:\/\//.test(p.knows) ? p.knows : undefined;
  return prune({
    project_id: p.id,
    name: p.name || "Untitled",
    updated_at: p.updated_at,
    cover: main?.image || undefined,
    floor_plan: floorPlan,
    studio_url: studioUrl(p.id),
  });
}

/** Newest first, a page at a time, without the scene JSON (`slim`). */
export async function listProjects(ctx: ToolContext, page: number, limit: number, search?: string) {
  const query = search?.trim().toLowerCase();
  if (!query) {
    const body = await ctx.client.request<{ personas?: Persona[] }>("GET", `/personas/ft-${PROFESSION}`, {
      query: { provider: "luw", page, limit: limit + 1, slim: 1 },
      signal: ctx.signal,
    });
    const items = body.personas ?? [];
    return { page, projects: items.slice(0, limit).map(summary), has_more: items.length > limit };
  }
  // A search covers every project, not only the page in view.
  const body = await ctx.client.request<{ personas?: Persona[] }>("GET", `/personas/ft-${PROFESSION}`, {
    query: { provider: "luw", slim: 1 },
    signal: ctx.signal,
    timeoutMs: 120_000,
  });
  const matches = (body.personas ?? [])
    .filter((p) => (p.name ?? "").toLowerCase().includes(query))
    .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  const start = (page - 1) * limit;
  return { page, projects: matches.slice(start, start + limit).map(summary), has_more: start + limit < matches.length };
}

export async function loadProject(ctx: ToolContext, projectId: number): Promise<StudioProject> {
  const body = await ctx.client.request<{ persona?: Persona }>("GET", `/personas/${projectId}`, {
    signal: ctx.signal,
    timeoutMs: 120_000,
  });
  const persona = body.persona;
  if (!persona) throw new InputError(`No Luw Studio project ${projectId} in this account.`);
  if (persona.profession !== PROFESSION) {
    throw new InputError(`${projectId} is not a Luw Studio project. luw_studio_list_projects lists them.`);
  }
  const main = persona.trainings?.find((t) => t.slot === MAIN_SLOT);
  return {
    id: persona.id,
    name: persona.name || "Untitled",
    raw: main?.extras ?? "",
    mainTrainingId: main?.id ?? null,
    undoRaw: persona.trainings?.find((t) => t.slot === UNDO_SLOT)?.extras ?? "",
    session: liveSession(persona.trainings?.find((t) => t.slot === SESSION_SLOT)?.extras),
  };
}

function liveSession(stored: string | null | undefined): unknown {
  if (!stored) return null;
  try {
    const { at, record } = JSON.parse(stored) as { at?: unknown; record?: unknown };
    return typeof at === "number" && Date.now() - at < SESSION_IDLE_MS ? record : null;
  } catch {
    return null;
  }
}

/** Keeps the assistant's session with the project, for its next call. */
export async function saveSession(ctx: ToolContext, projectId: number, record: unknown): Promise<void> {
  await ctx.client.request("POST", `/personas/${projectId}/trainings`, {
    json: { slot: SESSION_SLOT, info: "Assistant session: checkpoints and what it made", extras: JSON.stringify({ at: Date.now(), record }) },
    signal: ctx.signal,
    timeoutMs: 120_000,
  });
}

/** The stored scene, read the way Studio reads it (scene-format.ts). */
export function parseScene(raw: string): StoredScene {
  if (!raw.trim()) return { kind: "empty" };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new InputError("This project's scene can't be read (its JSON is damaged). Open it in Luw Studio to repair it.");
  }
  if (!data || typeof data !== "object" || !("nodes" in data) || !("rootNodeIds" in data)) {
    throw new InputError("This project's scene is incomplete (no nodes). Open it in Luw Studio to repair it.");
  }
  const { luwFormat, ...graph } = data as SceneGraphJson & { luwFormat?: unknown };
  return { kind: "scene", graph: graph as SceneGraphJson, legacy: luwFormat !== SCENE_FORMAT };
}

export function serializeScene(graph: SceneGraphJson): string {
  return JSON.stringify({ ...graph, luwFormat: SCENE_FORMAT });
}

/** Someone saved the project between this call's read and its write: an open Studio tab, usually. */
export class SceneChangedError extends Error {
  constructor() {
    super("The project changed while this edit ran.");
    this.name = "SceneChangedError";
  }
}

/**
 * Writes an edited scene: the scene it replaces goes to the undo slot first, then the new scene, then
 * the edit stamp an open Studio tab watches for. Refuses when the stored scene is no longer the one
 * the edit started from.
 */
export async function saveScene(ctx: ToolContext, project: StudioProject, next: string): Promise<void> {
  const base = `/personas/${project.id}/trainings`;
  if (project.mainTrainingId !== null) {
    const current = await ctx.client.request<{ training?: Training }>("GET", `${base}/${project.mainTrainingId}`, {
      signal: ctx.signal,
      timeoutMs: 120_000,
    });
    if ((current.training?.extras ?? "") !== project.raw) throw new SceneChangedError();
  }
  if (project.raw.trim()) {
    await ctx.client.request("POST", base, {
      json: { slot: UNDO_SLOT, info: "Undo: the scene before the last assistant edit", extras: project.raw },
      signal: ctx.signal,
      timeoutMs: 120_000,
    });
  }
  await writeMain(ctx, project, next);
  await stampEdit(ctx, project.id);
}

/** Writes the main scene; returns its training's id (a new one when the project had none). */
async function writeMain(ctx: ToolContext, project: StudioProject, extras: string): Promise<number | null> {
  const base = `/personas/${project.id}/trainings`;
  if (project.mainTrainingId !== null) {
    await ctx.client.request("PUT", `${base}/${project.mainTrainingId}`, { json: { extras }, signal: ctx.signal, timeoutMs: 120_000 });
    return project.mainTrainingId;
  }
  // Slot writes are upserts: Rails updates the slot's training or makes it.
  const made = await ctx.client.request<Params>("POST", base, {
    json: { slot: MAIN_SLOT, info: "Main", image: "", extras },
    signal: ctx.signal,
    timeoutMs: 120_000,
  });
  return numberIn(made, ["training_id"]) ?? null;
}

/**
 * Gives an empty project Pascal's starting scene, so the ids a first read hands out (its level's,
 * say) are still the project's on the next call.
 */
export async function startScene(ctx: ToolContext, project: StudioProject, extras: string): Promise<StudioProject> {
  const mainTrainingId = await writeMain(ctx, project, extras);
  if (mainTrainingId !== null) return { ...project, raw: extras, mainTrainingId };
  return loadProject(ctx, project.id);
}

async function stampEdit(ctx: ToolContext, projectId: number): Promise<void> {
  // Only an open Studio tab reads it; the edit itself is already saved.
  await ctx.client
    .request("PUT", `/personas/${projectId}`, { json: { title: `${EDIT_STAMP_PREFIX}${Date.now()}` }, signal: ctx.signal })
    .catch(() => {});
}

/** Swaps the scene and the undo slot: undoes the last assistant edit, and a second call redoes it. */
export async function swapUndo(ctx: ToolContext, project: StudioProject): Promise<void> {
  if (!project.undoRaw.trim()) throw new InputError("There is no assistant edit to undo in this project.");
  await ctx.client.request("POST", `/personas/${project.id}/trainings`, {
    json: { slot: UNDO_SLOT, info: "Undo: the scene before the last assistant edit", extras: project.raw },
    signal: ctx.signal,
    timeoutMs: 120_000,
  });
  await writeMain(ctx, project, project.undoRaw);
  await stampEdit(ctx, project.id);
}

export async function createProject(ctx: ToolContext, name: string, scene: string): Promise<number> {
  const created = await ctx.client.request<Params>("POST", "/personas", { json: { name, profession: PROFESSION }, signal: ctx.signal });
  let id = numberIn(created, ["persona", "id"]) ?? numberIn(created, ["id"]) ?? numberIn(created, ["persona_id"]);
  if (id === undefined) {
    // The API may answer only {status: true}: the newest project with this name is the one just made.
    const latest = await ctx.client.request<{ personas?: Persona[] }>("GET", `/personas/ft-${PROFESSION}`, {
      query: { provider: "luw", page: 1, limit: 5, slim: 1 },
      signal: ctx.signal,
    });
    id = (latest.personas ?? []).filter((p) => p.name === name).sort((a, b) => b.id - a.id)[0]?.id;
  }
  if (id === undefined) throw new LuwApiError("Luw.ai made the project but didn't say its id. luw_studio_list_projects will show it.");
  await ctx.client.request("POST", `/personas/${id}/trainings`, {
    json: { slot: MAIN_SLOT, info: "Main", image: "", extras: scene },
    signal: ctx.signal,
    timeoutMs: 120_000,
  });
  return id;
}

export async function renameProject(ctx: ToolContext, projectId: number, name: string): Promise<void> {
  await loadProject(ctx, projectId); // a Studio project of this account, not any persona
  await ctx.client.request("PUT", `/personas/${projectId}`, { json: { name }, signal: ctx.signal });
}

function numberIn(value: unknown, path: string[]): number | undefined {
  let cursor: unknown = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  const n = typeof cursor === "string" ? Number(cursor) : cursor;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

function prune(obj: Params): Params {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}
