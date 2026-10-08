# Changelog

## Unreleased

- Hosted endpoint: "Sign in to Luw.ai" (MCP OAuth). Clients add `https://mcp.luw.ai/mcp` and sign in instead of pasting a key; the sign-in hands them a regular API key created on the Luw.ai consent page. Stateless (signed registrations, encrypted two-minute codes, PKCE S256 required). Enabled by `LUW_MCP_OAUTH_SECRET`; keys in `Authorization`, `X-Luw-Api-Key` or `?api_key=` keep working. `/health` reports `oauth`.
- App directory readiness (ChatGPT, Claude): with sign-in on, every tool declares `securitySchemes` (oauth2, in `_meta`); every tool states `readOnlyHint`, `destructiveHint` and `openWorldHint`; a key Luw.ai rejects mid-session returns a `mcp/www_authenticate` challenge so the client offers to sign in again; hosted error messages say "reconnect" instead of `LUW_API_KEY` and never link to pricing; `OPENAI_APPS_CHALLENGE` is served at `/.well-known/openai-apps-challenge` for ChatGPT domain verification.
- Tool descriptions start with the Luw.ai app name (Interior AI, Magic Prompt AI, Magic Wand AI, Fluw AI, …). Clients show titles but give models only descriptions, so "use Magic Prompt" didn't reach `luw_edit_image`.
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
