# Maintainer guide

How the Luw.ai MCP server is shipped. Users can reach it four ways, and each one is set up once here:

| Channel | What users do | Source |
|---|---|---|
| npm `@luw-ai/mcp` | `npx -y @luw-ai/mcp` in any client | `release.yml` publishes on tag |
| Claude Desktop extension | Double-click `luw.mcpb` | `release.yml` attaches it to the GitHub release |
| Hosted endpoint `https://mcp.luw.ai/mcp` | Paste a URL plus a header | Deploy this repo (Docker or Heroku) |
| MCP Registry `ai.luw/mcp` | Found in registry-backed clients and directories | `release.yml` (optional step) |

## One-time setup

1. **GitHub**: push this repo to `github.com/Luvi-io/luw-mcp`. README badges and links assume that path. If you use another path, search and replace `Luvi-io/luw-mcp`.
2. **npm**: create the `luw-ai` org on npmjs.com (free for public packages). Create an *Automation* token and save it as the `NPM_TOKEN` repository secret.
3. **MCP Registry** (optional): uses DNS auth for the `ai.luw/*` namespace.
   ```bash
   # macOS: use Homebrew OpenSSL 3; the system LibreSSL lacks Ed25519.
   openssl genpkey -algorithm Ed25519 -out mcp-registry.pem
   echo "luw.ai. IN TXT \"v=MCPv1; k=ed25519; p=$(openssl pkey -in mcp-registry.pem -pubout -outform DER | tail -c 32 | base64)\""
   openssl pkey -in mcp-registry.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n'   # → MCP_REGISTRY_PRIVATE_KEY secret
   ```
   Add the TXT record to the apex of `luw.ai`, then save the hex private key as the `MCP_REGISTRY_PRIVATE_KEY` secret. The release workflow skips this step while the secret is missing.

## Deploying the hosted endpoint

The server is stateless and holds no secrets. Every request carries the user's own key, so any container host works. Point `mcp.luw.ai` at it.

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

1. Bump `version` in `package.json`, `server.json` (both `version` fields) and `manifest.json`. `npm test` fails if they disagree.
2. Update `CHANGELOG.md`.
3. `git tag v0.2.0 && git push --tags`

The release workflow checks that the tag matches `package.json`, runs typecheck, tests and build, publishes to npm with provenance, builds `luw.mcpb` and attaches it to a GitHub release, and publishes `server.json` to the MCP Registry when the secret is set.

## Adding a new Luw.ai model

1. Add a tool in `src/tools/generate.ts` that maps friendly snake_case arguments to API parameters. Resolve every image argument through `ctx.files.resolve`.
2. Add the model id to `MODEL_IDS` in `src/catalog.ts` so `luw_run_model` lists it.
3. Add it to `manifest.json` → `tools` (the packaging test enforces this) and to the README tools table.
4. Add a test in `test/tools.test.ts` that asserts the exact request body.
