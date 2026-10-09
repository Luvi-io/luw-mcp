import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { PROFESSIONS } from "./catalog.js";
import type { Params } from "./client.js";
import type { Deps, Server } from "./context.js";
import { InputError } from "./files.js";
import { listOptions, OPTION_KINDS, type OptionKind } from "./tools/core.js";

/** A registered tool, as the guide lists it. */
export interface ToolDoc {
  name: string;
  title?: string;
  description?: string;
}

const CATALOG_TITLES: Record<OptionKind, string> = {
  design_styles: "Design styles",
  interior_types: "Room types",
  exterior_types: "Building types",
  video_styles: "Video camera motions",
  materials: "Materials",
  professions: "Persona professions",
};

// ArchiGPT's history is conversations rather than images; luw_archigpt continues those.
const HISTORY_APPS = PROFESSIONS.filter((p) => p !== "ArchiGPT");
const HISTORY_PROJECTS = 10;
const HISTORY_RESULTS = 10;
const PROJECT_MEDIA = 200;

/**
 * Read-only context a user can attach to a conversation: account credits, recent results per Luw.ai app,
 * projects, option catalogs and a guide to the tools.
 */
export function registerResources(server: Server, deps: Deps, guide: { instructions: string; tools: ToolDoc[] }) {
  const sets = deps.config.toolsets;

  server.registerResource(
    "account",
    "luw://account",
    { title: "Luw.ai account", description: "Your Luw.ai credit balance.", mimeType: "text/markdown" },
    async (uri, extra) => {
      const body = await deps.client.request<{ credits?: Params; subscription?: unknown }>("GET", "/credits", { signal: extra.signal });
      const c = body.credits ?? {};
      return markdown(uri, [
        "# Luw.ai account",
        [
          `- Credits available: ${c.available ?? "unknown"}`,
          `- Credits used: ${c.used ?? "unknown"} of ${c.purchased ?? "unknown"}`,
          `- Subscription: ${body.subscription ? "active" : "none"}`,
        ].join("\n"),
      ]);
    },
  );

  server.registerResource(
    "guide",
    "luw://guide",
    { title: "Luw.ai guide", description: "What each Luw.ai tool does and what it costs in credits.", mimeType: "text/markdown" },
    (uri) =>
      markdown(uri, [
        "# Luw.ai guide",
        guide.instructions,
        "## Tools",
        ...guide.tools.map((t) => `### ${t.title ?? t.name} (\`${t.name}\`)\n${t.description ?? ""}`),
      ]),
  );

  if (sets.has("generate")) {
    server.registerResource(
      "catalog",
      new ResourceTemplate("luw://catalog/{kind}", {
        list: () => ({
          resources: OPTION_KINDS.map((kind) => ({ uri: `luw://catalog/${kind}`, name: CATALOG_TITLES[kind], mimeType: "text/plain" })),
        }),
        complete: { kind: (value) => OPTION_KINDS.filter((kind) => kind.startsWith(value)) },
      }),
      {
        title: "Luw.ai catalogs",
        description: "Valid design styles, room and building types, video camera motions, materials and persona professions, with previews.",
        mimeType: "text/plain",
      },
      async (uri, { kind }, extra) => {
        const match = OPTION_KINDS.find((k) => k === String(kind));
        if (!match) throw new InputError(`Unknown catalog "${kind}". Use one of: ${OPTION_KINDS.join(", ")}.`);
        const result = await listOptions({ client: deps.client, signal: extra.signal }, match, undefined, true);
        const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
      },
    );

    server.registerResource(
      "history",
      new ResourceTemplate("luw://history/{app}", {
        list: () => ({
          resources: HISTORY_APPS.map((app) => ({
            uri: `luw://history/${app}`,
            name: `${app} history`,
            description: `Your latest ${app} projects and results.`,
            mimeType: "text/markdown",
          })),
        }),
        complete: { app: (value) => HISTORY_APPS.filter((app) => app.toLowerCase().startsWith(value.toLowerCase())) },
      }),
      {
        title: "Luw.ai history",
        description: "Your latest projects in one Luw.ai app (Interior, Exterior, Video…) with their recent results: file links, prompts and source images.",
        mimeType: "text/markdown",
      },
      async (uri, { app }, extra) => {
        const name = HISTORY_APPS.find((a) => a.toLowerCase() === String(app).toLowerCase());
        if (!name) throw new InputError(`Unknown Luw.ai app "${app}". Use one of: ${HISTORY_APPS.join(", ")}.`);
        // The web app's own paged listing: most recently updated projects first, each with its generations.
        const body = await deps.client.request<{ personas?: Params[] }>("GET", `/personas/ft-${encodeURIComponent(name)}`, {
          query: { provider: "luw", page: 1, limit: HISTORY_PROJECTS },
          signal: extra.signal,
          timeoutMs: 120_000,
        });
        const sections = (body.personas ?? []).flatMap((p) => {
          const results = list(p.generations)
            .filter(isFinished)
            .sort((x, y) => String(y.created_at ?? "").localeCompare(String(x.created_at ?? "")));
          if (!results.length) return [];
          const shown = results.slice(0, HISTORY_RESULTS).map(resultLine);
          const more = results.length > HISTORY_RESULTS ? [`- …and ${results.length - HISTORY_RESULTS} older results`] : [];
          return [`## ${p.name || "Untitled"} (project ${p.id}, updated ${day(p.updated_at)})`, [...shown, ...more].join("\n")];
        });
        return markdown(uri, [
          `# ${name} history`,
          sections.length
            ? `Your ${HISTORY_PROJECTS} most recently updated ${name} projects, newest results first.`
            : `No finished ${name} results yet.`,
          ...sections,
        ]);
      },
    );
  }

  if (sets.has("projects")) {
    server.registerResource(
      "projects",
      new ResourceTemplate("luw://projects/{id}", {
        list: async (extra) => {
          try {
            const body = await deps.client.request<{ boards?: Params[] }>("GET", "/boards", { signal: extra.signal });
            return {
              resources: (body.boards ?? []).map((b) => ({
                uri: `luw://projects/${b.id}`,
                name: String(b.name || `Project ${b.id}`),
                description: `${b.media_count ?? 0} items in ${b.folders_count ?? 0} folders`,
                mimeType: "text/markdown",
              })),
            };
          } catch {
            // No key yet, or the API is unreachable: a failing list callback would fail the whole
            // resource listing, so leave projects out and keep the other resources visible.
            return { resources: [] };
          }
        },
      }),
      { title: "Luw.ai projects", description: "A Luw.ai project: its folders and the file links of every item in it.", mimeType: "text/markdown" },
      async (uri, { id }, extra) => {
        if (!/^\d+$/.test(String(id))) throw new InputError(`"${id}" is not a project id.`);
        const body = await deps.client.request<{ board?: Params }>("GET", `/boards/${id}`, { signal: extra.signal });
        const board = body.board ?? {};
        const folders = new Map(list(board.folders).map((f) => [f.id, String(f.name)]));
        const media = list(board.media).sort((x, y) => String(y.created_at ?? "").localeCompare(String(x.created_at ?? "")));
        const lines = media.slice(0, PROJECT_MEDIA).map((m) => {
          const folder = folders.get(m.folder_id);
          const source = typeof m.control_image === "string" && m.control_image ? ` (source: ${m.control_image})` : "";
          return `- ${mediaUrl(m)}${source}${folder ? ` · folder "${folder}"` : ""}`;
        });
        return markdown(uri, [
          `# ${board.name || `Project ${id}`}`,
          `${media.length} items in ${folders.size} folders${folders.size ? `: ${[...folders.values()].join(", ")}` : ""}.`,
          [...lines, ...(media.length > PROJECT_MEDIA ? [`- …and ${media.length - PROJECT_MEDIA} older items`] : [])].join("\n"),
        ]);
      },
    );
  }
}

/** Markdown from blocks (headings, paragraphs, pre-joined lists) separated by blank lines. */
function markdown(uri: URL, blocks: string[]): ReadResourceResult {
  return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: blocks.filter(Boolean).join("\n\n") }] };
}

function list(value: unknown): Params[] {
  return Array.isArray(value) ? (value as Params[]) : [];
}

/** A generation's `data` arrives as a JSON string, sometimes encoded twice. */
function parseData(value: unknown): Params {
  let data = value;
  for (let i = 0; i < 2 && typeof data === "string"; i++) {
    try {
      data = JSON.parse(data);
    } catch {
      return {};
    }
  }
  return data && typeof data === "object" ? (data as Params) : {};
}

function url(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value.find((v) => typeof v === "string") : value;
  return typeof first === "string" && /^https?:\/\//.test(first) && !first.includes("404.webp") ? first : undefined;
}

/** The finished file (full-size image, mp4, glb or svg), read the way the web app's extractFinalUrl does. */
function assetUrl(gen: Params): string | undefined {
  const data = parseData(gen.data);
  return url((gen.upload_result as Params | undefined)?.final_url) ?? url(data.final_url) ?? url(gen.output) ?? url(gen.final_url);
}

function isFinished(gen: Params): boolean {
  const data = parseData(gen.data);
  return !gen.temp && gen.upload_status !== "failed" && !data.error && !data.errors && assetUrl(gen) !== undefined;
}

function resultLine(gen: Params): string {
  const data = parseData(gen.data);
  const source = url(data.image) ?? url(data.control_image);
  const text = typeof data.prompt === "string" ? data.prompt.trim() : "";
  const prompt = text ? ` · prompt: "${text.length > 200 ? `${text.slice(0, 200)}…` : text}"` : "";
  return `- ${day(gen.created_at)}: ${assetUrl(gen)}${prompt}${source ? ` · source: ${source}` : ""}`;
}

/** A board item's `url` is a display thumbnail; for videos, 3D and SVGs the real file is in its generation JSON. */
function mediaUrl(item: Params): string {
  if (typeof item.extras === "string" && item.extras.trim().startsWith("{")) {
    const real = assetUrl(parseData(item.extras));
    if (real) return real;
  }
  return String(item.url);
}

function day(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 10) : "unknown date";
}
