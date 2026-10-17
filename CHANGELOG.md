# Changelog

## 0.3.3

- Studio tools run Pascal's scene tools as Luw Studio runs them after its 2026-10-17 merge: `create_stair` builds L and U stairs, railings and steps to no level; `create_roof` builds barrel and glazed roofs, and a gable segment takes its own overhang; `paint` reaches every part with surfaces and keeps a native material in the scene, `search_materials` browses and pages the library; `get_site` reads the lot's frontage, depth, buildable edges and ground; `find_by_type` takes find_nodes' filters and `get_node` what describe_node added; `verify_scene` also lists schema errors and rooms the walls leave open; every length and angle takes text in any unit ("6 ft", "6:12"). `move_roofs_to_roof_level` joins.
- `find_nodes`, `describe_node` and `validate_scene` are retired, as on Pascal's server: they are no longer listed, and a call to one answers `tool_retired` with the tool that replaced it and how to use it. The guide names `find_by_type` and `get_node`.
- Tool descriptions call the material library Luw Studio's.
- `scripts/vendor-pascal.mjs` says to install the rebuilt tarballs themselves: npm keeps a cached build whose integrity the lockfile holds.

## 0.3.2

- `luw_generate_video` takes an optional `end_image`: the video moves from `image` to that frame (e.g. a photo and its redesign for a before → after). Same cost; both engines support it. `luw_run_model` also resolves `end_image` from local paths and data: URIs.

## 0.3.1

- Studio tools keep the assistant's session as Pascal's server does for a connection: its checkpoints (`set_checkpoint`) and what it made, stored with the project (slot 1011) between calls; an hour without a call starts a new one. `verify_scene` takes `since` (a checkpoint's name), the input Pascal's operation reads and its hosted app adds, and lists what changed after it.

## 0.3.0

- Luw Studio tools (toolset `studio`; hosted at `https://mcp.luw.ai/studio`, same sign-in): assistants edit the user's Luw Studio 3D projects. `luw_studio_list_projects`, `luw_studio_create_project` (empty site or a starter template), `luw_studio_rename_project`, `luw_studio_undo`, and 63 of Pascal's open-source MCP scene tools (`@pascal-app/mcp`, MIT), each taking a `project_id`. The server keeps no scene between calls: a call loads its project from Luw.ai, runs the tool on Pascal's headless core and saves a changed scene back in Studio's format, keeping the scene it replaced for `luw_studio_undo` and stamping the project so an open Studio tab loads the edit. A save that finds the project changed since it was read runs the edit again on the newer scene; an edit that would empty the project, a template over an existing design and edits to projects last saved by the previous Luw Studio are refused. Left out: geometry scripts (`add_object`, `get_source`), rendering (`view_scene`, `export_glb`), `export_json`, `clear_scene`, Pascal's in-memory `undo`/`redo`, `set_checkpoint` (its checkpoints live in a session that lasts one call here) and `create_house_from_brief`. Resources `luw://studio/guide` and `luw://studio/design-schema`.
- Pascal's core and MCP are bundled as Luw Studio builds them (`vendor/`, rebuilt by `scripts/vendor-pascal.mjs`), so the tools share Studio's patches: a small bathroom gets Luw's single vanity, not a 1.83 m double. Items come from Studio's catalog (`LUW_STUDIO_CATALOG_URL`), with Pascal's starter list and Luw's pieces as the fallback.
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
