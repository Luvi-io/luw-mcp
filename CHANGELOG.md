# Changelog

## Unreleased

- Hosted endpoint: "Sign in to Luw.ai" (MCP OAuth). Clients add `https://mcp.luw.ai/mcp` and sign in instead of pasting a key; the sign-in hands them a regular API key created on the Luw.ai consent page. Stateless (signed registrations, encrypted two-minute codes, PKCE S256 required). Enabled by `LUW_MCP_OAUTH_SECRET`; keys in `Authorization`, `X-Luw-Api-Key` or `?api_key=` keep working. `/health` reports `oauth`.
- App directory readiness (ChatGPT, Claude): with sign-in on, every tool declares `securitySchemes` (oauth2, in `_meta`); every tool states `readOnlyHint`, `destructiveHint` and `openWorldHint`; a key Luw.ai rejects mid-session returns a `mcp/www_authenticate` challenge so the client offers to sign in again; hosted error messages say "reconnect" instead of `LUW_API_KEY` and never link to pricing; `OPENAI_APPS_CHALLENGE` is served at `/.well-known/openai-apps-challenge` for ChatGPT domain verification.
- Tool descriptions start with the Luw.ai app name (Interior AI, Magic Prompt AI, Magic Wand AI, Fluw AI, …). Clients show titles but give models only descriptions, so "use Magic Prompt" didn't reach `luw_edit_image`.
- A job that finishes with no output now says so (status `empty`) instead of a bare "finished"; Segment AI adds what to try when a prompt matched nothing.
- Hosted `luw_upload_file` describes what it accepts there (data: URIs), instead of advertising local paths and URLs it refuses. Style examples use valid names ("Japandi" isn't one; use Japanese Design + Scandinavian).
- Resources: `luw://account` (credit balance), `luw://history/{app}` (the 10 most recently updated projects in a Luw.ai app with their latest results, from the web app's paged listing), `luw://projects/{id}` (a project's items, with the real file behind each video, 3D or SVG thumbnail), `luw://catalog/{kind}` (the `luw_list_options` catalogs with previews) and `luw://guide` (every tool and its cost, built from the tool descriptions). Users attach them as context, e.g. `@luw:luw://account` in Claude Code.
- ChatGPT plugin directory: photos a user attaches in ChatGPT reach the generation tools and ArchiGPT through an `image_file` field (`_meta["openai/fileParams"]`, hosted server only); its download link becomes the image. `luw_archigpt` no longer takes `history` (the directories forbid asking for prior turns); each call is a standalone question. `luw_run_model` is local-only, since the directories reject generic executors; the hosted server lists 20 tools. The plugin package lives in `plugins/chatgpt/`. `luw_image_tools` is split into `luw_upscale_image`, `luw_expand_image`, `luw_remove_furniture` and `luw_vectorize_image`: the ChatGPT scan rejects a tool that picks its operation from an argument.
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
