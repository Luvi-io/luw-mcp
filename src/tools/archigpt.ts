import { z } from "zod";
import { handler, type Deps, type Server } from "../context.js";

// ArchiGPT ends a reply that calls for a picture with a tag the Luw.ai apps turn into a generation,
// e.g. [generateinteriorwithluwai="..."]. It isn't for the reader; its prompt goes in structuredContent.
const IMAGE_TAG = /\s*\[generate(?:interior|exterior|image)withluwai="([\s\S]*?)"\]\s*$/;

export function registerArchiGptTool(server: Server, deps: Deps) {
  server.registerTool(
    "luw_archigpt",
    {
      title: "Ask ArchiGPT (architecture & design expert)",
      description:
        "Ask Luw.ai's ArchiGPT, an AI architect: design advice, feng shui, space planning, material and color suggestions, technical questions, " +
        "and estimating square meters from a photo or plan. Attach an image to discuss it. Each call is a standalone question, " +
        "so put the details it depends on into the message. Costs 1 credit per ~3000 words.",
      inputSchema: {
        message: z.string().min(1).max(8000).describe("Your question or message, with the details it depends on."),
        image: z
          .string()
          .optional()
          .describe("Image to discuss (public https:// link or data: URI; the local npx server also accepts a file path)."),
        language: z.string().optional().describe('Reply language, e.g. "en" or "tr". Auto-detected when omitted.'),
        persona_id: z.number().int().positive().optional().describe("Persona to file the question under. It doesn't remember earlier calls."),
      },
      annotations: { title: "Ask an architecture expert", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    handler(deps, async (a, ctx) => {
      const image = await ctx.files.resolveOptional(a.image, { signal: ctx.signal });
      const body = await ctx.client.request<{ message?: string; usage?: number; left?: number }>("POST", "/generate", {
        json: Object.fromEntries(
          Object.entries({
            model: "archigpt",
            prompt: a.message,
            image,
            lang: a.language,
            pid: a.persona_id,
          }).filter(([, v]) => v !== undefined),
        ),
        retry: false,
        timeoutMs: 180_000,
        signal: ctx.signal,
      });
      const raw = body.message ?? "";
      const tag = IMAGE_TAG.exec(raw);
      const message = tag ? raw.slice(0, tag.index) : raw;
      const footer = [body.usage !== undefined && `usage ${body.usage}`, body.left !== undefined && `remaining ${body.left}`].filter(Boolean).join(" · ");
      return {
        content: [{ type: "text", text: `${message}${footer ? `\n\n[ArchiGPT ${footer}]` : ""}` }],
        structuredContent: { message, usage: body.usage, left: body.left, ...(tag ? { image_prompt: tag[1] } : {}) },
      };
    }),
  );
}
