export { VERSION } from "./version.js";
export const SERVER_NAME = "luw";

export const DEFAULT_BASE_URL = "https://api.luw.ai/v2";
export const API_KEY_URL = "https://app.luw.ai/dashboard/api";
export const PRICING_URL = "https://app.luw.ai/pricing";
export const DOCS_URL = "https://luw-ai.gitbook.io/api";
export const CONNECT_URL = "https://app.luw.ai/mcp/connect";

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
  /** Hosted mode: enables "Sign in to Luw.ai" (OAuth). Unset, callers must bring their own key. */
  oauthSecret?: string;
  /** Hosted mode: the Luw.ai consent page OAuth sends users to. */
  oauthConnectUrl: string;
  /** Hosted mode with OAuth, set per request: the WWW-Authenticate challenge a tool returns when the key is rejected. */
  authChallenge?: string;
  /** Served at /.well-known/openai-apps-challenge for ChatGPT app directory domain verification. */
  openaiAppsChallenge?: string;
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
    oauthSecret: oauthSecret(env.LUW_MCP_OAUTH_SECRET),
    oauthConnectUrl: env.LUW_MCP_CONNECT_URL?.trim() || CONNECT_URL,
    openaiAppsChallenge: env.OPENAI_APPS_CHALLENGE?.trim() || undefined,
    ...overrides,
  };
}

function oauthSecret(value: string | undefined): string | undefined {
  const secret = value?.trim();
  if (!secret) return undefined;
  if (secret.length < 32) throw new Error("LUW_MCP_OAUTH_SECRET must be at least 32 characters (e.g. `openssl rand -base64 48`).");
  return secret;
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
