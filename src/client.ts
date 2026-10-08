import { randomUUID } from "node:crypto";
import { API_KEY_URL, PRICING_URL, VERSION } from "./config.js";

export type Params = Record<string, unknown>;

/** Shape shared by /generate and /results responses. */
export interface JobResponse {
  status?: boolean;
  processing?: boolean;
  processing_url?: string;
  output?: unknown;
  progress?: { state?: string; percent?: number; started_at?: string };
  [key: string]: unknown;
}

export type JobState =
  | { done: true; output: unknown; raw: JobResponse }
  | { done: false; processingUrl: string; percent?: number; state?: string };

export interface WaitOptions {
  timeoutMs: number;
  intervalMs?: number;
  signal?: AbortSignal;
  onProgress?: (percent: number | undefined, state: string | undefined) => void | Promise<void>;
}

export class LuwApiError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "LuwApiError";
  }

  /** Luw.ai refused the key itself (deleted, revoked or mistyped), as opposed to the request. */
  get rejectedKey(): boolean {
    return this.httpStatus === 401 || this.httpStatus === 403 || (isRecord(this.details) && isAuthRejection(this.details));
  }
}

export class MissingApiKeyError extends Error {
  constructor(hint: string) {
    super(`No Luw.ai API key configured. Create one at ${API_KEY_URL}, then ${hint}`);
    this.name = "MissingApiKeyError";
  }
}

interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  auth?: boolean;
  /** Retry on 429/5xx/network errors. Only safe for requests that don't spend credits twice. */
  retry?: boolean;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

const FAILED_STATES = new Set(["failed", "error", "errored", "canceled", "cancelled"]);
const UPLOAD_CACHE_HEADERS = {
  "Cache-Control": "max-age=315360000",
  Expires: "Sun, 19 Jul 2030 18:06:32 GMT",
};

export interface LuwClientOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  /** Appended to the MissingApiKeyError message: how to provide a key in this deployment. */
  missingKeyHint?: string;
  /** Hosted server: errors say "reconnect" rather than LUW_API_KEY, and never link to pricing
   *  (in-chat app stores don't allow selling credits). */
  hosted?: boolean;
}

export class LuwClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: LuwClientOptions) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  get hasApiKey(): boolean {
    return this.opts.apiKey.length > 0;
  }

  async request<T = Params>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const { query, json, form, signal, auth = true, retry = method === "GET", timeoutMs = 60_000, headers: extraHeaders } = options;
    if (auth && !this.hasApiKey) {
      throw new MissingApiKeyError(this.opts.missingKeyHint ?? "set the LUW_API_KEY environment variable in your MCP client config.");
    }

    const url = new URL(this.opts.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `luw-mcp/${VERSION}`,
      ...extraHeaders,
    };
    if (auth) headers.Authorization = `Bearer ${this.opts.apiKey}`;
    let body: BodyInit | undefined;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }

    const attempts = 3;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(400 * 3 ** (attempt - 1), signal);
      let response: Response;
      const timeout = linkedTimeout(signal, timeoutMs);
      try {
        response = await this.fetchImpl(url, { method, headers, body, signal: timeout.signal });
      } catch (error) {
        timeout.clear();
        if (signal?.aborted) throw error;
        lastError = new LuwApiError(`Could not reach Luw.ai API (${method} ${path}): ${errorMessage(error)}`);
        // A request without an idempotency guarantee may have reached the server; don't run it twice.
        if (!retry) throw lastError;
        continue;
      }
      let text: string;
      try {
        text = await response.text();
      } finally {
        timeout.clear();
      }

      // A 429 means the request was rejected outright, so it's always safe to retry.
      const transient = response.status === 429 || (retry && response.status >= 500);
      if (transient && attempt < attempts - 1) {
        lastError = new LuwApiError(`Luw.ai API ${method} ${path} returned HTTP ${response.status}`, text, response.status);
        continue;
      }

      let data: unknown;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        if (!response.ok) throw new LuwApiError(describeHttpError(method, path, response.status, this.opts.hosted), text.slice(0, 500), response.status);
        throw new LuwApiError(`Luw.ai API ${method} ${path} returned a non-JSON response: ${text.slice(0, 200)}`, undefined, response.status);
      }
      if (isRecord(data) && data.status === false) {
        throw new LuwApiError(describeApiError(data, this.opts.hosted), data, response.status);
      }
      if (!response.ok) {
        throw new LuwApiError(describeHttpError(method, path, response.status, this.opts.hosted), data, response.status);
      }
      return data as T;
    }
    throw lastError;
  }

  /**
   * POST /generate with an Idempotency-Key: if a retry reaches Luw.ai after the first attempt
   * already did, the API returns the original job instead of charging again — so retrying is safe.
   */
  generate(params: Params, signal?: AbortSignal): Promise<JobResponse> {
    return this.request<JobResponse>("POST", "/generate", {
      json: params,
      signal,
      retry: true,
      timeoutMs: 120_000,
      headers: { "Idempotency-Key": `luw-mcp-${randomUUID()}` },
    });
  }

  getResult(processingUrl: string, signal?: AbortSignal): Promise<JobResponse> {
    return this.request<JobResponse>("POST", "/results", {
      json: { processing_url: processingUrl },
      signal,
      retry: true,
    });
  }

  /** Polls /results until the job finishes or `timeoutMs` elapses (then returns the pending state). */
  async waitForResult(processingUrl: string, options: WaitOptions): Promise<JobState> {
    const deadline = Date.now() + options.timeoutMs;
    let delay = options.intervalMs ?? 1500;
    for (;;) {
      const response = await this.getResult(processingUrl, options.signal);
      const state = interpretJob(response, processingUrl);
      if (state.done) return state;
      await options.onProgress?.(state.percent, state.state);
      if (Date.now() + delay > deadline) return state;
      await sleep(delay, options.signal);
      delay = Math.min(Math.round(delay * 1.4), Math.max(5000, delay));
    }
  }

  /**
   * Three-step upload: allocate a signed URL, PUT the bytes straight to storage, then finalize.
   * Temporary uploads get the `x12tmp-` prefix, which Luw.ai deletes after 12 hours.
   */
  async upload(input: {
    data: Uint8Array;
    filename: string;
    contentType: string;
    temporary?: boolean;
    personaId?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const form = new FormData();
    form.append("filename", uploadName(input.filename, input.temporary ?? true));
    if (input.personaId !== undefined) form.append("pid", String(input.personaId));
    const slot = await this.request<{ signed_url?: string; final_url?: string }>("POST", "/upload", {
      form,
      signal: input.signal,
      retry: true,
    });
    if (!slot.signed_url || !slot.final_url) {
      throw new LuwApiError("Luw.ai /upload did not return signed_url and final_url", slot);
    }

    const timeout = linkedTimeout(input.signal, 300_000);
    try {
      const put = await this.fetchImpl(slot.signed_url, {
        method: "PUT",
        headers: { "Content-Type": input.contentType, ...UPLOAD_CACHE_HEADERS },
        body: input.data as BodyInit,
        signal: timeout.signal,
      });
      if (!put.ok) {
        const detail = (await put.text().catch(() => "")).slice(0, 300);
        throw new LuwApiError(`Uploading ${input.filename} to Luw.ai storage failed with HTTP ${put.status}. ${detail}`.trim());
      }
    } finally {
      timeout.clear();
    }

    await this.request("GET", "/finalize_upload", { query: { url: slot.final_url }, signal: input.signal, retry: true });
    return slot.final_url;
  }
}

export function interpretJob(response: JobResponse, processingUrl?: string): JobState {
  const state = response.progress?.state;
  if (state && FAILED_STATES.has(state.toLowerCase())) {
    throw new LuwApiError(`Generation ${state}${response.error ? `: ${String(response.error)}` : ""}`, response);
  }
  if (response.output !== undefined && response.output !== null && response.processing !== true) {
    return { done: true, output: response.output, raw: response };
  }
  const url = response.processing_url ?? processingUrl;
  if (!url) {
    throw new LuwApiError("Luw.ai returned neither an output nor a processing_url", response);
  }
  return { done: false, processingUrl: url, percent: response.progress?.percent, state };
}

const RECONNECT = "Reconnect Luw.ai in your assistant to sign in again, or use a valid API key.";

function isAuthRejection(body: Params): boolean {
  return (isRecord(body.errors) && !!body.errors.auth) || (typeof body.error === "string" && /authentication required/i.test(body.error));
}

export function describeApiError(body: Params, hosted = false): string {
  if (body.insert_coin) {
    return hosted
      ? "Your Luw.ai account doesn't have enough credits for this request."
      : `Your Luw.ai account is out of credits for this request. Add credits at ${PRICING_URL}`;
  }
  const errors = body.errors;
  if (isRecord(errors)) {
    if (errors.auth) {
      return hosted
        ? `Luw.ai rejected this connection's key (${flatten(errors.auth)}). ${RECONNECT}`
        : `Luw.ai rejected the API key (${flatten(errors.auth)}). Check LUW_API_KEY or create a new key at ${API_KEY_URL}`;
    }
    const parts = Object.entries(errors).map(([field, value]) => `${field}: ${flatten(value)}`);
    if (parts.length) return `Luw.ai API error — ${parts.join("; ")}`;
  }
  if (typeof body.error === "string") {
    if (/authentication required/i.test(body.error)) {
      return hosted
        ? `Luw.ai rejected the request: ${body.error}. ${RECONNECT}`
        : `Luw.ai rejected the request: ${body.error}. Check LUW_API_KEY or create a key at ${API_KEY_URL}`;
    }
    const detail = body.response === undefined ? "" : ` (${flatten(body.response)})`;
    return `Luw.ai API error — ${body.error}${detail}`;
  }
  if (typeof body.message === "string") return `Luw.ai API error — ${body.message}`;
  return "Luw.ai API returned status=false without details";
}

function describeHttpError(method: string, path: string, status: number, hosted = false): string {
  const where = `Luw.ai API ${method} ${path} returned HTTP ${status}`;
  if (status === 401 || status === 403) {
    return hosted ? `${where}: the key was rejected. ${RECONNECT}` : `${where}: the API key was rejected. Check LUW_API_KEY or create a key at ${API_KEY_URL}`;
  }
  if (status === 404) return `${where}: not found.`;
  if (status === 429) return `${where}: too many requests. Wait a moment and try again.`;
  if (status >= 500) {
    // The API currently answers unknown API keys with a 500 instead of its documented auth error.
    return hosted
      ? `${where}. This usually means the key is invalid; reconnect Luw.ai in your assistant. If it keeps happening, Luw.ai is having a temporary problem; try again shortly.`
      : `${where}. This usually means the API key is invalid — double-check LUW_API_KEY (keys: ${API_KEY_URL}). If the key is right, Luw.ai is having a temporary problem; try again shortly.`;
  }
  return where;
}

function uploadName(filename: string, temporary: boolean): string {
  const base = filename.split(/[\\/]/).pop() || "file";
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "").slice(-80) || "file";
  const id = Math.random().toString(36).slice(2, 8);
  return temporary ? `x12tmp-${id}-${safe}` : `${id}-${safe}`;
}

function flatten(value: unknown): string {
  if (Array.isArray(value)) return value.map(flatten).join(", ");
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
  }
  return String(error);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** AbortSignal that fires on the parent signal or after `ms` (AbortSignal.any needs Node 20). */
function linkedTimeout(parent: AbortSignal | undefined, ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${Math.round(ms / 1000)}s`)), ms);
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}
