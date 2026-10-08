// OAuth 2.1 for the hosted endpoint, so remote MCP clients (claude.ai, Claude Code, Cursor,
// VS Code, ChatGPT, …) connect with "Sign in to Luw.ai" instead of a pasted API key.
//
// The access token *is* a regular Luw.ai API key, created for the user on the consent page at
// app.luw.ai/mcp/connect. Everything downstream stays exactly as it was (`Authorization: Bearer`
// with a key), and disconnecting means deleting that key on the API page.
//
// Like the rest of the server this is stateless: client registrations and pending authorization
// requests are HMAC-signed blobs, and authorization codes are AES-GCM sealed, so the key never
// appears readable in a URL. Codes can't be tracked as single-use without storage; they live
// for two minutes and are bound to the client's PKCE verifier, so only the client that started
// the flow can redeem one.
//
// Flow: /register → /authorize (→ consent page) → POST /oauth/approve (from the consent page,
// with the key) → redirect_uri?code=… → /token.

const enc = new TextEncoder();
const dec = new TextDecoder();

const REQUEST_TTL_S = 10 * 60;
const CODE_TTL_S = 2 * 60;
const MAX_REDIRECT_URIS = 10;
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface OAuthOptions {
  /** ≥ 32 characters; signs registrations and requests, seals codes. Rotating it signs every client out of pending flows only. */
  secret: string;
  /** The Luw.ai consent page (app.luw.ai/mcp/connect). */
  connectUrl: string;
}

interface ClientBlob {
  t: "client";
  n: string;
  r: string[];
}
interface RequestBlob {
  t: "request";
  /** client name and redirect URI, shown on the consent page */
  n: string;
  r: string;
  s?: string;
  cc: string;
  /** fingerprint of the client_id, checked again at /token */
  c: string;
  exp: number;
}
interface CodeBlob {
  k: string;
  r: string;
  cc: string;
  c: string;
  exp: number;
}

export function createOAuth(options: OAuthOptions) {
  const connect = new URL(options.connectUrl);
  const keys = deriveKeys(options.secret);

  const sign = async (payload: object) => {
    const body = b64url(enc.encode(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign("HMAC", (await keys).hmac, enc.encode(body));
    return `${body}.${b64url(new Uint8Array(sig))}`;
  };

  const verify = async <T extends { t: string; exp?: number }>(token: string | null, type: T["t"]): Promise<T | null> => {
    const [body, sig, extra] = (token ?? "").split(".");
    if (!body || !sig || extra !== undefined) return null;
    try {
      const ok = await crypto.subtle.verify("HMAC", (await keys).hmac, fromB64url(sig), enc.encode(body));
      if (!ok) return null;
      const payload = JSON.parse(dec.decode(fromB64url(body))) as T;
      if (payload.t !== type || (payload.exp !== undefined && payload.exp < now())) return null;
      return payload;
    } catch {
      return null;
    }
  };

  const seal = async (payload: CodeBlob) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, (await keys).aes, enc.encode(JSON.stringify(payload)));
    return b64url(concat(iv, new Uint8Array(data)));
  };

  const unseal = async (token: string | null): Promise<CodeBlob | null> => {
    try {
      const bytes = fromB64url(token ?? "");
      const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, (await keys).aes, bytes.slice(12));
      const payload = JSON.parse(dec.decode(data)) as CodeBlob;
      return payload.exp >= now() ? payload : null;
    } catch {
      return null;
    }
  };

  const metadata = (origin: string) => ({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    authorization_response_iss_parameter_supported: true,
    service_documentation: "https://github.com/Luvi-io/luw-mcp",
  });

  async function register(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
    const uris = Array.isArray(body?.redirect_uris) ? body!.redirect_uris : [];
    if (!uris.length || uris.length > MAX_REDIRECT_URIS || !uris.every((u) => typeof u === "string" && isAllowedRedirect(u))) {
      return json({ error: "invalid_redirect_uri", error_description: "redirect_uris must be https, a loopback http address, or an app scheme." }, 400);
    }
    const name = typeof body?.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : "MCP client";
    const client: ClientBlob = { t: "client", n: name, r: uris as string[] };
    return json(
      {
        client_id: await sign(client),
        client_id_issued_at: now(),
        client_name: name,
        redirect_uris: client.r,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  }

  async function authorize(url: URL): Promise<Response> {
    const p = url.searchParams;
    const clientId = p.get("client_id");
    const client = await verify<ClientBlob>(clientId, "client");
    if (!clientId || !client) return page(400, "This app isn't registered with Luw.ai. Remove the connection in your app and add it again.");
    const redirectUri = p.get("redirect_uri") ?? (client.r.length === 1 ? client.r[0]! : "");
    if (!client.r.some((r) => sameRedirect(r, redirectUri))) return page(400, "The app sent a redirect address it didn't register.");

    const state = p.get("state") ?? undefined;
    const back = (error: string, description: string) =>
      redirect(withParams(redirectUri, { error, error_description: description, state, iss: url.origin }));
    if (p.get("response_type") !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
    const challenge = p.get("code_challenge");
    if (!challenge || p.get("code_challenge_method") !== "S256") return back("invalid_request", "PKCE with S256 is required.");

    const pending: RequestBlob = {
      t: "request",
      n: client.n,
      r: redirectUri,
      s: state,
      cc: challenge,
      c: await fingerprint(clientId),
      exp: now() + REQUEST_TTL_S,
    };
    return redirect(withParams(connect.href, { request: await sign(pending) }));
  }

  /** Called by the consent page: with the user's key on "Allow", or `decision: "deny"`. */
  async function approve(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { request?: unknown; api_key?: unknown; decision?: unknown } | null;
    const pending = await verify<RequestBlob>(typeof body?.request === "string" ? body.request : null, "request");
    if (!pending) return approveJson({ error: "invalid_request", error_description: "This sign-in link expired. Start the connection again from your app." }, 400);
    const iss = new URL(request.url).origin;

    if (body?.decision === "deny") {
      return approveJson({ redirect_uri: withParams(pending.r, { error: "access_denied", state: pending.s, iss }) });
    }
    const key = typeof body?.api_key === "string" ? body.api_key.trim() : "";
    if (!key || key.length > 500) return approveJson({ error: "invalid_request", error_description: "api_key is required." }, 400);

    const code = await seal({ k: key, r: pending.r, cc: pending.cc, c: pending.c, exp: now() + CODE_TTL_S });
    return approveJson({ redirect_uri: withParams(pending.r, { code, state: pending.s, iss }) });
  }

  async function token(request: Request): Promise<Response> {
    const p = new URLSearchParams(await request.text());
    if (p.get("grant_type") !== "authorization_code") return tokenError("unsupported_grant_type", "Only authorization_code is supported.");
    const code = await unseal(p.get("code"));
    if (!code) return tokenError("invalid_grant", "The code is invalid or expired.");
    const clientId = p.get("client_id");
    if (!clientId || (await fingerprint(clientId)) !== code.c) return tokenError("invalid_grant", "The code was issued to another client.");
    const redirectUri = p.get("redirect_uri");
    if (redirectUri !== null && redirectUri !== code.r) return tokenError("invalid_grant", "redirect_uri doesn't match.");
    const verifier = p.get("code_verifier") ?? "";
    if (!verifier || b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier)))) !== code.cc) {
      return tokenError("invalid_grant", "PKCE verification failed.");
    }
    return json({ access_token: code.k, token_type: "Bearer" }, 200, { "Cache-Control": "no-store", Pragma: "no-cache" });
  }

  const approveCors = {
    "Access-Control-Allow-Origin": connect.origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  const approveJson = (value: unknown, status = 200) => json(value, status, approveCors);

  return {
    /** Serves the OAuth routes; `null` for every other path. Responses carry their own CORS headers. */
    async handle(request: Request, url: URL): Promise<Response | null> {
      const path = url.pathname;
      const method = request.method;
      if (path === "/oauth/approve") {
        if (method === "OPTIONS") return new Response(null, { status: 204, headers: approveCors });
        return method === "POST" ? approve(request) : approveJson({ error: "method_not_allowed" }, 405);
      }
      if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
        return method === "GET"
          ? json({ resource: `${url.origin}/mcp`, authorization_servers: [url.origin], bearer_methods_supported: ["header"], resource_name: "Luw.ai" })
          : null;
      }
      if (path === "/.well-known/oauth-authorization-server") return method === "GET" ? json(metadata(url.origin)) : null;
      if (path === "/register" && method === "POST") return register(request);
      if (path === "/authorize" && method === "GET") return authorize(url);
      if (path === "/token" && method === "POST") return token(request);
      return null;
    },

    /** 401 for a keyless /mcp call: tells the client where to start signing in. */
    unauthorized(url: URL): Response {
      return json({ error: "unauthorized", error_description: "Sign in to Luw.ai, or send an API key as Authorization: Bearer <key>." }, 401, {
        "WWW-Authenticate": challenge(url),
      });
    },

    /** Challenge for a key Luw.ai rejected mid-session (returned in the tool result's _meta). */
    rejectedKeyChallenge(url: URL): string {
      return challenge(url, "invalid_token", "Your Luw.ai connection has expired. Sign in again.");
    },
  };
}

export type OAuth = ReturnType<typeof createOAuth>;

function challenge(url: URL, error?: string, description?: string): string {
  const parts = [`resource_metadata="${url.origin}/.well-known/oauth-protected-resource/mcp"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description}"`);
  return `Bearer ${parts.join(", ")}`;
}

async function deriveKeys(secret: string) {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  const params = (info: string) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) });
  const [hmac, aes] = await Promise.all([
    crypto.subtle.deriveKey(params("luw-mcp oauth sign"), base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"]),
    crypto.subtle.deriveKey(params("luw-mcp oauth seal"), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
  ]);
  return { hmac, aes };
}

/** https anywhere, http only to loopback (native apps, RFC 8252), or an app's own scheme (cursor://, vscode://). */
export function isAllowedRedirect(uri: string): boolean {
  if (uri.length > 2000) return false;
  try {
    const u = new URL(uri);
    if (u.hash || BLOCKED_SCHEMES.has(u.protocol)) return false;
    if (u.protocol === "http:") return LOOPBACK.has(u.hostname);
    return true;
  } catch {
    return false;
  }
}

/** Exact match, except loopback redirects may use any port (RFC 8252 §7.3). */
function sameRedirect(registered: string, actual: string): boolean {
  if (registered === actual) return true;
  try {
    const a = new URL(registered);
    const b = new URL(actual);
    return a.protocol === "http:" && LOOPBACK.has(a.hostname) && a.hostname === b.hostname && a.protocol === b.protocol && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

async function fingerprint(clientId: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(clientId)))).slice(0, 22);
}

function withParams(base: string, params: Record<string, string | undefined>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.href;
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function tokenError(error: string, description: string): Response {
  return json({ error, error_description: description }, 400, { "Cache-Control": "no-store" });
}

/** Errors we can't send back to the app (unknown client or redirect) — shown in the browser instead. */
function page(status: number, message: string): Response {
  const safe = message.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Luw.ai</title><body style="font:16px system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1 style="font-size:1.25rem">Couldn't connect to Luw.ai</h1><p>${safe}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

const now = () => Math.floor(Date.now() / 1000);

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
