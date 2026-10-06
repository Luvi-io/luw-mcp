import { z } from "zod";
import type { Params } from "../client.js";
import { handler, json, type Deps, type Server, type ToolContext } from "../context.js";
import { InputError } from "../files.js";

const MANAGE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

function need<T>(value: T | undefined, name: string, action: string): T {
  if (value === undefined || value === null || value === "") throw new InputError(`"${name}" is required for action "${action}".`);
  return value;
}

function body(params: Params): Params {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
}

async function call(ctx: ToolContext, method: string, path: string, payload?: Params) {
  return json(
    await ctx.client.request(method, path, {
      json: payload && method !== "GET" && method !== "DELETE" ? body(payload) : undefined,
      retry: method === "GET",
      signal: ctx.signal,
    }),
  );
}

const PAGE_SIZE = 20;

function paginate<T>(items: T[], page = 1, limit = PAGE_SIZE, key: string) {
  const start = (page - 1) * limit;
  const slice = items.slice(start, start + limit);
  return { total: items.length, page, [key]: slice, has_more: start + slice.length < items.length };
}

function personaSummary(p: Params): Params {
  return prune({
    id: p.id,
    name: p.name,
    title: p.title,
    profession: p.profession,
    knows: p.knows,
    trainings: Array.isArray(p.trainings) ? p.trainings.length : p.trainings_count,
    generations: p.generations_count,
    updated_at: p.updated_at,
  });
}

function trainingSummary(t: Params): Params {
  return prune({ id: t.id, slot: t.slot, image: t.image, control_image: t.control_image, info: t.info, created_at: t.created_at });
}

function personaDetail(p: Params): Params {
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return prune({
    ...personaSummary(p),
    trainings: list(p.trainings).slice(0, 50).map((t) => trainingSummary(t as Params)),
    trainings_total: list(p.trainings).length,
    recent_generations: list(p.generations)
      .slice(-10)
      .map((g) => prune({ id: (g as Params).id, output: (g as Params).output ?? (g as Params).image, created_at: (g as Params).created_at })),
    generations_total: list(p.generations).length || p.generations_count,
    conversations_total: list(p.conversations).length,
  });
}

/** Drops null/empty fields so summaries stay small. */
function prune(obj: Params): Params {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}

async function listPersonas(ctx: ToolContext, a: { profession?: string; search?: string; page?: number; limit?: number }) {
  const page = a.page ?? 1;
  const limit = a.limit ?? PAGE_SIZE;
  const query = a.search?.trim().toLowerCase();
  if (a.profession && !query) {
    // Server-side pagination exists per profession (the web app's own listing).
    const body = await ctx.client.request<{ personas?: Params[] }>("GET", `/personas/ft-${encodeURIComponent(a.profession)}`, {
      query: { page, limit: limit + 1, slim: 1 },
      signal: ctx.signal,
    });
    const items = body.personas ?? [];
    return json({ page, personas: items.slice(0, limit).map(personaSummary), has_more: items.length > limit });
  }
  // GET /personas returns every persona with its trainings and has no paging, so trim it here.
  const body = await ctx.client.request<{ personas?: Params[] }>("GET", "/personas", { signal: ctx.signal, timeoutMs: 120_000 });
  let items = body.personas ?? [];
  if (a.profession) items = items.filter((p) => String(p.profession ?? "").toLowerCase() === a.profession!.toLowerCase());
  if (query) items = items.filter((p) => [p.name, p.title, p.knows].some((v) => typeof v === "string" && v.toLowerCase().includes(query)));
  items = [...items].sort((x, y) => String(y.updated_at ?? "").localeCompare(String(x.updated_at ?? "")));
  return json(paginate(items.map(personaSummary), page, limit, "personas"));
}

export function registerPersonaTool(server: Server, deps: Deps) {
  server.registerTool(
    "luw_personas",
    {
      title: "Manage personas & their training images",
      description:
        "Personas hold a reusable design identity: style knowledge plus saved images (trainings). Slots 1-6 train the persona's visual style " +
        '(slot 1 is the style-transfer reference used by style_reference="persona"), slot 7 is the default input image, 8+ are free-form data; ' +
        "add_training without a slot \"likes\" a design. Pass persona_id to generation tools to use one.\n" +
        "Actions: list, get, create, update, delete, list_trainings, add_training, update_training, delete_training, clear_slot.",
      inputSchema: {
        action: z.enum(["list", "get", "create", "update", "delete", "list_trainings", "add_training", "update_training", "delete_training", "clear_slot"]),
        persona_id: z.number().int().positive().optional(),
        name: z.string().optional(),
        title: z.string().optional().describe("Short description of the persona."),
        knows: z.string().optional().describe('Comma-separated style knowledge, e.g. "Modern,Minimalism" or room/building types.'),
        profession: z
          .string()
          .optional()
          .describe('Tool the persona belongs to, e.g. Interior, Exterior, MagicPrompt, MagicWand, Enhance, Video, Render, 3DGen, Fluw, Sketch, Landscape, MoodBoard, ArchiGPT. For list: only that tool\'s personas (fast).'),
        search: z.string().optional().describe("list: filter by name/title/knows."),
        page: z.number().int().min(1).optional().describe("list / list_trainings: page number (default 1)."),
        limit: z.number().int().min(1).max(100).optional().describe("list / list_trainings: items per page (default 20)."),
        training_id: z.number().int().positive().optional(),
        image: z.string().optional().describe("Training image (https:// URL, local file path, or data: URI); stored permanently."),
        slot: z.number().int().min(1).optional(),
        info: z.string().optional().describe("Description of the training image."),
        extras: z.string().optional().describe("Extra metadata, e.g. the prompt behind a liked design."),
      },
      annotations: { title: "Personas", ...MANAGE },
    },
    handler(deps, async (a, ctx) => {
      const id = () => need(a.persona_id, "persona_id", a.action);
      const trainingImage = async () =>
        a.image === undefined ? undefined : ctx.files.resolve(a.image, { temporary: false, personaId: a.persona_id, signal: ctx.signal });
      const persona = { name: a.name, title: a.title, knows: a.knows, profession: a.profession };
      switch (a.action) {
        case "list":
          return listPersonas(ctx, a);
        case "get": {
          const body = await ctx.client.request<{ persona?: Params }>("GET", `/personas/${id()}`, { signal: ctx.signal });
          return json(body.persona ? personaDetail(body.persona) : body);
        }
        case "create":
          need(a.name, "name", a.action);
          return call(ctx, "POST", "/personas", persona);
        case "update":
          return call(ctx, "PUT", `/personas/${id()}`, persona);
        case "delete":
          return call(ctx, "DELETE", `/personas/${id()}`);
        case "list_trainings": {
          const body = await ctx.client.request<{ trainings?: Params[] }>("GET", `/personas/${id()}/trainings`, { signal: ctx.signal });
          return json(paginate((body.trainings ?? []).map(trainingSummary), a.page, a.limit, "trainings"));
        }
        case "add_training":
          id();
          need(a.image, "image", a.action);
          return call(ctx, "POST", `/personas/${id()}/trainings`, { image: await trainingImage(), slot: a.slot, info: a.info, extras: a.extras });
        case "update_training":
          return call(ctx, "PUT", `/personas/${id()}/trainings/${need(a.training_id, "training_id", a.action)}`, {
            image: await trainingImage(),
            slot: a.slot,
            info: a.info,
            extras: a.extras,
          });
        case "delete_training":
          return call(ctx, "DELETE", `/personas/${id()}/trainings/${need(a.training_id, "training_id", a.action)}`);
        case "clear_slot":
          return call(ctx, "DELETE", `/personas/${id()}/trainings/slot/${need(a.slot, "slot", a.action)}`);
      }
    }),
  );
}

export function registerProjectTool(server: Server, deps: Deps) {
  server.registerTool(
    "luw_projects",
    {
      title: "Manage Luw.ai projects, folders & media",
      description:
        "Organize work in Luw.ai projects (called boards in the API), with nested folders and media. " +
        "Use add_media to save generated results into a project.\n" +
        "Actions: list, get, create, rename, delete, list_folders, create_folder, update_folder, delete_folder, add_media, delete_media, move_media.",
      inputSchema: {
        action: z.enum([
          "list",
          "get",
          "create",
          "rename",
          "delete",
          "list_folders",
          "create_folder",
          "update_folder",
          "delete_folder",
          "add_media",
          "delete_media",
          "move_media",
        ]),
        project_id: z.number().int().positive().optional(),
        name: z.string().optional().describe("Project or folder name."),
        folder_id: z.number().int().positive().optional().describe("Folder to act on, or target folder for add_media/move_media (omit = project root)."),
        parent_id: z.number().int().positive().optional().describe("Parent folder for nested folders."),
        media_id: z.number().int().positive().optional(),
        url: z.string().optional().describe("add_media: the media (https:// URL, local file path, or data: URI)."),
        control_image: z.string().optional().describe("add_media: optional source/reference image, e.g. the original photo of a redesign."),
        extras: z.string().optional().describe("add_media: metadata as a JSON string, e.g. {\"prompt\": \"…\"}."),
      },
      annotations: { title: "Projects", ...MANAGE },
    },
    handler(deps, async (a, ctx) => {
      const pid = () => need(a.project_id, "project_id", a.action);
      const persistent = (value: string | undefined) => ctx.files.resolveOptional(value, { temporary: false, signal: ctx.signal });
      switch (a.action) {
        case "list":
          return call(ctx, "GET", "/boards");
        case "get":
          return call(ctx, "GET", `/boards/${pid()}`);
        case "create":
          return call(ctx, "POST", "/boards", { name: need(a.name, "name", a.action) });
        case "rename":
          return call(ctx, "PUT", `/boards/${pid()}`, { name: need(a.name, "name", a.action) });
        case "delete":
          return call(ctx, "DELETE", `/boards/${pid()}`);
        case "list_folders":
          return call(ctx, "GET", `/boards/${pid()}/folders`);
        case "create_folder":
          return call(ctx, "POST", `/boards/${pid()}/folders`, { name: need(a.name, "name", a.action), parent_id: a.parent_id });
        case "update_folder":
          return call(ctx, "PUT", `/boards/${pid()}/folders/${need(a.folder_id, "folder_id", a.action)}`, { name: a.name, parent_id: a.parent_id });
        case "delete_folder":
          return call(ctx, "DELETE", `/boards/${pid()}/folders/${need(a.folder_id, "folder_id", a.action)}`);
        case "add_media": {
          pid();
          if (!a.url && !a.control_image) throw new InputError('add_media needs "url" (and optionally "control_image").');
          const [url, control_image] = await Promise.all([persistent(a.url), persistent(a.control_image)]);
          return call(ctx, "POST", `/boards/${pid()}/media`, { url, control_image, folder_id: a.folder_id, extras: a.extras });
        }
        case "delete_media":
          return call(ctx, "DELETE", `/boards/${pid()}/media/${need(a.media_id, "media_id", a.action)}`);
        case "move_media":
          return call(ctx, "PUT", `/boards/${pid()}/media/${need(a.media_id, "media_id", a.action)}/move`, { folder_id: a.folder_id ?? null });
      }
    }),
  );
}

export function registerTeamTool(server: Server, deps: Deps) {
  server.registerTool(
    "luw_team",
    {
      title: "Team & credits (Enterprise)",
      description:
        "Enterprise team management: plan and credit balance, per-member usage, members, roles and invitations. Some actions need admin/owner rights.\n" +
        "Actions: info, credits, usage, members, invitations, invite, remove_member, set_role, respond_invitation.",
      inputSchema: {
        action: z.enum(["info", "credits", "usage", "members", "invitations", "invite", "remove_member", "set_role", "respond_invitation"]),
        email: z.string().optional().describe("invite: email to invite."),
        role: z.enum(["member", "admin"]).optional().describe("invite / set_role."),
        user_id: z.number().int().positive().optional().describe("remove_member / set_role."),
        token: z.string().optional().describe("respond_invitation: invitation token."),
        accept: z.boolean().optional().describe("respond_invitation: true to accept, false to decline."),
      },
      annotations: { title: "Team", ...MANAGE },
    },
    handler(deps, async (a, ctx) => {
      switch (a.action) {
        case "info":
          return call(ctx, "GET", "/team/info");
        case "credits":
          return call(ctx, "GET", "/team/credits");
        case "usage": {
          const usage = await ctx.client.request<Params>("GET", "/team/usage", { signal: ctx.signal });
          delete usage.debug_info;
          return json(usage);
        }
        case "members":
          return call(ctx, "GET", "/team/members");
        case "invitations":
          return call(ctx, "GET", "/team/pending_invitations");
        case "invite":
          return call(ctx, "POST", "/team/send_invitation", { email: need(a.email, "email", a.action), role: a.role });
        case "remove_member":
          return call(ctx, "DELETE", `/team/members/${need(a.user_id, "user_id", a.action)}`);
        case "set_role":
          return call(ctx, "PUT", `/team/members/${need(a.user_id, "user_id", a.action)}/role`, { role: need(a.role, "role", a.action) });
        case "respond_invitation":
          return call(ctx, "POST", "/team/respond_invitation", {
            token: need(a.token, "token", a.action),
            act: need(a.accept, "accept", a.action) ? "accept" : "decline",
          });
      }
    }),
  );
}
