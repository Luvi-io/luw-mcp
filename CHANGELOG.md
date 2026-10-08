# Changelog

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
