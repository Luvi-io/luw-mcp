# Maintainer guide

How the Luw.ai MCP server is shipped. Users can reach it six ways, and each one is set up once here:

| Channel | What users do | Source |
|---|---|---|
| npm `@luw-ai/mcp` | `npx -y @luw-ai/mcp` in any client | `release.yml` publishes on tag |
| Claude Desktop extension | Double-click `luw.mcpb` | `release.yml` attaches it to the GitHub release |
| Hosted endpoint `https://mcp.luw.ai/mcp` | Paste a URL plus a header | Deploy this repo (Docker or Heroku) |
| MCP Registry `ai.luw/mcp` | Found in registry-backed clients and directories | `release.yml` (optional step) |
| Gemini CLI extension | `gemini extensions install https://github.com/Luvi-io/luw-mcp` | `gemini-extension.json` at the repo root; the gallery at geminicli.com crawls tagged repos with the `gemini-cli-extension` topic daily |
| Claude Code plugin | `claude plugin marketplace add Luvi-io/luw-mcp`, then `claude plugin install luw@luw-ai` | `.claude-plugin/marketplace.json` lists `plugins/luw/`, read straight from `main` |

## One-time setup

1. **GitHub**: push this repo to `github.com/Luvi-io/luw-mcp`. README badges and links assume that path. If you use another path, search and replace `Luvi-io/luw-mcp`.
2. **npm**: the `luw-ai` org exists. Releases use [Trusted Publishing](https://docs.npmjs.com/trusted-publishers), so there is no npm token. On npmjs.com → `@luw-ai/mcp` → **Settings → Trusted Publisher → GitHub Actions**, the publisher is organization `Luvi-io`, repository `luw-mcp`, workflow `release.yml`. Under **Publishing access**, set "Require two-factor authentication and disallow tokens".
3. **MCP Registry** (optional): uses DNS auth for the `ai.luw/*` namespace.
   ```bash
   # macOS: use Homebrew OpenSSL 3; the system LibreSSL lacks Ed25519.
   openssl genpkey -algorithm Ed25519 -out mcp-registry.pem
   echo "luw.ai. IN TXT \"v=MCPv1; k=ed25519; p=$(openssl pkey -in mcp-registry.pem -pubout -outform DER | tail -c 32 | base64)\""
   openssl pkey -in mcp-registry.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n'   # → MCP_REGISTRY_PRIVATE_KEY secret
   ```
   Add the TXT record to the apex of `luw.ai`, then save the hex private key as the `MCP_REGISTRY_PRIVATE_KEY` secret. The release workflow skips this step while the secret is missing.
4. **Gemini CLI gallery**: add the `gemini-cli-extension` topic to the GitHub repo (*About → Topics*). The crawler only lists tagged repos that have it.

## Deploying the hosted endpoint

The server is stateless and holds no secrets. Every request carries the user's own key, so any host works. Point `mcp.luw.ai` at it.

**Vercel** (recommended; `vercel.json` and `api/mcp.ts` are included):

1. Go to [vercel.com/new](https://vercel.com/new) → **Import** `Luvi-io/luw-mcp` → **Deploy**. Every setting comes from `vercel.json`, so nothing needs to be configured, and pushes to `main` redeploy automatically.
2. Project → **Settings → Domains** → add `mcp.luw.ai`, then create the DNS record Vercel shows (`CNAME mcp → cname.vercel-dns.com`).
3. Use a Pro team for the company project. Vercel's Hobby plan is for non-commercial use.

Vercel limits to know about: request bodies up to 4.5 MB (so `data:` URI images must be smaller; URLs are unaffected) and 300 s per call (tool calls wait at most 50 s).

**Heroku** (the `Procfile` is included; Heroku runs `npm run build` automatically):

```bash
heroku create luw-mcp
git push heroku main
heroku domains:add mcp.luw.ai
```

**Docker** (Fly.io, Cloud Run, ECS, Kubernetes):

```bash
docker build -t luw-mcp .
docker run -p 8080:8080 luw-mcp          # PORT and HOST env vars are honored
```

Check it:

```bash
curl https://mcp.luw.ai/health
npx @modelcontextprotocol/inspector     # Transport: Streamable HTTP, URL: https://mcp.luw.ai/mcp, header Authorization: Bearer <key>
```

Notes:
- Tool calls stream Server-Sent Events with a keep-alive comment every 15 s, so long generations get through router idle timeouts such as Heroku's 55 s window.
- Don't log full request URLs. Clients that can't send headers put the key in `?api_key=`.
- `server.json` advertises the hosted endpoint under `remotes`. Deploy `mcp.luw.ai` before the first registry publish, or remove that block until then.

## Releasing

1. Bump `version` in `package.json`, `server.json` (both `version` fields), `manifest.json`, `gemini-extension.json`, `plugins/luw/.claude-plugin/plugin.json` and `src/version.ts`. `npm test` fails if they disagree. Claude Code users get the plugin update only when its `version` changes.
2. Update `CHANGELOG.md`.
3. `git tag v0.2.0 && git push --tags`

The release workflow checks that the tag matches `package.json`, runs typecheck, tests and build, publishes to npm through Trusted Publishing (with provenance), builds `luw.mcpb` and attaches it to a GitHub release, and publishes `server.json` to the MCP Registry when the secret is set.

## Adding a new Luw.ai model

1. Add a tool in `src/tools/generate.ts` that maps friendly snake_case arguments to API parameters. Resolve every image argument through `ctx.files.resolve`.
2. Add the model id to `MODEL_IDS` in `src/catalog.ts` so `luw_run_model` lists it.
3. Add it to `manifest.json` → `tools` (the packaging test enforces this) and to the README tools table.
4. Add a test in `test/tools.test.ts` that asserts the exact request body.
