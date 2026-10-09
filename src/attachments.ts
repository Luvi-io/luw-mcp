import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { GENERATE_TOOL_NAMES } from "./tools/generate.js";

// Tools that use their image for a single job. ChatGPT's download link is temporary, so tools that store
// the image (persona trainings, project media) keep taking links only.
const ATTACHABLE = new Set<string>([...GENERATE_TOOL_NAMES, "luw_archigpt"]);

// The file object ChatGPT passes for a field listed in _meta["openai/fileParams"]: all four properties
// declared, only download_url and file_id required.
const attachedFile = z
  .object({
    download_url: z.string(),
    file_id: z.string(),
    mime_type: z.string().optional(),
    file_name: z.string().optional(),
  })
  .optional()
  .describe("A photo the user attached in the chat. Use it instead of image when the photo was uploaded rather than linked.");

type Shape = Record<string, z.ZodType>;
type Callback = (args: Record<string, unknown>, extra: unknown) => unknown;

/**
 * ChatGPT hands a tool the files a user attached only through fields listed in _meta["openai/fileParams"].
 * On the hosted server, tools that take a photo get an image_file field for that; its download link becomes
 * the image, which Luw.ai fetches like any other link.
 */
export function acceptAttachedPhoto<T extends { inputSchema?: Shape; _meta?: Record<string, unknown> }>(
  name: string,
  tool: T,
  cb: Callback,
): [T, Callback] {
  const image = tool.inputSchema?.image;
  if (!image || !ATTACHABLE.has(name)) return [tool, cb];
  const required = !image.safeParse(undefined).success;
  const spec = {
    ...tool,
    inputSchema: { ...tool.inputSchema, image: image.optional(), image_file: attachedFile },
    _meta: { ...tool._meta, "openai/fileParams": ["image_file"] },
  };
  const call: Callback = (args, extra) => {
    const { image_file, ...rest } = args as { image_file?: { download_url: string } } & Record<string, unknown>;
    const photo = rest.image ?? image_file?.download_url;
    if (required && !photo) {
      const missing: CallToolResult = {
        content: [{ type: "text", text: "No photo given: pass an https:// link as image, or the photo the user attached as image_file." }],
        isError: true,
      };
      return missing;
    }
    return cb(photo === undefined ? rest : { ...rest, image: photo }, extra);
  };
  return [spec, call];
}
