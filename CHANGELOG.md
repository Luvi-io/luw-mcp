# Changelog

## Unreleased

- `run_batch` runs only the scene tools Luw Studio offers on their own: its description lists them and its `calls[].tool` is an enum of them, so `add_object`, which the Studio tools leave out, is refused before it runs. `create_from_template` is described in Luw Studio's words (a starter template for an empty project) instead of Pascal's bridge and project store. ChatGPT's directory scan of the Studio app flagged both.
- The Studio tools offer no geometry-script inputs, which this server refuses (`scripts_unavailable`): `add_door`, `add_window` and `add_column` lose `code`, `language` and `params`, and `add_door` and `add_window` their `nodeId`, which only rebuilt a script (ChatGPT's scan read it as a non-destructive tool replacing a door). `add_column`'s `nodeId` still resizes a column by its fields. Their descriptions, and `furnish_room`'s, no longer send the assistant to scripts or to tools left out here (`add_object`, `get_source`, `view_scene`).
- ChatGPT app package for Luw.ai Studio in `plugins/chatgpt-studio/` (hosted `/studio`), uploaded to OpenAI's plugin dashboard as a draft.

## 0.3.16

- The scene tools follow Luw Studio's 2026-11-10 editor update: `duct_edit`, `pipe_grade`, `pipe_resize`, `pipe_offset` and `pipe_connect` change duct and pipe runs with their joints kept together, and the guide names them.

## 0.3.15

- The Studio guide (`luw://studio/guide`, and the engine's for luw-api) keeps a finished design's services for when the user asks to finalize: ducts, pipes, registers, the HVAC unit, traps and the lineset as `apply_patch` creates on the level, with their fields; the Skeleton X-ray and streets are added in Studio. A concept sketch, never code-compliant.

## 0.3.14

- The package is Luvi Technologies' own (LICENSE): free to install and run with a Luw.ai account, not to copy, change or redistribute. The bundles are minified, and `dist/THIRD_PARTY_NOTICES.md` lists the bundled open-source software by license: each license's copyright notices, then its text once. The Claude Desktop extension carries the notices too.
- `@luw-ai/mcp/engine` exports the scene tools as `sceneTools` (was `pascalTools`).
- npm gets the package without its build scripts and devDependencies (`build/npm`, written by `npm run build`).
- `luw_edit_image` with `resolution: "4k"` sends `uhd=1`, the 4K switch Luw.ai's Magic Prompt reads; it sent `hd=4`, which Magic Prompt ignores, so 4K came back 2K. 4K costs one more credit, as on luw.ai.
- `@luw-ai/mcp/engine` also holds Luw.ai's generation tools for a host that runs them on its own server with its caller's key: `designToolDefinitions()` lists the `generate` toolset with `luw_get_result` and `luw_list_options` (the MCP server's names, inputs and descriptions), and `runDesignTool(name, args, { apiKey })` runs one as the hosted server does, so an image is an https:// URL or a data: URI and never a file on the host. The MCP server's tools are unchanged.

## 0.3.13

- A scene's ids reach a model as `luw:` (`installedPlugins: ["luw:trees", …]`), as Luw.ai's share pages and API hand them out, from the MCP server and from `@luw-ai/mcp/engine` alike; what a model sends back with `luw:` reads as the scene's own.
- The guide names the bathroom plugin as Studio shows it: Bathrooms.
- The package carries `dist/THIRD_PARTY_NOTICES.md`, every open-source package the bundles hold with its license, written at build time from what the bundles hold.

## 0.3.12

- Studio scenes the tools save or create are stamped `luw-1`, the stamp's new name.

## 0.3.11

- Everything the Studio tools serve names Luw Studio: the tool list, `luw://studio/guide`, `luw://studio/design-schema` and each scene tool's answer, its refusals and input errors included, from the MCP server and from `@luw-ai/mcp/engine` alike. `validate_design` and `place_design` point at `luw://studio/design-schema`. Ids a model sends back keep their spelling, and Luw's own tools answer as before.
- A scene stamped `luw-1`, the new name of Studio's scene stamp, reads as Studio's, as one with the old stamp does. Scenes are still written with the old stamp until Studio writes the new one.

## 0.3.10

- The package has a second entry, `@luw-ai/mcp/engine` (`dist/engine.js`, ESM, with its declarations in `dist/engine.d.ts`): the Studio scene tools without the MCP server, for a host that holds a project's scene itself and runs the tools on it in its own process, as Luw.ai Studio's API does. `apiToolDefinitions()` lists the tools the Studio toolset offers as `{name, description, input_schema}` (the same descriptions and inputs, no `project_id`, no tuples); `runToolOnGraph(graph, session, name, args)` runs one on a scene graph with the checks the MCP server makes (the tool's schema, its units and defaults, no template over a built scene, no edit that empties the project) and says whether it changed the scene; `studioGuide({ forApi: true })` is the guide without the MCP workflow. `defaultScene`, `parseScene`, `serializeScene`, `contentCount` and `loadCatalog` come along. Importing it makes no network call. `npx @luw-ai/mcp` and the hosted server are unchanged.
- Which of the editor's tools Luw offers, their inputs and the guide live in one place (`src/studio/catalog-of-tools.ts`), shared by the MCP server and the engine; the server's tool list and guide are byte for byte what 0.3.9 listed.

## 0.3.9

- Studio tools run the scene tools as Luw Studio runs them after its 2026-11-07 merge. Doors and windows take the editor's new options, in `add_door`, `add_window` and `create_room`'s openings: a tilt-and-turn window (tilted or turned open), which way a sash opens and its hinge side, exterior shutters, a roller shutter, an interior sill, a sash handle and panes per sash; sidelights and a transom beside and over a swing door, folding doors of 2, 4, 6 or 8 leaves, sliding doors of up to 4 and a bypass closet, and a handle style (lever, curved lever, knob, bar or plate). `paint` finishes a window's hardware and shutters. A project Studio saved with any of these loads and edits as it is, where 0.3.8 read those doors and windows as invalid and left them out of the level's counts. Tool descriptions say what each tool returns.
- `search_assets`, `furnish_room` and the other furnishing tools read Studio's catalog as before. The editor's tools now take a catalog they search instead of being handed it whole: Luw's answers from the list Studio serves, read once a call, and `furnish_room` still chooses its rug, plant and bathroom pieces from all of it, Luw's included.

## 0.3.8

- `bathroom_add` lays a bathroom out in a Studio project with Bath Space's fixtures, the bathroom pieces Studio's Build tab places: a wall-hung or floor toilet with its flush plate and paper holder, a wall vanity with a basin, mixer and mirror, a walk-in shower or a bath in a corner, and a towel rail, each against a wall of the room with room to use it, clear of the door's swing and the windows. The guide sends bathrooms to it instead of catalog pieces. The server knows Bath Space's fixtures by their schemas only (`scripts/vendor-bath-space.mjs` copies them from the plugin, MIT); Studio draws them.
- `verify_scene` reads a wall that holds a Bath Space fixture instead of calling it invalid, so a bathroom no longer hides its walls and door from the check.
- Scene tools take a plugin's node (a Bath Space fixture) by the schema its kind registered, where the editor's parser knew only its own kinds.
- zod 4.6, the version the editor's packages use, so the server runs one copy.

## 0.3.7

- `kitchen_add_run` lays a modular kitchen in a Studio project, the kind Studio's Build tab draws: along one wall, or two or three walls that meet at inside corners (a straight run, an L or a U), with a fridge, the sink and a dishwasher, a cooktop with worktop either side, a wall cabinet above each base module and a hood over the cooktop. It stops at doors, at windows whose sill is below the worktop and at other cabinets; a short wall gives up the lesser pieces first, and a cooktop or sink with no room moves to another wall. `modules` lays a wall out by hand. `kitchen_finish_run` aligns a run or closes small gaps at its ends. The guide sends kitchens to it instead of catalog counters.
- `scripts/vendor-editor.mjs` vendors the editor's built-in kinds too, for their agent tools; its tarball leaves out the editor, viewer and React Three Fiber peers the tools never load.

## 0.3.6

- Studio tools run the scene tools as Luw Studio runs them after its 2026-11-05 merge. `move_node` moves one node the way the editor's move tool does (a door, window or wall item slides along its wall and stays on it; a ceiling item keeps its drop) and `duplicate_node` copies one; `verify_scene` catches more of what is wrong in a built house, with fewer false alarms; `search_assets` ranks its matches and caps each query at 24 (a limit up to 60); walls mend T-junction cracks and rise to a raised upper floor; doors draw their hardware.
- `furnish_room` dresses a living room, bedroom or dining room as Luw Studio's assistant does: the largest flat rug that leaves a quarter of the room clear, in its middle, and a floor plant in a free corner, from the catalog.

## 0.3.5

- Studio tools run the scene tools as Luw Studio runs them after its 2026-10-31 merge. `set_wall_type` gives standard walls an assembly (its layers and thickness); a room can be a porch, deck or patio, with its posts and beam; a column can be a framing post. Unpainted walls take the editor's defaults now: a soft grey inside, raw drywall outside until a cladding or paint is chosen.
- Luw.ai is in ChatGPT's app directory ([Luw.ai in ChatGPT](https://chatgpt.com/plugins/plugin_asdk_app_6ac8d1bd0f908191a97db90c129430f6)), on the hosted `/mcp` endpoint. The README's ChatGPT setup and an "Add to ChatGPT" button open it; Developer mode stays for the Studio tools (`/studio`), which aren't listed yet.

## 0.3.4

- Studio tools run the scene tools as Luw Studio runs them after its 2026-10-29 merge. `view_assets` shows catalog pieces (a picture of each, its size and the surfaces `paint` can finish), Luw's own pieces read from Studio; `set_ground_level` makes a level the ground floor, so the ones below are basements. Furnishing is not held behind a design brief: the catalog comes first, `place_design` makes what it lacks. `design_brief` and `author_scene` are left out (the second compiles item modules, as `add_object` does).
- The guide says where furniture comes from: the catalog, `view_assets` when the choice matters, a design for a piece the catalog lacks or one of the user's own size.
- Tool descriptions and their inputs call the library Luw Studio's, as 0.3.3 meant to: its rewrite never matched (the word boundaries had become backspaces), and its test, written the same way, passed regardless.
- The editor's tools are written for the MCP SDK v2 now; this server stays on v1 and takes them over (their object schemas, and the answer to a retired tool).

## 0.3.3

- Studio tools run the scene tools as Luw Studio runs them after its 2026-10-17 merge: `create_stair` builds L and U stairs, railings and steps to no level; `create_roof` builds barrel and glazed roofs, and a gable segment takes its own overhang; `paint` reaches every part with surfaces and keeps a native material in the scene, `search_materials` browses and pages the library; `get_site` reads the lot's frontage, depth, buildable edges and ground; `find_by_type` takes find_nodes' filters and `get_node` what describe_node added; `verify_scene` also lists schema errors and rooms the walls leave open; every length and angle takes text in any unit ("6 ft", "6:12"). `move_roofs_to_roof_level` joins.
- `find_nodes`, `describe_node` and `validate_scene` are retired, as on the editor's server: they are no longer listed, and a call to one answers `tool_retired` with the tool that replaced it and how to use it. The guide names `find_by_type` and `get_node`.
- Tool descriptions call the material library Luw Studio's.
- `scripts/vendor-editor.mjs` says to install the rebuilt tarballs themselves: npm keeps a cached build whose integrity the lockfile holds.

## 0.3.2

- `luw_generate_video` takes an optional `end_image`: the video moves from `image` to that frame (e.g. a photo and its redesign for a before → after). Same cost; both engines support it. `luw_run_model` also resolves `end_image` from local paths and data: URIs.

## 0.3.1

- Studio tools keep the assistant's session as the editor's server does for a connection: its checkpoints (`set_checkpoint`) and what it made, stored with the project (slot 1011) between calls; an hour without a call starts a new one. `verify_scene` takes `since` (a checkpoint's name), the input the editor's operation reads and its hosted app adds, and lists what changed after it.

## 0.3.0

- Luw Studio tools (toolset `studio`; hosted at `https://mcp.luw.ai/studio`, same sign-in): assistants edit the user's Luw Studio 3D projects. `luw_studio_list_projects`, `luw_studio_create_project` (empty site or a starter template), `luw_studio_rename_project`, `luw_studio_undo`, and 63 open-source MCP scene tools (MIT), each taking a `project_id`. The server keeps no scene between calls: a call loads its project from Luw.ai, runs the tool on the editor's headless core and saves a changed scene back in Studio's format, keeping the scene it replaced for `luw_studio_undo` and stamping the project so an open Studio tab loads the edit. A save that finds the project changed since it was read runs the edit again on the newer scene; an edit that would empty the project, a template over an existing design and edits to projects last saved by the previous Luw Studio are refused. Left out: geometry scripts (`add_object`, `get_source`), rendering (`view_scene`, `export_glb`), `export_json`, `clear_scene`, the editor's in-memory `undo`/`redo`, `set_checkpoint` (its checkpoints live in a session that lasts one call here) and `create_house_from_brief`. Resources `luw://studio/guide` and `luw://studio/design-schema`.
- The editor's core and MCP are bundled as Luw Studio builds them (`vendor/`, rebuilt by `scripts/vendor-editor.mjs`), so the tools share Studio's patches: a small bathroom gets Luw's single vanity, not a 1.83 m double. Items come from Studio's catalog (`LUW_STUDIO_CATALOG_URL`), with the editor's starter list and Luw's pieces as the fallback.
- Requires Node.js 20 or newer (was 18). The bundle is ~0.9 MB packed.

## 0.2.0

0.1.1 never reached npm (its release stopped at publishing), so this release also carries its changes.

- Hosted endpoint: "Sign in to Luw.ai" (MCP OAuth). Clients add `https://mcp.luw.ai/mcp` and sign in instead of pasting a key; the sign-in hands them a regular API key created on the Luw.ai consent page. Stateless (signed registrations, encrypted two-minute codes, PKCE S256 required). Enabled by `LUW_MCP_OAUTH_SECRET`; keys in `Authorization`, `X-Luw-Api-Key` or `?api_key=` keep working. `/health` reports `oauth`.
- App directory readiness (ChatGPT, Claude): with sign-in on, every tool declares `securitySchemes` (oauth2, in `_meta`); every tool states `readOnlyHint`, `destructiveHint` and `openWorldHint`; a key Luw.ai rejects mid-session returns a `mcp/www_authenticate` challenge so the client offers to sign in again; hosted error messages say "reconnect" instead of `LUW_API_KEY` and never link to pricing; `OPENAI_APPS_CHALLENGE` is served at `/.well-known/openai-apps-challenge` for ChatGPT domain verification.
- Tool descriptions start with the Luw.ai app name (Interior AI, Magic Prompt AI, Magic Wand AI, Fluw AI, …). Clients show titles but give models only descriptions, so "use Magic Prompt" didn't reach `luw_edit_image`.
- A job that finishes with no output now says so (status `empty`) instead of a bare "finished"; Segment AI adds what to try when a prompt matched nothing.
- Hosted `luw_upload_file` describes what it accepts there (data: URIs), instead of advertising local paths and URLs it refuses. Style examples use valid names ("Japandi" isn't one; use Japanese Design + Scandinavian).
- Resources: `luw://account` (credit balance), `luw://history/{app}` (the 10 most recently updated projects in a Luw.ai app with their latest results, from the web app's paged listing), `luw://projects/{id}` (a project's items, with the real file behind each video, 3D or SVG thumbnail), `luw://catalog/{kind}` (the `luw_list_options` catalogs with previews) and `luw://guide` (every tool and its cost, built from the tool descriptions). Users attach them as context, e.g. `@luw:luw://account` in Claude Code.
- ChatGPT plugin directory: photos a user attaches in ChatGPT reach the generation tools and ArchiGPT through an `image_file` field (`_meta["openai/fileParams"]`, hosted server only); its download link becomes the image. `luw_archigpt` no longer takes `history` (the directories forbid asking for prior turns); each call is a standalone question. `luw_run_model`, `luw_personas` and `luw_projects` are local-only, since the directories reject generic executors and tools that pick an operation from an argument; hosted clients read projects through the `luw://projects` resources. The hosted server lists 21 tools. The plugin package lives in `plugins/chatgpt/`. `luw_image_tools` is split into `luw_upscale_image`, `luw_expand_image`, `luw_remove_furniture` and `luw_vectorize_image`: the ChatGPT scan rejects a tool that picks its operation from an argument.
- Result viewer (MCP Apps, hosted server): ChatGPT shows neither images a tool returns nor image links the model writes, so generation results and `luw_get_result` now open in an in-conversation viewer: a before/after slider when there is an input photo (like the comparison on luw.ai), a tiled preview for textures, a player for videos, a card for 3D models, and an "Open full size" link. Results carry their input as `source` and textures `tile: true`; the viewer may only load Luw.ai CDN media.
- Hosted endpoint accepts clients that announce an MCP protocol version newer than the SDK knows (ChatGPT sends `2026-07-28`) instead of rejecting them with a 400; the server answers with the latest version it supports.
- README: the hosted server with sign-in is now the default setup; the one-click Cursor and VS Code buttons add it without a key (replacing 0.1.1's hosted Cursor link with a key header).

## 0.1.1

Distribution metadata only; the tools are unchanged.

- Gemini CLI extension (`gemini-extension.json`): `gemini extensions install https://github.com/Luvi-io/luw-mcp` prompts for the API key and keeps it in the system keychain.
- Claude Code plugin (`plugins/luw/`) and marketplace (`.claude-plugin/marketplace.json`): `claude plugin marketplace add Luvi-io/luw-mcp`, then `claude plugin install luw@luw-ai`.
- MCP Registry entry now carries an icon. The server's own icon URL now returns a PNG, matching its declared `mimeType`.
- README: Add to Kiro link, hosted-server link for Cursor, Devin Desktop config path for Windsurf.
- `glama.json` so the Glama listing can be claimed.

## 0.1.0

First release of the official Luw.ai MCP server.

- 14 generation tools: interior, exterior, sketch-to-render, render, prompt editing, Magic Wand, landscape, image tools (upscale, expand, remove furniture, vectorize), background, segmentation, text-to-image/SVG, patterns, video, image-to-3D.
- ArchiGPT chat; personas, projects and enterprise team management (team is opt-in via `LUW_TOOLSETS`).
- Image arguments accept URLs, local paths and `data:` URIs, with automatic temporary upload.
- Bounded waits with progress notifications and `luw_get_result` for long jobs; inline result previews (resized through the Luw.ai CDN); optional download via `LUW_OUTPUT_DIR`.
- Every `/generate` call carries an `Idempotency-Key`, so retries after network errors never charge twice.
- Persona listing is paginated and summarized (server-side paging per profession).
- Distribution: zero-dependency npm bundle (`npx -y @luw-ai/mcp`), Claude Desktop extension (`luw.mcpb`), stateless Streamable HTTP mode for hosting (`--http`, Docker, Heroku), MCP Registry metadata.
