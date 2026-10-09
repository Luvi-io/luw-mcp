import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorMessage, interpretJob, isRecord, LuwApiError, type JobState, type Params } from "./client.js";
import { extensionForContentType } from "./files.js";
import type { ToolContext } from "./context.js";

const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_INLINE_IMAGES = 4;

export interface Mask {
  label: string;
  url?: string;
  error?: string;
}

interface Completed {
  index: number;
  output: unknown;
}

export interface Outcome {
  label: string;
  elapsedMs: number;
  completed: Completed[];
  pending: { index: number; processingUrl: string; percent?: number }[];
  failed: { index: number; error: string }[];
}

/**
 * Submits one /generate request per param set (variations run in parallel), then polls them all
 * against a single deadline so the tool call stays inside client timeouts.
 */
export async function runJobs(ctx: ToolContext, label: string, paramSets: Params[]): Promise<Outcome> {
  const started = Date.now();
  const outcome: Outcome = { label, elapsedMs: 0, completed: [], pending: [], failed: [] };
  const percents = new Array<number>(paramSets.length).fill(0);

  const report = () => {
    const avg = percents.reduce((a, b) => a + b, 0) / percents.length;
    const seconds = Math.round((Date.now() - started) / 1000);
    return ctx.progress(avg, `${label}: ${Math.round(avg)}% (${seconds}s)`);
  };

  await Promise.all(
    paramSets.map(async (params, index) => {
      try {
        const first = interpretJob(await ctx.client.generate(params, ctx.signal));
        const state: JobState = first.done
          ? first
          : await ctx.client.waitForResult(first.processingUrl, {
              timeoutMs: Math.max(0, started + ctx.config.waitTimeoutSeconds * 1000 - Date.now()),
              intervalMs: ctx.config.pollIntervalMs,
              signal: ctx.signal,
              onProgress: (percent) => {
                percents[index] = Math.max(percents[index] ?? 0, percent ?? 0);
                return report();
              },
            });
        if (state.done) {
          percents[index] = 100;
          outcome.completed.push({ index, output: state.output });
        } else {
          outcome.pending.push({ index, processingUrl: state.processingUrl, percent: state.percent });
        }
      } catch (error) {
        // A rejected key fails every variation alike: fail the whole call, so the client can ask to sign in again.
        if (ctx.signal.aborted || (error instanceof LuwApiError && error.rejectedKey)) throw error;
        outcome.failed.push({ index, error: errorMessage(error) });
      }
    }),
  );

  outcome.elapsedMs = Date.now() - started;
  outcome.completed.sort((a, b) => a.index - b.index);
  outcome.pending.sort((a, b) => a.index - b.index);
  outcome.failed.sort((a, b) => a.index - b.index);
  return outcome;
}

export interface FormatOptions {
  /** For segmentation: only keep masks whose label matches one of these (case-insensitive substring). */
  maskLabels?: string[];
  /** Added when a job finishes with no output at all, e.g. what to try instead. */
  emptyHint?: string;
  /** The input image, so the result viewer can show before and after. */
  source?: string;
  /** Seamless textures: the result viewer shows them tiled. */
  tile?: boolean;
}

/** Turns an Outcome into a tool result: readable summary, structured data, inline previews, saved files. */
export async function formatOutcome(ctx: ToolContext, outcome: Outcome, options: FormatOptions = {}): Promise<CallToolResult> {
  const { label, completed, pending, failed } = outcome;
  const urls: string[] = [];
  const texts: string[] = [];
  const extras: unknown[] = [];
  let maskSources: { label: string; mask: string }[] = [];
  for (const item of completed) {
    const normalized = normalizeOutput(item.output);
    urls.push(...normalized.urls);
    texts.push(...normalized.texts);
    maskSources.push(...normalized.masks);
    if (normalized.other !== undefined) extras.push(normalized.other);
  }

  if (options.maskLabels?.length) {
    const wanted = options.maskLabels.map((l) => l.toLowerCase());
    maskSources = maskSources.filter((m) => wanted.some((w) => m.label.toLowerCase().includes(w)));
  }
  const masks = await uploadMasks(ctx, maskSources);

  const content: CallToolResult["content"] = [];
  const lines: string[] = [];
  const seconds = (outcome.elapsedMs / 1000).toFixed(1);

  // Luw.ai can finish a job and return nothing (e.g. Segment AI found no match); say so instead of a bare "finished".
  const raw = normalizeAll(completed);
  const empty = completed.length > 0 && !pending.length && !failed.length && !raw.urls.length && !raw.masks.length && !raw.texts.length && raw.other === undefined;

  if (empty) {
    lines.push(`${label} finished in ${seconds}s but returned no output.${options.emptyHint ? ` ${options.emptyHint}` : ""}`);
  } else if (completed.length) {
    const count = urls.length + masks.length;
    lines.push(`${label} finished in ${seconds}s${count > 1 ? ` — ${count} outputs` : ""}.`);
    urls.forEach((url, i) => lines.push(urls.length > 1 ? `${i + 1}. ${url}` : url));
    for (const mask of masks) {
      lines.push(mask.url ? `- ${mask.label}: ${mask.url}` : `- ${mask.label}: (mask upload failed: ${mask.error})`);
    }
    if (maskSources.length === 0 && options.maskLabels?.length && raw.masks.length) {
      lines.push(`No masks matched ${options.maskLabels.join(", ")}.`);
    }
    lines.push(...texts);
    if (extras.length) lines.push(JSON.stringify(extras.length === 1 ? extras[0] : extras, null, 2));
  }

  if (pending.length) {
    if (lines.length) lines.push("");
    const percent = pending.map((p) => p.percent).filter((p): p is number => typeof p === "number");
    const progress = percent.length ? ` (${Math.round(percent.reduce((a, b) => a + b, 0) / percent.length)}%)` : "";
    lines.push(
      `${label} is still processing${progress} after ${seconds}s — this is normal for long jobs.`,
      ...pending.map((p) => `processing_url: ${p.processingUrl}`),
      `Call luw_get_result with ${pending.length > 1 ? "each" : "this"} processing_url to collect the result. Do not re-run the generation; that would spend credits again.`,
    );
  }

  if (failed.length) {
    if (lines.length) lines.push("");
    const multiple = failed.length + completed.length + pending.length > 1;
    for (const f of failed) lines.push(multiple ? `Variation ${f.index + 1} failed: ${f.error}` : f.error);
  }

  const files = await saveAndPreview(ctx, urls, content);
  if (files.length) lines.push("", `Saved to: ${files.join(", ")}`);

  content.unshift({ type: "text", text: lines.join("\n") });
  const status = empty ? "empty" : failed.length && !completed.length && !pending.length ? "failed" : pending.length ? "processing" : failed.length ? "partial" : "completed";
  return {
    content,
    structuredContent: {
      status,
      outputs: urls,
      ...(options.source && /^https?:\/\//i.test(options.source) && (urls.length || masks.length) ? { source: options.source } : {}),
      ...(options.tile && urls.length ? { tile: true } : {}),
      ...(masks.length ? { masks } : {}),
      ...(texts.length ? { text: texts.join("\n") } : {}),
      ...(pending.length ? { processing_urls: pending.map((p) => p.processingUrl) } : {}),
      ...(failed.length ? { errors: failed.map((f) => f.error) } : {}),
      ...(files.length ? { files } : {}),
      elapsed_seconds: Number(seconds),
    },
    isError: status === "failed" || status === "empty",
  };
}

/** Luw.ai outputs are a URL string, a list of URLs, or (Segment AI) a list of {label, mask} objects. */
export function normalizeOutput(output: unknown): {
  urls: string[];
  masks: { label: string; mask: string }[];
  texts: string[];
  other?: unknown;
} {
  const result = { urls: [] as string[], masks: [] as { label: string; mask: string }[], texts: [] as string[], other: undefined as unknown };
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) result.urls.push(value);
      else if (value.trim()) result.texts.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (isRecord(value) && typeof value.mask === "string") {
      result.masks.push({ label: String(value.label ?? `mask ${result.masks.length + 1}`), mask: value.mask });
    } else if (isRecord(value) && (typeof value.url === "string" || typeof value.output === "string")) {
      visit(value.url ?? value.output);
    } else if (value !== undefined && value !== null) {
      result.other = value;
    }
  };
  visit(output);
  return result;
}

function normalizeAll(items: Completed[]) {
  return normalizeOutput(items.map((i) => i.output));
}

async function uploadMasks(ctx: ToolContext, sources: { label: string; mask: string }[]): Promise<Mask[]> {
  const results: Mask[] = sources.map((s) => ({ label: s.label }));
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const i = next++;
      const source = sources[i]!;
      try {
        const dataUri = source.mask.startsWith("data:") ? source.mask : `data:image/png;base64,${source.mask}`;
        results[i]!.url = await ctx.files.resolve(dataUri, { signal: ctx.signal });
      } catch (error) {
        results[i]!.error = errorMessage(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, sources.length) }, worker));
  return results;
}

/** Downloads outputs into LUW_OUTPUT_DIR (local mode) and embeds image previews so the client can show them. */
async function saveAndPreview(ctx: ToolContext, urls: string[], content: CallToolResult["content"]): Promise<string[]> {
  const saveDir = ctx.config.mode === "local" ? ctx.config.outputDir : undefined;
  const files: string[] = [];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");

  await Promise.all(
    urls.map(async (url, i) => {
      const jobs: Promise<void>[] = [];
      if (saveDir) {
        jobs.push(
          (async () => {
            const response = await ctx.fetch(url, { signal: ctx.signal });
            if (!response.ok) return;
            const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
            await mkdir(saveDir, { recursive: true });
            const ext = urlExtension(url) ?? extensionForContentType(type) ?? "bin";
            const file = join(saveDir, `luw-${stamp}-${i + 1}.${ext}`);
            await writeFile(file, Buffer.from(await response.arrayBuffer()));
            files[i] = file;
          })(),
        );
      }
      if (ctx.config.inlineImages && i < MAX_INLINE_IMAGES && looksLikeImage(url)) {
        jobs.push(
          fetchPreview(ctx, url).then((image) => {
            if (image) content[i] = { type: "image", data: image.data.toString("base64"), mimeType: image.mimeType };
          }),
        );
      }
      // Previews and downloads are best-effort; the URL is always in the text.
      await Promise.allSettled(jobs);
    }),
  );
  // Remove holes left by skipped indexes while keeping output order.
  const images = content.filter(Boolean);
  content.length = 0;
  content.push(...images);
  return files.filter(Boolean);
}

/**
 * Luw.ai outputs are often 2-6 MB PNGs. Its resizing CDN serves the same file as a ~150 KB JPEG at
 * 1568px (the most detail Claude uses), so previews stay fast and cheap; the original is the fallback.
 */
export function previewUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("luvicdn.com") || !u.pathname.startsWith("/luwai/")) return undefined;
    return `https://luvicdn.net/img${u.pathname}?w=1568&fm=jpg&q=85`;
  } catch {
    return undefined;
  }
}

async function fetchPreview(ctx: ToolContext, url: string): Promise<{ data: Buffer; mimeType: string } | undefined> {
  for (const candidate of [previewUrl(url), url]) {
    if (!candidate) continue;
    try {
      const response = await ctx.fetch(candidate, { signal: ctx.signal });
      if (!response.ok) continue;
      const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (!INLINE_IMAGE_TYPES.has(type) || declared > ctx.config.inlineImageMaxBytes) {
        await response.body?.cancel();
        continue;
      }
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length <= ctx.config.inlineImageMaxBytes) return { data, mimeType: type };
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function looksLikeImage(url: string): boolean {
  const ext = urlExtension(url);
  return ext === undefined || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);
}

function urlExtension(url: string): string | undefined {
  try {
    const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    return match?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}
