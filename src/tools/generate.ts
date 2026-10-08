import { z } from "zod";
import type { Params } from "../client.js";
import { handler, type Deps, type Server, type ToolContext } from "../context.js";
import { InputError } from "../files.js";
import { formatOutcome, runJobs, type FormatOptions } from "../jobs.js";

// ---------------------------------------------------------------------------
// Shared parameter schemas. Names are snake_case and friendlier than the raw API
// (`room_type` → `knows`, `engine` → `luwmodel`, …); the mapping lives in each tool.
// ---------------------------------------------------------------------------

const IMAGE_HINT = "https:// URL, local file path, or data: URI";
const imageInput = (what: string) => z.string().min(1).describe(`${what} (${IMAGE_HINT}).`);

const f = {
  prompt: z.string().max(4000).optional().describe("What you want, in plain language."),
  styles: z
    .array(z.string())
    .max(5)
    .optional()
    .describe('Design style names, e.g. ["Scandinavian"]; for Japandi use ["Japanese Design", "Scandinavian"]. Case-sensitive; see luw_list_options.'),
  referenceImages: z
    .array(imageInput("Reference image"))
    .max(6)
    .optional()
    .describe("Up to 6 reference images (furniture, materials, products, mood boards) to draw from."),
  styleReference: z
    .string()
    .optional()
    .describe(`Style-transfer source: an image whose look to copy (${IMAGE_HINT}), or "persona" to use slot 1 of persona_id.`),
  personaId: z.number().int().positive().optional().describe("Persona whose saved images/knowledge to use (see luw_personas)."),
  seed: z.number().int().min(0).optional().describe("Fix for reproducible results."),
  precision: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("How strictly to keep the input's structure: 90 = precise, 75 = balanced, 40 = creative."),
  enhancePrompt: z.boolean().optional().describe("Let Luw.ai's prompt enhancer expand a short prompt."),
  engine: z.enum(["aria", "symphony"]).optional().describe("Luw.ai model: aria (default) or symphony (Symphony-3)."),
  format: z.enum(["jpg", "png", "webp"]).optional().describe("Output image format."),
  variations: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe("Number of alternative designs (1-4, default 1); each is billed as a generation."),
};

type CommonArgs = {
  prompt?: string;
  styles?: string[];
  persona_id?: number;
  seed?: number;
  precision?: number;
  enhance_prompt?: boolean;
  engine?: string;
  format?: string;
};

function common(a: CommonArgs): Params {
  return {
    prompt: a.prompt,
    styles: a.styles?.length ? a.styles.join(",") : undefined,
    pid: a.persona_id,
    seed: a.seed,
    precise: a.precision,
    enhance_prompt: a.enhance_prompt ? "true" : undefined,
    luwmodel: a.engine === "symphony" ? "symphony-3" : a.engine === "aria" ? undefined : a.engine,
    format: a.format,
  };
}

async function referenceParams(ctx: ToolContext, images: string[] | undefined, max = 6): Promise<Params> {
  const urls = await Promise.all((images ?? []).slice(0, max).map((img) => ctx.files.resolve(img, { signal: ctx.signal })));
  return Object.fromEntries(urls.map((url, i) => [`extra_image_${i + 1}`, url]));
}

async function styleTransfer(ctx: ToolContext, value: string | undefined): Promise<string | undefined> {
  if (value === undefined) return undefined;
  return value.trim().toLowerCase() === "persona" ? "persona" : ctx.files.resolve(value, { signal: ctx.signal });
}

/** Drops undefined values so optional API params are omitted rather than sent empty. */
function compact(params: Params): Params {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ""));
}

/** One param set per variation; with an explicit seed, variations use seed, seed+1, … */
function expand(params: Params, variations = 1): Params[] {
  return Array.from({ length: variations }, (_, i) =>
    compact(typeof params.seed === "number" && i > 0 ? { ...params, seed: params.seed + i } : params),
  );
}

async function generate(ctx: ToolContext, label: string, params: Params, variations?: number, format?: FormatOptions) {
  const outcome = await runJobs(ctx, label, expand(params, variations));
  return formatOutcome(ctx, outcome, format);
}

const GENERATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

export function registerGenerateTools(server: Server, deps: Deps) {
  server.registerTool(
    "luw_interior_design",
    {
      title: "Interior design (Interior AI)",
      description:
        "Luw.ai Interior AI: redesign an interior photo — home, office, shop, hotel — in any style while keeping the room's architecture. " +
        "Restyles furniture, materials, colors and lighting. Set empty_room=true to furnish an empty room or turn it into another room type (virtual staging). " +
        "Costs 1 credit per variation.",
      inputSchema: {
        image: imageInput("Photo of the room"),
        prompt: f.prompt,
        styles: f.styles,
        room_type: z.string().optional().describe('Room type, e.g. "Living Room", "Kitchen", "Bedroom", "Home Office" (see luw_list_options kind="interior_types").'),
        empty_room: z.boolean().optional().describe("Furnish from scratch / convert the room to room_type (Fill Empty Room mode)."),
        style_reference: f.styleReference,
        reference_images: f.referenceImages,
        precision: f.precision,
        engine: f.engine,
        enhance_prompt: f.enhancePrompt,
        seed: f.seed,
        format: f.format,
        variations: f.variations,
        persona_id: f.personaId,
      },
      annotations: { title: "Interior design", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      const [image, style_transfer, refs] = await Promise.all([
        ctx.files.resolve(a.image, { signal: ctx.signal }),
        styleTransfer(ctx, a.style_reference),
        referenceParams(ctx, a.reference_images),
      ]);
      return generate(
        ctx,
        "Interior AI",
        {
          model: "interior",
          image,
          ...common(a),
          knows: a.room_type,
          fill_room: a.empty_room ? "true" : undefined,
          style_transfer,
          ...refs,
        },
        a.variations,
      );
    }),
  );

  server.registerTool(
    "luw_exterior_design",
    {
      title: "Exterior design (Exterior AI)",
      description:
        "Luw.ai Exterior AI: redesign a building exterior or facade photo — houses, villas, apartments, commercial buildings — in a new architectural style, " +
        "with new materials, colors and landscaping, keeping the structure. Costs 1 credit per variation.",
      inputSchema: {
        image: imageInput("Photo of the building"),
        prompt: f.prompt,
        styles: f.styles,
        building_type: z
          .string()
          .optional()
          .describe('Building/space type, e.g. "Modern House Exterior", "Luxury Villa Exterior", "Outdoor Patio" (see luw_list_options kind="exterior_types").'),
        style_reference: f.styleReference,
        reference_images: f.referenceImages,
        precision: f.precision,
        engine: f.engine,
        enhance_prompt: f.enhancePrompt,
        seed: f.seed,
        format: f.format,
        variations: f.variations,
        persona_id: f.personaId,
      },
      annotations: { title: "Exterior design", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      const [image, style_transfer, refs] = await Promise.all([
        ctx.files.resolve(a.image, { signal: ctx.signal }),
        styleTransfer(ctx, a.style_reference),
        referenceParams(ctx, a.reference_images),
      ]);
      return generate(
        ctx,
        "Exterior AI",
        { model: "exterior", image, ...common(a), knows: a.building_type, style_transfer, ...refs },
        a.variations,
      );
    }),
  );

  server.registerTool(
    "luw_sketch_to_render",
    {
      title: "Sketch to render (Sketch AI)",
      description:
        "Luw.ai Sketch AI: turn a hand sketch, line drawing, floor-plan perspective or rough draft into a photorealistic render. Costs 1 credit per variation.",
      inputSchema: {
        image: imageInput("The sketch or drawing"),
        prompt: f.prompt,
        styles: f.styles,
        space_type: z.string().optional().describe('What the sketch shows, e.g. "Living Room" or "Modern House Exterior".'),
        style_reference: f.styleReference,
        precision: f.precision,
        engine: f.engine,
        enhance_prompt: f.enhancePrompt,
        seed: f.seed,
        format: f.format,
        variations: f.variations,
        persona_id: f.personaId,
      },
      annotations: { title: "Sketch to render", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      const [image, style_transfer] = await Promise.all([
        ctx.files.resolve(a.image, { signal: ctx.signal }),
        styleTransfer(ctx, a.style_reference),
      ]);
      return generate(ctx, "Sketch AI", { model: "sketch", image, ...common(a), knows: a.space_type, style_transfer }, a.variations);
    }),
  );

  server.registerTool(
    "luw_render",
    {
      title: "Photorealistic render (Render AI)",
      description:
        "Luw.ai Render AI: turn a 3D model view, CAD/BIM screenshot, clay render or basic visualization into a photorealistic architectural render. Costs 1 credit per variation.",
      inputSchema: {
        image: imageInput("The 3D view or base render"),
        prompt: f.prompt,
        reference_images: f.referenceImages,
        precision: f.precision,
        engine: f.engine,
        format: f.format,
        variations: f.variations,
      },
      annotations: { title: "Photorealistic render", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      const [image, refs] = await Promise.all([
        ctx.files.resolve(a.image, { signal: ctx.signal }),
        referenceParams(ctx, a.reference_images),
      ]);
      return generate(ctx, "Render AI", { model: "render", image, ...common(a), ...refs }, a.variations);
    }),
  );

  server.registerTool(
    "luw_edit_image",
    {
      title: "Edit image with a prompt (Magic Prompt AI)",
      description:
        "Luw.ai Magic Prompt AI: edit any image with a plain-language instruction: \"make the sofa green velvet\", \"add a pendant lamp over the table\", \"turn it into a night scene\". " +
        "Pass products, materials or a mood board as reference_images to place or apply them. For edits restricted to an exact area, use luw_magic_wand. Costs 1 credit per variation.",
      inputSchema: {
        image: imageInput("Image to edit"),
        prompt: z.string().min(1).max(4000).describe("The edit to make."),
        reference_images: f.referenceImages,
        engine: z
          .enum(["aria", "symphony", "nano-banana-2"])
          .optional()
          .describe("Model: aria (default), symphony (Symphony-3) or nano-banana-2."),
        resolution: z.enum(["2k", "4k"]).optional().describe("Output resolution (default 2k)."),
        enhance_prompt: f.enhancePrompt,
        seed: f.seed,
        format: f.format,
        variations: f.variations,
      },
      annotations: { title: "Edit image", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      const [image, refs] = await Promise.all([
        ctx.files.resolve(a.image, { signal: ctx.signal }),
        referenceParams(ctx, a.reference_images),
      ]);
      const hd = a.resolution === "4k" ? 4 : a.resolution === "2k" ? 2 : undefined;
      return generate(ctx, "Magic Prompt AI", { model: "magicprompt", image, ...common(a), hd, ...refs }, a.variations);
    }),
  );

  server.registerTool(
    "luw_magic_wand",
    {
      title: "Masked edit: replace, remove, change material (Magic Wand AI)",
      description:
        "Luw.ai Magic Wand AI: change only a masked area of an image. Give a prompt to add/replace what's there, remove=true to erase it, or material_image to re-surface it " +
        "(e.g. new flooring or wall tiles). The mask is a black-and-white image the same size as the input; white marks the area to change. " +
        "Get masks from luw_segment. Costs 1 credit.",
      inputSchema: {
        image: imageInput("Image to edit"),
        mask_image: imageInput("Black/white mask, white = area to change"),
        prompt: z.string().max(4000).optional().describe("What to put in the masked area."),
        remove: z.boolean().optional().describe("Remove whatever is in the masked area."),
        material_image: z
          .string()
          .optional()
          .describe(`Material/texture to apply to the masked area (${IMAGE_HINT}); luw_list_options kind="materials" has a ready-made catalog.`),
        keep_structure: z.boolean().optional().describe("Preserve the masked area's geometry/lines while changing its look (structure-guided fill)."),
        engine: f.engine,
        enhance_prompt: f.enhancePrompt,
        seed: f.seed,
        format: f.format,
      },
      annotations: { title: "Masked edit", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      if (!a.prompt && !a.remove && !a.material_image) {
        throw new InputError("Tell Magic Wand what to do: pass a prompt, remove=true, or a material_image.");
      }
      const [image, mask_image, material_image] = await Promise.all([
        ctx.files.resolve(a.image, { signal: ctx.signal }),
        ctx.files.resolve(a.mask_image, { signal: ctx.signal }),
        ctx.files.resolveOptional(a.material_image, { signal: ctx.signal }),
      ]);
      return generate(ctx, "Magic Wand AI", {
        model: "magicwand",
        image,
        mask_image,
        material_image,
        ...common(a),
        remove: a.remove ? "true" : undefined,
        controlnet: a.keep_structure ? "true" : undefined,
      });
    }),
  );

  server.registerTool(
    "luw_landscape_design",
    {
      title: "Landscape & garden design (Landscape AI)",
      description:
        "Luw.ai Landscape AI: design a garden, yard or outdoor area inside a masked region of a photo, with plants chosen for the location's climate and sun exposure. Costs 1 credit.",
      inputSchema: {
        image: imageInput("Photo of the outdoor area"),
        mask_image: imageInput("Black/white mask, white = area to landscape"),
        prompt: f.prompt,
        city: z.string().optional().describe('Location, for climate-appropriate planting, e.g. "Antalya".'),
        sun_exposure: z.string().optional().describe('e.g. "Full sun (6+ hours)", "Partial sun (4 - 6 hours)", "Shade (less than 4 hours)".'),
        enhance_prompt: f.enhancePrompt,
        seed: f.seed,
        format: f.format,
      },
      annotations: { title: "Landscape design", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      const [image, mask_image] = await Promise.all([
        ctx.files.resolve(a.image, { signal: ctx.signal }),
        ctx.files.resolve(a.mask_image, { signal: ctx.signal }),
      ]);
      return generate(ctx, "Landscape AI", {
        model: "landscape",
        image,
        mask_image,
        ...common(a),
        // Must be an object (the backend reads big_data["city"]) and must always be present.
        big_data: compact({ city: a.city, sun: a.sun_exposure }),
      });
    }),
  );

  server.registerTool(
    "luw_image_tools",
    {
      title: "Upscale, expand, empty a room, vectorize",
      description:
        "Luw.ai image utilities, 1 credit each:\n" +
        "- upscale: enhance quality and enlarge 2x/4x/8x (Photo Enhance AI)\n" +
        "- expand: outpaint a tightly cropped architectural photo to a wider view (Expand AI)\n" +
        "- remove_furniture: empty a furnished room, keeping walls, floor and windows (Remove Furniture AI)\n" +
        "- vectorize: convert a photo or drawing into a clean SVG vector (Vector AI)",
      inputSchema: {
        operation: z.enum(["upscale", "expand", "remove_furniture", "vectorize"]),
        image: imageInput("Input image"),
        scale: z.union([z.literal(2), z.literal(4), z.literal(8)]).optional().describe("upscale only: 2, 4 or 8 (default 2)."),
        precision: f.precision,
        format: f.format,
      },
      annotations: { title: "Image tools", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      const image = await ctx.files.resolve(a.image, { signal: ctx.signal });
      const model = { upscale: "enhance", expand: "expand", remove_furniture: "removefurniture", vectorize: "vector" }[a.operation];
      const label = { upscale: "Photo Enhance AI", expand: "Expand AI", remove_furniture: "Remove Furniture AI", vectorize: "Vector AI" }[a.operation];
      return generate(ctx, label, {
        model,
        image,
        hd: a.operation === "upscale" ? String(a.scale ?? 2) : undefined,
        precise: a.operation === "vectorize" ? undefined : a.precision,
        format: a.operation === "vectorize" ? undefined : a.format,
      });
    }),
  );

  server.registerTool(
    "luw_background",
    {
      title: "Remove or replace background",
      description:
        "Luw.ai Change Background: cut out a product/object from its background (transparent PNG) — or, with a prompt, place it in a new generated scene for marketing shots " +
        '("on a marble kitchen counter, morning light"). Omit prompt to just remove the background. Costs 1 credit.',
      inputSchema: {
        image: imageInput("Product or object photo"),
        prompt: z.string().max(4000).optional().describe("New background to generate. Leave empty to remove the background."),
        engine: f.engine,
        enhance_prompt: f.enhancePrompt,
        format: f.format,
      },
      annotations: { title: "Background", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      const image = await ctx.files.resolve(a.image, { signal: ctx.signal });
      if (!a.prompt?.trim()) {
        return generate(ctx, "Remove Background AI", { model: "removebg", image, ...common({ engine: a.engine }) });
      }
      return generate(ctx, "Change Background AI", { model: "changebg", image, ...common(a) });
    }),
  );

  server.registerTool(
    "luw_segment",
    {
      title: "Segment objects into masks (Segment AI)",
      description:
        "Luw.ai Segment AI: detect objects in a photo and return black-and-white masks as image URLs — every object (wall, floor, sofa, …) or only what you describe in prompt. " +
        "Feed a mask URL into luw_magic_wand or luw_landscape_design to edit exactly that area. Costs 1 credit.",
      inputSchema: {
        image: imageInput("Photo to segment"),
        prompt: z.string().max(500).optional().describe('What to segment, e.g. "walls", "the sofa", "lawn". Omit to segment everything.'),
        labels: z
          .array(z.string())
          .max(20)
          .optional()
          .describe('Keep only masks whose label contains one of these words (e.g. ["floor", "wall"]).'),
      },
      annotations: { title: "Segment", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      const image = await ctx.files.resolve(a.image, { signal: ctx.signal });
      const params = a.prompt?.trim() ? { model: "segmentprompt", image, prompt: a.prompt } : { model: "segment", image };
      const emptyHint = a.prompt?.trim()
        ? `Nothing matching "${a.prompt.trim()}" was found. Try another word (e.g. "carpet" for a floor), or omit prompt to get every object's mask and pick with labels.`
        : "No objects were detected in this image.";
      return generate(ctx, "Segment AI", params, 1, { maskLabels: a.labels, emptyHint });
    }),
  );

  server.registerTool(
    "luw_generate_image",
    {
      title: "Text to image (Fluw AI)",
      description:
        "Luw.ai Fluw AI: generate a photorealistic image or illustration from a text prompt (optionally guided by an input image) — concept art, interiors, products, marketing visuals. " +
        'Set format="svg" for a vector illustration (Fluw Vector AI). Costs 2 credits per image.',
      inputSchema: {
        prompt: z.string().min(1).max(4000).describe("What to generate."),
        aspect_ratio: z.enum(["16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"]).optional(),
        styles: f.styles,
        image: imageInput("Optional guide image").optional(),
        engine: f.engine,
        enhance_prompt: f.enhancePrompt,
        seed: f.seed,
        format: z.enum(["jpg", "png", "webp", "svg"]).optional().describe("Output format; svg switches to Fluw Vector AI."),
        variations: f.variations,
      },
      annotations: { title: "Text to image", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      const image = await ctx.files.resolveOptional(a.image, { signal: ctx.signal });
      if (a.format === "svg") {
        return generate(
          ctx,
          "Fluw Vector AI",
          {
            model: "fluwvector",
            image,
            prompt: a.prompt,
            aspect_ratio: a.aspect_ratio,
            seed: a.seed,
            enhance_prompt: a.enhance_prompt ? "true" : undefined,
          },
          a.variations,
        );
      }
      return generate(ctx, "Fluw AI", { model: "fluw", image, ...common(a), aspect_ratio: a.aspect_ratio }, a.variations);
    }),
  );

  server.registerTool(
    "luw_generate_pattern",
    {
      title: "Seamless pattern / texture (Pattern AI)",
      description:
        "Luw.ai Pattern AI: generate a seamless, tileable pattern or texture — tiles, wallpaper, fabric, terrazzo, wood, stone — ready to repeat across a surface. Costs 1 credit.",
      inputSchema: {
        prompt: z.string().min(1).max(4000).describe('The pattern, e.g. "blue and white Moroccan zellige tiles".'),
        image: imageInput("Optional reference image").optional(),
        size: z
          .union([z.literal(512), z.literal(768), z.literal(1024)])
          .optional()
          .describe("Output size in px. aria: 512 or 768 (default); symphony: 512 or 1024 (default)."),
        engine: f.engine,
        enhance_prompt: f.enhancePrompt,
        format: f.format,
      },
      annotations: { title: "Pattern", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      const symphony = a.engine === "symphony";
      let texture: number | undefined;
      if (a.size === 512) texture = -1;
      else if (a.size === 768 && !symphony) texture = 0;
      else if (a.size === 1024 && symphony) texture = 1;
      else if (a.size !== undefined) {
        throw new InputError(`size ${a.size} isn't available with the ${symphony ? "symphony" : "aria"} engine — use ${symphony ? "512 or 1024" : "512 or 768"}.`);
      }
      const image = await ctx.files.resolveOptional(a.image, { signal: ctx.signal });
      return generate(ctx, "Pattern AI", { model: "pattern", image, ...common(a), texture });
    }),
  );

  server.registerTool(
    "luw_generate_video",
    {
      title: "Image to cinematic video (Video AI)",
      description:
        "Luw.ai Video AI (Motion): animate a design image into a short cinematic video — fly-throughs, dolly moves, drone shots, reveals. " +
        "Camera motions: A Forward Dolly, Flythrough Cinematic, Return to Empty Room, Lighting and Color Details, Drone flying to center, Dramatic Zoom Out, " +
        "Reverse Zoom In, Slow Pull Back, Reveal Zoom, Ground to Sky Tilt, Side Tracking Zoom, Aerial Descent. " +
        "Takes a few minutes — expect a processing_url to collect with luw_get_result. Costs 10 credits (aria) or 20 (symphony).",
      inputSchema: {
        image: imageInput("Start frame (a render or photo)"),
        prompt: z.string().max(4000).optional().describe("What should happen in the video."),
        camera_motion: z.string().optional().describe('One of the camera motions listed above, e.g. "Flythrough Cinematic".'),
        engine: f.engine,
        enhance_prompt: f.enhancePrompt,
        seed: f.seed,
      },
      annotations: { title: "Video", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      const image = await ctx.files.resolve(a.image, { signal: ctx.signal });
      return generate(ctx, "Video AI", {
        model: "video",
        image,
        ...common({ ...a, styles: a.camera_motion ? [a.camera_motion] : undefined }),
      });
    }),
  );

  server.registerTool(
    "luw_image_to_3d",
    {
      title: "Image to 3D model (3DGen AI)",
      description:
        "Luw.ai 3DGen AI: generate a textured 3D model (GLB) from a photo of an object — furniture, decor, products. Add up to 3 photos from other angles for better accuracy. " +
        "For text-to-3D, first make an image with luw_generate_image. Costs 3 credits (aria) or 8 (symphony).",
      inputSchema: {
        image: imageInput("Photo of the object"),
        extra_angles: z.array(imageInput("Another angle of the same object")).max(3).optional(),
        engine: f.engine,
        reflections: z.boolean().optional().describe("Enable reflective materials (symphony engine only)."),
        simplify: z.number().int().min(0).optional().describe("Mesh simplification level (0 = off, default)."),
        texture: z.number().int().min(0).optional().describe("Texture size setting (0 = default)."),
        seed: f.seed,
      },
      annotations: { title: "Image to 3D", ...GENERATE },
    },
    handler(deps, async (a, ctx) => {
      if (a.reflections && a.engine !== "symphony") {
        throw new InputError('reflections only works with engine="symphony".');
      }
      const [image, refs] = await Promise.all([
        ctx.files.resolve(a.image, { signal: ctx.signal }),
        referenceParams(ctx, a.extra_angles, 3),
      ]);
      return generate(ctx, "3DGen AI", {
        model: "3dgen",
        image,
        ...refs,
        ...common({ engine: a.engine, seed: a.seed }),
        reflect: a.reflections ? 1 : undefined,
        simplify: a.simplify || undefined,
        texture: a.texture || undefined,
      });
    }),
  );
}

export const GENERATE_TOOL_NAMES = [
  "luw_interior_design",
  "luw_exterior_design",
  "luw_sketch_to_render",
  "luw_render",
  "luw_edit_image",
  "luw_magic_wand",
  "luw_landscape_design",
  "luw_image_tools",
  "luw_background",
  "luw_segment",
  "luw_generate_image",
  "luw_generate_pattern",
  "luw_generate_video",
  "luw_image_to_3d",
];
