<p align="center">
  <a href="https://luw.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/logo-white.svg">
      <img alt="Luw.ai" src="assets/logo-black.svg" height="56">
    </picture>
  </a>
</p>

<h3 align="center">Official Luw.ai MCP server</h3>

<p align="center">
  AI interior, exterior and landscape design, photoreal rendering, image editing, video and 3D,<br>
  inside Claude, Cursor, VS Code, Windsurf, Codex and any other MCP client.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@luw-ai/mcp"><img alt="npm" src="https://img.shields.io/npm/v/@luw-ai/mcp?style=flat-square&color=6b46c1"></a>
  <a href="https://github.com/Luvi-io/luw-mcp/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Luvi-io/luw-mcp/ci.yml?style=flat-square&label=CI"></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://cursor.com/en-US/install-mcp?name=luw&config=eyJ1cmwiOiJodHRwczovL21jcC5sdXcuYWkvbWNwIn0%3D"><img alt="Add to Cursor" src="https://cursor.com/deeplink/mcp-install-dark.svg" height="32"></a>
  &nbsp;
  <a href="https://vscode.dev/redirect/mcp/install?name=luw&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.luw.ai%2Fmcp%22%7D"><img alt="Install in VS Code" src="https://img.shields.io/badge/VS_Code-Install_Luw.ai-0098FF?style=for-the-badge" height="32"></a>
  &nbsp;
  <a href="https://github.com/Luvi-io/luw-mcp/releases/latest/download/luw.mcpb"><img alt="Add to Claude Desktop" src="https://img.shields.io/badge/Claude_Desktop-Install_Luw.ai-D97757?style=for-the-badge&logo=claude&logoColor=white" height="32"></a>
  &nbsp;
  <a href="https://kiro.dev/launch/mcp/add?name=luw&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40luw-ai%2Fmcp%22%5D%2C%22env%22%3A%7B%22LUW_API_KEY%22%3A%22YOUR_LUW_API_KEY%22%7D%7D"><img alt="Add to Kiro" src="https://kiro.dev/images/add-to-kiro.svg" height="32"></a>
</p>

---

```text
You:     Redesign ~/Desktop/living-room.jpg in Japandi style, give me 2 options.
Claude:  ⟶ luw_interior_design  ✓ 2 designs in 21s   [shows both images]
You:     Love the first one. Make the sofa green velvet, then turn it into a fly-through video.
Claude:  ⟶ luw_edit_image ⟶ luw_generate_video   ✓
```

## Quick start

**Add `https://mcp.luw.ai/mcp` to your client and sign in to Luw.ai.** Nothing to install, no key to copy: signing in creates one for you. New accounts get free credits. To disconnect, delete that key on the [API page](https://app.luw.ai/dashboard/api).

<details open>
<summary><b>Claude (claude.ai, Claude Desktop, mobile)</b></summary>

*Settings → Connectors → Add custom connector*, paste `https://mcp.luw.ai/mcp`, then **Connect** and sign in to Luw.ai.
</details>

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add --transport http luw https://mcp.luw.ai/mcp --scope user
```

Then type `/mcp`, pick **luw** and sign in.
</details>

<details>
<summary><b>ChatGPT</b></summary>

*Settings → Apps & Connectors → Advanced settings*, turn on **Developer mode**, then **Create**: URL `https://mcp.luw.ai/mcp`, authentication **OAuth**, and sign in.
</details>

<details>
<summary><b>Cursor</b></summary>

Click **Add to Cursor** above, or add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "luw": { "url": "https://mcp.luw.ai/mcp" }
  }
}
```

Cursor shows **Needs login** next to luw; click it to sign in.
</details>

<details>
<summary><b>VS Code (Copilot)</b></summary>

Click **Install in VS Code** above, or add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "luw": { "type": "http", "url": "https://mcp.luw.ai/mcp" }
  }
}
```

VS Code asks you to sign in the first time a tool runs.
</details>

<details>
<summary><b>Any other client with remote MCP support</b></summary>

| | |
|---|---|
| URL | `https://mcp.luw.ai/mcp` |
| Transport | Streamable HTTP |
| Auth | Sign in (MCP OAuth), or header `Authorization: Bearer YOUR_LUW_API_KEY` |

For a client that can't sign in, create a key at [app.luw.ai/dashboard/api](https://app.luw.ai/dashboard/api) and send it as a header:

```json
{
  "mcpServers": {
    "luw": {
      "url": "https://mcp.luw.ai/mcp",
      "headers": { "Authorization": "Bearer YOUR_LUW_API_KEY" }
    }
  }
}
```

If it can neither sign in nor send headers, use `https://mcp.luw.ai/mcp?api_key=YOUR_LUW_API_KEY`. Anyone who has that URL can spend your credits, so keep it private.
</details>

The hosted server is stateless and stores nothing; your key goes straight to the Luw.ai API on each request. It can't read files from your computer, so give it image URLs, or use the local setup below.

### Local: work with files on your computer

The local server runs on your machine with `npx`, so it can read paths like `~/Desktop/room.jpg`. It needs [Node.js](https://nodejs.org) 18+ and an API key from [app.luw.ai/dashboard/api](https://app.luw.ai/dashboard/api).

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add luw --scope user --env LUW_API_KEY=YOUR_LUW_API_KEY -- npx -y @luw-ai/mcp
```

Or install it as a plugin. Claude Code asks for your key and keeps it in secure storage:

```bash
claude plugin marketplace add Luvi-io/luw-mcp
claude plugin install luw@luw-ai
```
</details>

<details>
<summary><b>Claude Desktop</b></summary>

**One click:** download [**luw.mcpb**](https://github.com/Luvi-io/luw-mcp/releases/latest/download/luw.mcpb), double-click it, paste your API key. No Node.js needed.

Or add this to `claude_desktop_config.json` (*Settings → Developer → Edit Config*):

```json
{
  "mcpServers": {
    "luw": {
      "command": "npx",
      "args": ["-y", "@luw-ai/mcp"],
      "env": { "LUW_API_KEY": "YOUR_LUW_API_KEY" }
    }
  }
}
```
</details>

<details>
<summary><b>Cursor</b></summary>

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "luw": {
      "command": "npx",
      "args": ["-y", "@luw-ai/mcp"],
      "env": { "LUW_API_KEY": "YOUR_LUW_API_KEY" }
    }
  }
}
```
</details>

<details>
<summary><b>VS Code (Copilot)</b></summary>

Add to `.vscode/mcp.json`. VS Code asks for your key and keeps it in its secret storage:

```json
{
  "inputs": [{ "type": "promptString", "id": "luw_api_key", "description": "Luw.ai API key", "password": true }],
  "servers": {
    "luw": {
      "command": "npx",
      "args": ["-y", "@luw-ai/mcp"],
      "env": { "LUW_API_KEY": "${input:luw_api_key}" }
    }
  }
}
```
</details>

<details>
<summary><b>Windsurf (Devin Desktop)</b></summary>

Add to `~/.config/devin/mcp_config.json` (Windows: `%APPDATA%\devin\mcp_config.json`). Older Windsurf versions use `~/.codeium/windsurf/mcp_config.json`.

```json
{
  "mcpServers": {
    "luw": {
      "command": "npx",
      "args": ["-y", "@luw-ai/mcp"],
      "env": { "LUW_API_KEY": "YOUR_LUW_API_KEY" }
    }
  }
}
```
</details>

<details>
<summary><b>OpenAI Codex CLI</b></summary>

```bash
codex mcp add luw --env LUW_API_KEY=YOUR_LUW_API_KEY -- npx -y @luw-ai/mcp
```

Or in `~/.codex/config.toml`:

```toml
[mcp_servers.luw]
command = "npx"
args = ["-y", "@luw-ai/mcp"]
env = { LUW_API_KEY = "YOUR_LUW_API_KEY" }
```
</details>

<details>
<summary><b>Gemini CLI</b></summary>

```bash
gemini extensions install https://github.com/Luvi-io/luw-mcp
```

Gemini CLI asks for your key and keeps it in the system keychain. Or add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "luw": {
      "command": "npx",
      "args": ["-y", "@luw-ai/mcp"],
      "env": { "LUW_API_KEY": "YOUR_LUW_API_KEY" }
    }
  }
}
```
</details>

<details>
<summary><b>Kiro</b></summary>

Click **Add to Kiro** above, confirm, then replace `YOUR_LUW_API_KEY` in Kiro's MCP config.
</details>

Windows: if `npx` isn't found, use `"command": "cmd", "args": ["/c", "npx", "-y", "@luw-ai/mcp"]`.

## What you can ask

- *"Redesign this bedroom (`~/Downloads/bedroom.jpg`) as Mid-Century Modern, 3 variations."*
- *"This listing photo is an empty room. Stage it as a cozy Scandinavian living room."*
- *"Render my sketch `plan-sketch.png` as a photoreal modern villa at golden hour."*
- *"Change the floor in this kitchen to herringbone oak."* (segments the floor, then swaps the material)
- *"Remove all the furniture from this room."*
- *"Put this chair photo on a terrazzo floor in a sunlit gallery for an ad."*
- *"Turn this render into a drone fly-through video."*
- *"Make a 3D model of this armchair from these 3 photos."*
- *"Seamless blue zellige tile texture, 1024px."*
- *"Ask ArchiGPT how to improve the feng shui of this floor plan."*

Built-in prompts show up as slash commands or prompt templates in your client: `redesign_room`, `stage_empty_room`, `sketch_to_render`, `product_shot`.

## Tools

| Tool | What it does | Credits |
|---|---|---|
| `luw_interior_design` | Redesign a room in any style; `empty_room` for virtual staging | 1 |
| `luw_exterior_design` | Redesign a facade or building exterior | 1 |
| `luw_sketch_to_render` | Sketch or drawing to photoreal render | 1 |
| `luw_render` | 3D, CAD or clay view to photoreal render | 1 |
| `luw_edit_image` | Edit any image with a sentence (Magic Prompt); 2K/4K | 1 |
| `luw_magic_wand` | Masked edit: replace, remove, or apply a material | 1 |
| `luw_landscape_design` | Gardens and outdoor areas, matched to climate and sun | 1 |
| `luw_upscale_image` | Enhance and enlarge 2/4/8× | 1 |
| `luw_expand_image` | Outpaint a cropped photo to a wider view | 1 |
| `luw_remove_furniture` | Empty a furnished room | 1 |
| `luw_vectorize_image` | Photo or drawing to SVG | 1 |
| `luw_background` | Remove a background, or replace it with a generated scene | 1 |
| `luw_segment` | Object masks (all objects, or by prompt) as image URLs | 1 |
| `luw_generate_image` | Text to image (Fluw), or `format: "svg"` for vectors | 2 |
| `luw_generate_pattern` | Seamless, tileable textures and patterns | 1 |
| `luw_generate_video` | Image to cinematic video with 12 camera motions | 10 (20 with Symphony) |
| `luw_image_to_3d` | Photos to a textured 3D model (GLB) | 3 (8 with Symphony) |
| `luw_archigpt` | Ask ArchiGPT, an AI architect, a standalone question (accepts images) | 1 per ~3k words |
| `luw_get_result` | Collect a long-running job (free) | 0 |
| `luw_list_options` | Valid styles, room and building types, camera motions, materials (free) | 0 |
| `luw_upload_file` | Upload a file to Luw.ai storage and get a URL (free) | 0 |
| `luw_run_model` | Call any Luw.ai model with raw [API parameters](https://luw-ai.gitbook.io/api) (local server only) | varies |
| `luw_personas` | Personas: reusable style identity, training images and slots | 0 |
| `luw_projects` | Projects (boards), folders and media | 0 |
| `luw_team` | Enterprise: credits, usage, members, invitations (opt-in) | 0 |

Every generation uses your [Luw.ai credits](https://app.luw.ai/pricing). Variations are billed one generation each.

## Resources

Read-only context you can attach to a conversation. In Claude Code, type `@luw:` to pick one; other clients that support resources offer them as attachments.

| Resource | What it holds |
|---|---|
| `luw://account` | Your credit balance |
| `luw://history/{app}` | Your 10 most recently updated projects in one Luw.ai app (Interior, Exterior, Video, …) with their latest results: file links, prompts and source images |
| `luw://projects/{id}` | One project: its folders and the file link of every item in it |
| `luw://catalog/{kind}` | Design styles, room and building types, video camera motions, materials and persona professions, with previews |
| `luw://guide` | Every tool and what it costs |

## How it works

- **Local files just work.** Any image argument accepts an `https://` URL, a local path (`~/Desktop/room.jpg`), or a `data:` URI. Local files are uploaded to Luw.ai storage as temporary files (deleted after 12 hours) and cached for the session, so repeated edits don't upload the same file again.
- **You see the results.** Finished images are embedded in the tool result, so Claude and other clients show them inline. Set `LUW_OUTPUT_DIR` to also save every result to disk.
- **Long jobs don't time out.** A call waits up to 50 seconds and streams progress to clients that show it. If a job like a video takes longer, the tool returns a `processing_url` and the assistant collects it with `luw_get_result`, without generating (or paying) twice.
- **Never billed twice.** Every generation request carries an `Idempotency-Key`, so if a network error forces a retry, Luw.ai returns the original job instead of charging again.
- **Masks are handled for you.** `luw_segment` returns masks as URLs, so *"change the floor"* becomes segment ⟶ magic wand with no manual masking.
- **Fast startup.** The package is one bundled file with zero dependencies, so `npx` downloads a single ~260 KB package and starts right away.

## Configuration

| Variable | Default | |
|---|---|---|
| `LUW_API_KEY` | (required) | Your API key ([get one](https://app.luw.ai/dashboard/api)). `LUW_API_TOKEN` also works. |
| `LUW_OUTPUT_DIR` | (off) | Also download results (images, videos, GLB, SVG) into this folder |
| `LUW_TOOLSETS` | all except `team` | Comma-separated list from `generate`, `archigpt`, `personas`, `projects`, `team`, or `all` |
| `LUW_WAIT_TIMEOUT_SECONDS` | `50` | How long a call waits before returning a `processing_url`. Raise it for clients with long tool timeouts, such as Claude Code. |
| `LUW_INLINE_IMAGES` | `true` | Embed result images in tool output |
| `LUW_API_BASE_URL` | `https://api.luw.ai/v2` | API endpoint override |

## Self-hosting the remote server

The same package serves the hosted Streamable HTTP endpoint:

```bash
npx -y @luw-ai/mcp --http --port 8080 --host 0.0.0.0   # MCP at /mcp, health at /health
```

```bash
docker build -t luw-mcp . && docker run -p 8080:8080 luw-mcp
```

It's stateless. Each request brings its own key in `Authorization: Bearer …`, `X-Luw-Api-Key`, or `?api_key=`. Set `LUW_MCP_OAUTH_SECRET` to also let clients sign in to Luw.ai instead (OAuth); the sign-in hands the client an ordinary API key. It deploys to Vercel as-is (`vercel.json` is included), and a `Procfile` is included for Heroku. See [docs/maintainers.md](docs/maintainers.md) for deployment and release steps.

## Development

```bash
npm ci
npm test               # unit and protocol tests (no network)
npm run build          # bundles dist/cli.js
npm run inspector      # try every tool in the MCP Inspector
LUW_API_KEY=... npm run smoke            # live checks against the real API (free)
LUW_API_KEY=... npm run smoke -- --paid  # plus one real generation (1 credit)
npm run mcpb           # build/luw.mcpb, the Claude Desktop extension
```

## Support

- API reference: [luw-ai.gitbook.io/api](https://luw-ai.gitbook.io/api)
- Issues: [GitHub Issues](https://github.com/Luvi-io/luw-mcp/issues)
- Email: [support@luvi.io](mailto:support@luvi.io)

MIT © [Luvi Technologies, Inc.](https://www.luvi.io)
