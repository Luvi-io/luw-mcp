import { z } from "zod";
import { errorMessage, type Params } from "../client.js";
import { EXTERIOR_TYPES, INTERIOR_TYPES, MODEL_IDS, PROFESSIONS } from "../catalog.js";
import { DOCS_URL } from "../config.js";
import { handler, text, type Deps, type Server, type ToolContext } from "../context.js";
import { contentTypeForExtension, extensionForContentType, InputError } from "../files.js";
import { formatOutcome, runJobs, type Outcome } from "../jobs.js";

const IMAGE_PARAM = /^(image|mask_image|material_image|control_image|style_transfer|extra_image_\d+)$/;

export function registerCoreTools(server: Server, deps: Deps) {
  server.registerTool(
    "luw_get_result",
    {
      title: "Get generation result",
      description:
        "Collect the result of a Luw.ai generation that was still processing (tools return a processing_url when a job outlasts their wait). " +
        "Waits for the job to finish (up to the server's wait limit) — call again if it's still running. Free; never re-run a generation instead.",
      inputSchema: {
        processing_url: z.string().min(1).describe("The processing_url returned by a generation tool."),
        wait: z.boolean().optional().describe("Wait for completion (default true). false = check once and return immediately."),
      },
      annotations: { title: "Get result", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    handler(deps, async (a, ctx) => {
      const started = Date.now();
      const outcome: Outcome = { label: "Luw.ai job", elapsedMs: 0, completed: [], pending: [], failed: [] };
      const state = await ctx.client.waitForResult(a.processing_url, {
        timeoutMs: a.wait === false ? 0 : ctx.config.waitTimeoutSeconds * 1000,
        intervalMs: ctx.config.pollIntervalMs,
        signal: ctx.signal,
        onProgress: (percent) => ctx.progress(percent ?? 0, `Processing ${Math.round(percent ?? 0)}%`),
      });
      if (state.done) outcome.completed.push({ index: 0, output: state.output });
      else outcome.pending.push({ index: 0, processingUrl: state.processingUrl, percent: state.percent });
      outcome.elapsedMs = Date.now() - started;
      return formatOutcome(ctx, outcome);
    }),
  );

  server.registerTool(
    "luw_upload_file",
    {
      title: "Upload a file to Luw.ai",
      description:
        deps.config.mode === "remote"
          ? "Store an image, video or 3D file sent as a data: URI in Luw.ai storage and get a URL usable by every Luw.ai tool. " +
            "Rarely needed: all tools already accept https:// URLs and data: URIs directly. This hosted server can't read files from the user's computer or copy URLs."
          : "Upload an image, video or 3D file to Luw.ai storage and get a URL usable by every Luw.ai tool. " +
            "Rarely needed: all tools already accept local paths and data: URIs and upload them automatically. " +
            "Useful to get a shareable URL, to re-host an image from a site Luw.ai can't reach, or to store a file permanently.",
      inputSchema: {
        source: z
          .string()
          .min(1)
          .describe(
            deps.config.mode === "remote"
              ? "data: URI of the file."
              : "Local file path, file:// URL, data: URI, or an https:// URL to copy into Luw.ai storage.",
          ),
        persistent: z
          .boolean()
          .optional()
          .describe("Keep the file in your Luw.ai storage permanently. Default: temporary, auto-deleted after 12 hours."),
        persona_id: z.number().int().positive().optional().describe("Persona to store a persistent file under (default: your first persona)."),
      },
      annotations: { title: "Upload file", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handler(deps, async (a, ctx) => {
      const options = { temporary: !a.persistent, personaId: a.persona_id, signal: ctx.signal };
      let url: string;
      if (/^https?:\/\//i.test(a.source)) {
        if (ctx.config.mode === "remote") {
          // The hosted server must not fetch arbitrary URLs on a caller's behalf (SSRF); Luw.ai fetches URLs itself.
          throw new InputError("The hosted server doesn't re-host URLs. Pass the https:// URL directly to any Luw.ai tool instead.");
        }
        const response = await ctx.fetch(a.source, { signal: ctx.signal }).catch((error: unknown) => {
          throw new InputError(`Couldn't download ${a.source}: ${errorMessage(error)}`);
        });
        if (!response.ok) throw new InputError(`Couldn't download ${a.source}: HTTP ${response.status}`);
        const pathExt = /\.([a-z0-9]{2,5})$/i.exec(new URL(a.source).pathname)?.[1];
        const contentType =
          (response.headers.get("content-type") ?? "").split(";")[0]!.trim() || contentTypeForExtension(pathExt ?? "") || "application/octet-stream";
        const ext = extensionForContentType(contentType) ?? pathExt?.toLowerCase();
        if (!ext || !contentTypeForExtension(ext)) {
          throw new InputError(`${a.source} is ${contentType}, which Luw.ai storage doesn't accept.`);
        }
        const data = new Uint8Array(await response.arrayBuffer());
        url = await ctx.client.upload({ data, contentType, filename: `upload.${ext}`, ...options });
      } else {
        url = await ctx.files.resolve(a.source, options);
      }
      const note = a.persistent ? "" : " (temporary — deleted after 12 hours)";
      return text(`Uploaded${note}: ${url}`, { url, temporary: !a.persistent });
    }),
  );

  server.registerTool(
    "luw_list_options",
    {
      title: "List styles, room types, materials…",
      description:
        "Look up valid values for other Luw.ai tools: design_styles (styles param), interior_types (room_type), exterior_types (building_type), " +
        "video_styles (camera_motion), materials (Magic Wand material_image catalog), professions (persona profession). Free.",
      inputSchema: {
        kind: z.enum(OPTION_KINDS),
        search: z.string().optional().describe("Case-insensitive filter on names/descriptions."),
        details: z.boolean().optional().describe("Include descriptions and preview image URLs (longer output)."),
      },
      annotations: { title: "List options", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    handler(deps, (a, ctx) => listOptions(ctx, a.kind, a.search, a.details)),
  );

  // A raw-parameter executor is local-only: app directories (ChatGPT, Claude) list the hosted server
  // and reject tools that run operations not individually exposed for review.
  if (deps.config.mode !== "local") return;

  server.registerTool(
    "luw_run_model",
    {
      title: "Run any Luw.ai model (advanced)",
      description:
        "Call POST /generate with raw API parameters, for models or options the dedicated tools don't cover (e.g. persona-slot inputs, webhooks). " +
        `Models: ${MODEL_IDS.join(", ")}. Parameter reference: ${DOCS_URL}. ` +
        "Image fields (image, mask_image, material_image, style_transfer, extra_image_1…6) also accept local paths and data: URIs. Spends credits like the model's own tool.",
      inputSchema: {
        model: z.string().min(1).describe("Model id, e.g. interior or magicprompt."),
        params: z.record(z.string(), z.unknown()).optional().describe("Other /generate parameters, e.g. {\"image\": \"…\", \"prompt\": \"…\", \"precise\": 75}."),
      },
      annotations: { title: "Run model", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handler(deps, async (a, ctx) => {
      if (a.model === "archigpt") throw new InputError("Use luw_archigpt for ArchiGPT.");
      const params: Params = { ...(a.params ?? {}), model: a.model };
      await Promise.all(
        Object.entries(params).map(async ([key, value]) => {
          if (IMAGE_PARAM.test(key) && typeof value === "string" && value !== "persona") {
            params[key] = await ctx.files.resolve(value, { signal: ctx.signal });
          }
        }),
      );
      return formatOutcome(ctx, await runJobs(ctx, `Luw.ai ${a.model}`, [params]));
    }),
  );
}

export const OPTION_KINDS = ["design_styles", "interior_types", "exterior_types", "video_styles", "materials", "professions"] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

/** Valid values for other tools' parameters; shared by luw_list_options and the luw://catalog resources. */
export async function listOptions(ctx: Pick<ToolContext, "client" | "signal">, kind: OptionKind, search?: string, details?: boolean) {
  const query = search?.trim().toLowerCase();
  const match = (...fields: unknown[]) => !query || fields.some((x) => typeof x === "string" && x.toLowerCase().includes(query));

  switch (kind) {
    case "interior_types":
    case "exterior_types":
    case "professions": {
      const list = (kind === "interior_types" ? INTERIOR_TYPES : kind === "exterior_types" ? EXTERIOR_TYPES : [...PROFESSIONS]).filter((n) => match(n));
      return text(list.join("\n") || "No matches.", { items: list });
    }
    case "design_styles": {
      const styles = await ctx.client.request<Params[]>("GET", "/styles", { query: { version: 2 }, auth: false, signal: ctx.signal });
      const list = styles.filter((s) => match(s.name, s.description));
      return listResult(list, details || Boolean(query), (s) => `${s.name}: ${s.description ?? ""}${details ? ` (${s.thumb_image ?? s.image})` : ""}`);
    }
    case "video_styles": {
      const styles = await ctx.client.request<Params[]>("GET", "/video_styles", { auth: false, signal: ctx.signal });
      const list = styles.filter((s) => match(s.name, s.prompt));
      return listResult(list, details || Boolean(query), (s) => `${s.name}: ${s.prompt ?? ""}`);
    }
    case "materials": {
      const body = await ctx.client.request<{ materials?: Params[] }>("GET", "/materials", { auth: ctx.client.hasApiKey, signal: ctx.signal });
      const list = (body.materials ?? []).filter((m) => match(m.title, m.extra, m.info));
      const lines = list.map((m) => `${m.title}${m.extra ? ` [${m.extra}]` : ""}: ${m.image}${details && m.thumb ? ` (thumb ${m.thumb})` : ""}`);
      return text(lines.join("\n") || "No matches.", {
        items: list.map((m) => ({ id: m.id, title: m.title, surfaces: m.extra, image: m.image, thumb: m.thumb })),
      });
    }
  }
}

function listResult(items: Params[], detailed: boolean, line: (item: Params) => string) {
  if (!items.length) return text("No matches.", { items: [] });
  const body = detailed ? items.map(line).join("\n") : items.map((s) => String(s.name)).join(", ");
  return text(`${items.length} found:\n${body}`, { items: items.map((s) => (detailed ? s : s.name)) });
}
