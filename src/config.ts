export const SERVER_NAME = "luw";
// Replaced at build time by scripts/build.mjs; the fallback is for tests/dev.
export const VERSION: string = typeof __LUW_MCP_VERSION__ === "string" ? __LUW_MCP_VERSION__ : "0.0.0-dev";

declare const __LUW_MCP_VERSION__: string | undefined;

export const DEFAULT_BASE_URL = "https://api.luw.ai/v2";
export const API_KEY_URL = "https://app.luw.ai/dashboard/api";
export const PRICING_URL = "https://app.luw.ai/pricing";
export const DOCS_URL = "https://luw-ai.gitbook.io/api";

export const TOOLSETS = ["generate", "archigpt", "personas", "projects", "team"] as const;
export type Toolset = (typeof TOOLSETS)[number];
const DEFAULT_TOOLSETS: Toolset[] = ["generate", "archigpt", "personas", "projects"];

export interface LuwConfig {
  /** Luw.ai API token. May be empty: the server still starts and lists tools, calls explain how to get one. */
  apiKey: string;
  baseUrl: string;
  /** Max seconds a tool call blocks waiting for a generation before handing back a processing_url. */
  waitTimeoutSeconds: number;
  /** Embed finished images in tool results so the assistant (and user) can see them. */
  inlineImages: boolean;
  /** Max bytes of a single image to embed inline. */
  inlineImageMaxBytes: number;
  /** When set (local mode only), finished outputs are also downloaded here. */
  outputDir?: string;
  toolsets: Set<Toolset>;
  /** "local" can read files from disk; "remote" (hosted HTTP) cannot. */
  mode: "local" | "remote";
  /** First delay between /results polls; grows to 5s. */
  pollIntervalMs: number;
}

type Env = Record<string, string | undefined>;

export function loadConfig(rawEnv: Env = process.env, overrides: Partial<LuwConfig> = {}): LuwConfig {
  const env = withoutPlaceholders(rawEnv);
  return {
    apiKey: realKey(env.LUW_API_KEY || env.LUW_API_TOKEN),
    baseUrl: (env.LUW_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    waitTimeoutSeconds: clampInt(env.LUW_WAIT_TIMEOUT_SECONDS, 50, 0, 3600),
    inlineImages: parseBool(env.LUW_INLINE_IMAGES, true),
    inlineImageMaxBytes: clampInt(env.LUW_INLINE_IMAGE_MAX_BYTES, 3_500_000, 0, 20_000_000),
    outputDir: env.LUW_OUTPUT_DIR?.trim() || undefined,
    toolsets: parseToolsets(env.LUW_TOOLSETS),
    mode: "local",
    pollIntervalMs: 1500,
    ...overrides,
  };
}

export function parseToolsets(value: string | undefined): Set<Toolset> {
  if (!value?.trim()) return new Set(DEFAULT_TOOLSETS);
  const names = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (names.includes("all")) return new Set(TOOLSETS);
  const unknown = names.filter((n) => !(TOOLSETS as readonly string[]).includes(n));
  if (unknown.length) {
    throw new Error(`Unknown LUW_TOOLSETS value(s): ${unknown.join(", ")}. Valid: ${TOOLSETS.join(", ")}, all`);
  }
  return new Set(names as Toolset[]);
}

/** Treats the README's "YOUR_LUW_API_KEY"-style placeholders as no key, so users get setup help instead of an API error. */
function realKey(value: string | undefined): string {
  const key = (value ?? "").trim();
  return /^(your[_-]|<)/i.test(key) ? "" : key;
}

/** Installers may pass unfilled optional settings through literally (e.g. "${user_config.output_dir}"). */
function withoutPlaceholders(env: Env): Env {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v === undefined || !/^\$\{[^}]+\}$/.test(v.trim())));
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
