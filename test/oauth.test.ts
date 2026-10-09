import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createFetchHandler } from "../src/http.js";
import { isAllowedRedirect } from "../src/oauth.js";
import { API, fakeLuw, textOf } from "./helpers.js";

const SECRET = "test-secret-test-secret-test-secret-0123";
const CONNECT = "https://app.test/mcp/connect";
const ORIGIN = "https://mcp.test";

function setup() {
  const luw = fakeLuw().on("POST", "/generate", () => ({ status: true, output: "https://cdn.test/h.png" }));
  const config = loadConfig({}, { baseUrl: API, mode: "remote", inlineImages: false, pollIntervalMs: 5, oauthSecret: SECRET, oauthConnectUrl: CONNECT });
  const handle = createFetchHandler(config, luw.fetch);
  const fetchVia = (url: string | URL, init?: RequestInit) => handle(new Request(url, init));
  return { luw, handle, fetchVia };
}

/** In-memory stand-in for what Claude / Cursor / VS Code keep between steps. */
function memoryProvider(redirect = "http://localhost:33418/callback") {
  const store: { client?: any; tokens?: any; verifier?: string; authUrl?: URL } = {};
  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return redirect;
    },
    get clientMetadata() {
      return { client_name: "Test Client", redirect_uris: [redirect], grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" };
    },
    clientInformation: () => store.client,
    saveClientInformation: (info) => void (store.client = info),
    tokens: () => store.tokens,
    saveTokens: (t) => void (store.tokens = t),
    redirectToAuthorization: (url) => void (store.authUrl = url),
    saveCodeVerifier: (v) => void (store.verifier = v),
    codeVerifier: () => store.verifier!,
  };
  return { provider, store };
}

/** What the browser + app.luw.ai/mcp/connect do: follow /authorize to the consent page, then approve. */
async function consent(fetchVia: (u: string, i?: RequestInit) => Promise<Response>, authUrl: URL, body: Record<string, unknown>) {
  const res = await fetchVia(authUrl.href);
  expect(res.status).toBe(302);
  const consentPage = new URL(res.headers.get("location")!);
  expect(consentPage.origin + consentPage.pathname).toBe(CONNECT);
  const request = consentPage.searchParams.get("request")!;
  const approved = await fetchVia(`${ORIGIN}/oauth/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://app.test" },
    body: JSON.stringify({ request, ...body }),
  });
  return { request, approved, json: (await approved.json()) as any };
}

const pkce = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

async function registerClient(fetchVia: (u: string, i?: RequestInit) => Promise<Response>, redirect = "https://claude.test/cb") {
  const res = await fetchVia(`${ORIGIN}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect] }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as any).client_id as string;
}

/** Runs /authorize + approve by hand and returns the code from the redirect. */
async function codeFor(fetchVia: (u: string, i?: RequestInit) => Promise<Response>, clientId: string, verifier: string, redirect = "https://claude.test/cb") {
  const auth = new URL(`${ORIGIN}/authorize`);
  auth.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, state: "st", code_challenge: pkce(verifier), code_challenge_method: "S256" }).toString();
  const { json } = await consent(fetchVia, auth, { api_key: "user-key-123" });
  const back = new URL(json.redirect_uri);
  expect(back.searchParams.get("state")).toBe("st");
  expect(back.searchParams.get("iss")).toBe(ORIGIN);
  return back.searchParams.get("code")!;
}

const tokenRequest = (fetchVia: (u: string, i?: RequestInit) => Promise<Response>, params: Record<string, string>) =>
  fetchVia(`${ORIGIN}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });

afterEach(() => vi.useRealTimers());

describe("OAuth sign-in (hosted)", () => {
  it("connects an MCP client end to end with the SDK's own OAuth flow", async () => {
    const { luw, fetchVia } = setup();
    const { provider, store } = memoryProvider();
    const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { authProvider: provider, fetch: fetchVia });

    // First connect: 401 → discovery → registration → redirect to sign in.
    await expect(new Client({ name: "t", version: "1" }).connect(transport)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(store.client?.client_id).toBeTruthy();
    expect(store.authUrl!.origin + store.authUrl!.pathname).toBe(`${ORIGIN}/authorize`);

    const { json } = await consent(fetchVia, store.authUrl!, { api_key: "user-key-123" });
    const code = new URL(json.redirect_uri).searchParams.get("code")!;
    expect(json.redirect_uri.startsWith("http://localhost:33418/callback?")).toBe(true);
    expect(json.redirect_uri).not.toContain("user-key-123");

    await transport.finishAuth(code);
    expect(store.tokens).toMatchObject({ access_token: "user-key-123", token_type: "Bearer" });

    const client = new Client({ name: "t", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { authProvider: provider, fetch: fetchVia }));
    expect((await client.listTools()).tools.length).toBe(23);
    await client.callTool({ name: "luw_render", arguments: { image: "https://e.com/a.jpg" } });
    expect(luw.generates()[0]!.headers.get("authorization")).toBe("Bearer user-key-123");
    await client.close();
  });

  it("asks keyless clients to sign in, and still serves callers that bring a key", async () => {
    const { handle } = setup();
    const res = await handle(new Request(`${ORIGIN}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{}" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
    expect(res.headers.get("access-control-expose-headers")).toMatch(/WWW-Authenticate/);

    const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer k" } },
      fetch: (u, i) => handle(new Request(u, i)),
    });
    const client = new Client({ name: "t", version: "1" });
    await client.connect(transport);
    expect((await client.listTools()).tools.length).toBe(23);
    await client.close();
  });

  it("publishes discovery metadata and reports OAuth on /health", async () => {
    const { fetchVia } = setup();
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      expect(await (await fetchVia(ORIGIN + path)).json()).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
    }
    expect(await (await fetchVia(`${ORIGIN}/.well-known/oauth-authorization-server`)).json()).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/token`,
      registration_endpoint: `${ORIGIN}/register`,
      code_challenge_methods_supported: ["S256"],
    });
    expect(await (await fetchVia(`${ORIGIN}/health`)).json()).toMatchObject({ status: "ok", oauth: true });
  });

  it("rejects a wrong PKCE verifier, another client's code, and a changed redirect_uri", async () => {
    const { fetchVia } = setup();
    const clientId = await registerClient(fetchVia);
    const other = await registerClient(fetchVia, "https://other.test/cb");
    const code = await codeFor(fetchVia, clientId, "verifier-1");
    const base = { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: "https://claude.test/cb" };

    expect(((await (await tokenRequest(fetchVia, { ...base, code_verifier: "wrong" })).json()) as any).error).toBe("invalid_grant");
    expect(((await (await tokenRequest(fetchVia, { ...base, client_id: other, code_verifier: "verifier-1" })).json()) as any).error).toBe("invalid_grant");
    expect(((await (await tokenRequest(fetchVia, { ...base, redirect_uri: "https://evil.test/cb", code_verifier: "verifier-1" })).json()) as any).error).toBe("invalid_grant");
    expect(((await (await tokenRequest(fetchVia, { ...base, code: code.slice(0, -2) + "AA", code_verifier: "verifier-1" })).json()) as any).error).toBe("invalid_grant");

    const ok = await tokenRequest(fetchVia, { ...base, code_verifier: "verifier-1" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(await ok.json()).toEqual({ access_token: "user-key-123", token_type: "Bearer" });
  });

  it("expires codes after two minutes", async () => {
    const { fetchVia } = setup();
    const clientId = await registerClient(fetchVia);
    const code = await codeFor(fetchVia, clientId, "v");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3 * 60_000);
    const res = await tokenRequest(fetchVia, { grant_type: "authorization_code", code, client_id: clientId, code_verifier: "v" });
    expect(((await res.json()) as any).error).toBe("invalid_grant");
  });

  it("never redirects to an address the client didn't register, or for a forged client", async () => {
    const { fetchVia } = setup();
    const clientId = await registerClient(fetchVia);
    const params = { response_type: "code", code_challenge: pkce("v"), code_challenge_method: "S256" };

    const wrongRedirect = await fetchVia(`${ORIGIN}/authorize?${new URLSearchParams({ ...params, client_id: clientId, redirect_uri: "https://evil.test/cb" })}`);
    expect(wrongRedirect.status).toBe(400);
    expect(wrongRedirect.headers.get("location")).toBeNull();

    const [body] = clientId.split(".");
    const forged = `${body}.${"A".repeat(43)}`;
    const forgedRes = await fetchVia(`${ORIGIN}/authorize?${new URLSearchParams({ ...params, client_id: forged, redirect_uri: "https://claude.test/cb" })}`);
    expect(forgedRes.status).toBe(400);

    // Missing PKCE goes back to the (registered) app as an OAuth error.
    const noPkce = await fetchVia(`${ORIGIN}/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://claude.test/cb", state: "s" })}`);
    expect(noPkce.status).toBe(302);
    expect(new URL(noPkce.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
  });

  it("lets loopback redirects change port, as native apps do", async () => {
    const { fetchVia } = setup();
    const clientId = await registerClient(fetchVia, "http://127.0.0.1:5000/callback");
    const res = await fetchVia(
      `${ORIGIN}/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "http://127.0.0.1:61234/callback", code_challenge: pkce("v"), code_challenge_method: "S256" })}`,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")!.startsWith(CONNECT)).toBe(true);
  });

  it("sends a denial back to the app, and refuses forged or expired consent requests", async () => {
    const { fetchVia } = setup();
    const clientId = await registerClient(fetchVia);
    const auth = new URL(`${ORIGIN}/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://claude.test/cb", state: "st", code_challenge: pkce("v"), code_challenge_method: "S256" })}`);
    const { request, json, approved } = await consent(fetchVia, auth, { decision: "deny" });
    expect(approved.headers.get("access-control-allow-origin")).toBe("https://app.test");
    const back = new URL(json.redirect_uri);
    expect(back.origin + back.pathname).toBe("https://claude.test/cb");
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();

    const approve = (req: string) =>
      fetchVia(`${ORIGIN}/oauth/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: req, api_key: "k" }) });
    const [body] = request.split(".");
    expect((await approve(`${body}.${"A".repeat(43)}`)).status).toBe(400);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect((await approve(request)).status).toBe(400);
  });

  it("only accepts sensible redirect URIs at registration", async () => {
    expect(isAllowedRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirect("http://localhost:3000/callback")).toBe(true);
    expect(isAllowedRedirect("http://127.0.0.1:1/cb")).toBe(true);
    expect(isAllowedRedirect("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
    expect(isAllowedRedirect("http://evil.test/cb")).toBe(false);
    expect(isAllowedRedirect("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirect("https://claude.ai/cb#frag")).toBe(false);

    const { fetchVia } = setup();
    const res = await fetchVia(`${ORIGIN}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.test/cb"] }) });
    expect(res.status).toBe(400);
  });

  it("is off without a secret, and refuses a short one", () => {
    expect(loadConfig({}).oauthSecret).toBeUndefined();
    expect(() => loadConfig({ LUW_MCP_OAUTH_SECRET: "short" })).toThrow(/at least 32/);
  });
});

/** Connects over hosted HTTP with a key, against a fake Luw.ai API. */
async function hostedClient(luw: ReturnType<typeof fakeLuw>, oauth: boolean) {
  const config = loadConfig({}, { baseUrl: API, mode: "remote", inlineImages: false, pollIntervalMs: 5, ...(oauth ? { oauthSecret: SECRET, oauthConnectUrl: CONNECT } : {}) });
  const handle = createFetchHandler(config, luw.fetch);
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    requestInit: { headers: { Authorization: "Bearer user-key-123" } },
    fetch: (u, i) => handle(new Request(u, i)),
  });
  const client = new Client({ name: "t", version: "1" });
  await client.connect(transport);
  return client;
}

describe("app directory requirements (ChatGPT, Claude)", () => {
  it("declares sign-in on every tool and all three safety hints, with OAuth on", async () => {
    const client = await hostedClient(fakeLuw(), true);
    const { tools } = await client.listTools();
    expect(tools.length).toBe(23);
    for (const tool of tools) {
      expect(tool._meta?.securitySchemes, tool.name).toEqual([{ type: "oauth2" }]);
      for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint"] as const) {
        expect(typeof tool.annotations?.[hint], `${tool.name}.${hint}`).toBe("boolean");
      }
    }
    await client.close();

    const plain = await hostedClient(fakeLuw(), false);
    expect((await plain.listTools()).tools.every((t) => t._meta?.securitySchemes === undefined)).toBe(true);
    await plain.close();
  });

  it("asks the client to sign in again when Luw.ai rejects the key", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: false, errors: { auth: ["invalid token"] } }));
    const client = await hostedClient(luw, true);
    const result = (await client.callTool({ name: "luw_render", arguments: { image: "https://e.com/a.jpg" } })) as any;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Reconnect Luw\.ai/);
    expect(textOf(result)).not.toMatch(/LUW_API_KEY/);
    const [challenge] = result._meta["mcp/www_authenticate"];
    expect(challenge).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="Your Luw.ai connection has expired. Sign in again."`,
    );
    await client.close();
  });

  it("doesn't link to pricing from the hosted server when credits run out", async () => {
    const luw = fakeLuw().on("POST", "/generate", () => ({ status: false, insert_coin: true }));
    const client = await hostedClient(luw, true);
    const result = (await client.callTool({ name: "luw_render", arguments: { image: "https://e.com/a.jpg" } })) as any;
    expect(textOf(result)).toBe("Your Luw.ai account doesn't have enough credits for this request.");
    expect(result._meta?.["mcp/www_authenticate"]).toBeUndefined();
    await client.close();
  });

  it("serves the ChatGPT domain verification token when configured", async () => {
    const on = createFetchHandler(loadConfig({ OPENAI_APPS_CHALLENGE: "tok_123" }, { mode: "remote" }));
    const res = await on(new Request(`${ORIGIN}/.well-known/openai-apps-challenge`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).toBe("tok_123");
    const off = createFetchHandler(loadConfig({}, { mode: "remote" }));
    expect((await off(new Request(`${ORIGIN}/.well-known/openai-apps-challenge`))).status).toBe(404);
  });
});
