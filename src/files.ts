import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { LuwClient } from "./client.js";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  mp4: "video/mp4",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  fbx: "application/octet-stream",
};
const EXTENSIONS_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "video/mp4": "mp4",
  "model/gltf-binary": "glb",
  "model/gltf+json": "gltf",
};
export const SUPPORTED_EXTENSIONS = Object.keys(CONTENT_TYPES);
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
// Temporary uploads live 12h on Luw.ai; reuse them a bit less than that.
const CACHE_TTL_MS = 11 * 60 * 60 * 1000;

export class InputError extends Error {
  override name = "InputError";
}

export interface UploadOptions {
  temporary?: boolean;
  personaId?: number;
  signal?: AbortSignal;
}

/**
 * Turns whatever the assistant passes for an image (https URL, local path, file:// URL, data: URI)
 * into a URL Luw.ai can fetch, uploading to Luw.ai storage when needed.
 */
export class FileResolver {
  private readonly cache = new Map<string, { url: Promise<string>; expires: number }>();

  constructor(
    private readonly client: LuwClient,
    private readonly mode: "local" | "remote",
  ) {}

  async resolve(value: string, options: UploadOptions = {}): Promise<string> {
    const input = value.trim();
    if (/^https?:\/\//i.test(input)) return input;
    if (/^data:/i.test(input)) {
      const { data, contentType } = decodeDataUri(input);
      const ext = EXTENSIONS_BY_TYPE[contentType] ?? "png";
      return this.client.upload({ data, contentType, filename: `upload.${ext}`, ...options });
    }
    if (this.mode === "remote") {
      throw new InputError(
        `"${truncate(input)}" is not a URL. The hosted Luw.ai MCP server can't read files from your computer — ` +
          "pass a public https:// URL or a data: URI, or install the local server (npx -y @luw-ai/mcp) to use local file paths.",
      );
    }
    return this.uploadLocalFile(input, options);
  }

  /** Resolves optional values, leaving undefined alone. */
  async resolveOptional(value: string | undefined, options?: UploadOptions): Promise<string | undefined> {
    return value === undefined ? undefined : this.resolve(value, options);
  }

  async uploadLocalFile(pathLike: string, options: UploadOptions = {}): Promise<string> {
    const path = toLocalPath(pathLike);
    let info;
    try {
      info = await stat(path);
    } catch {
      throw new InputError(
        `Can't find "${truncate(pathLike)}". Pass an https:// URL, a data: URI, or a path to an existing file (absolute paths work best).`,
      );
    }
    if (!info.isFile()) throw new InputError(`"${path}" is not a file.`);
    if (info.size > MAX_UPLOAD_BYTES) {
      throw new InputError(`"${path}" is ${Math.round(info.size / 1024 / 1024)} MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
    }
    const ext = extname(path).slice(1).toLowerCase();
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) {
      throw new InputError(`Unsupported file type ".${ext}". Luw.ai accepts: ${SUPPORTED_EXTENSIONS.join(", ")}.`);
    }

    const key = `${path}:${info.size}:${info.mtimeMs}:${options.temporary ?? true}:${options.personaId ?? ""}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.url;

    const url = readFile(path).then((data) =>
      this.client.upload({ data, contentType, filename: basename(path), ...options }),
    );
    this.cache.set(key, { url, expires: Date.now() + CACHE_TTL_MS });
    url.catch(() => this.cache.delete(key));
    return url;
  }
}

export function contentTypeForExtension(ext: string): string | undefined {
  return CONTENT_TYPES[ext.replace(/^\./, "").toLowerCase()];
}

export function extensionForContentType(contentType: string): string | undefined {
  return EXTENSIONS_BY_TYPE[contentType.split(";")[0]!.trim().toLowerCase()];
}

export function decodeDataUri(uri: string): { data: Uint8Array; contentType: string } {
  const match = /^data:([^;,]+)?((?:;[^;,]+)*?)(;base64)?,(.*)$/is.exec(uri);
  if (!match) throw new InputError("Malformed data: URI.");
  const contentType = (match[1] ?? "application/octet-stream").toLowerCase();
  const payload = match[4] ?? "";
  const data = match[3] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
  if (data.length === 0) throw new InputError("The data: URI is empty.");
  if (data.length > MAX_UPLOAD_BYTES) throw new InputError("The data: URI is larger than 100 MB.");
  return { data, contentType };
}

function toLocalPath(value: string): string {
  if (/^file:\/\//i.test(value)) return fileURLToPath(value);
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) return homedir() + value.slice(1);
  return isAbsolute(value) ? value : resolvePath(process.cwd(), value);
}

function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
