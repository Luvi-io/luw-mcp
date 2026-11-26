import { z } from "zod";
import { LuwApiError } from "../client.js";
import { STUDIO_URL } from "../config.js";
import { handler, type Deps, type Server } from "../context.js";
import { InputError } from "../files.js";
import { projectId } from "./catalog-of-tools.js";
import { describeProject } from "./projects.js";
import { projectNumber } from "./tools.js";

// Luw Studio inside the conversation (hosted server, where the host draws MCP Apps views: ChatGPT, Claude).
// One view, two things it can hold:
//   - a project of the user's as the live editor (luw_studio_open): Studio's own page in its frame mode
//     (studio.luw.ai/?frame=1, luw/frame/chat-frame.ts there), signed in with a short session the view
//     asks this server for (luw_studio_session). The assistant's scene edits appear in it by themselves.
//   - a shared project to look at (luw_studio_show_shared): Studio's share page, which needs no account.

/** Bump the version on breaking changes: hosts cache templates by URI. */
export const STUDIO_VIEW_URI = "ui://luw/studio-view-v1.html";

/** When the tool answered, in the result's `_meta`, which the view gets and the model doesn't. */
const SHOWN_AT = "luw/shownAt";
/** The frame's session and its seconds to live, in the result's `_meta`: for the view alone. */
const SESSION = "luw/session";
const EXPIRES_IN = "luw/expiresIn";

// Where Studio keeps project covers: the one place the view loads a picture from.
const COVERS_URL = "https://i.luvicdn.com";

// A share's token, as Luw Studio's share page checks it (luw/share/api.ts).
const TOKEN = /^[\w-]{8,64}$/;

/** The token in a share link (https://studio.luw.ai/s/<token>, whatever follows), or a token given alone. */
export function shareToken(link: string): string | null {
  const value = link.trim();
  if (TOKEN.test(value)) return value;
  try {
    const url = new URL(value);
    const [, segment, token, ...rest] = url.pathname.split("/");
    const ok = url.origin === STUDIO_URL && segment === "s" && rest.every((part) => part === "" || part === "og");
    return ok && token && TOKEN.test(token) ? token : null;
  } catch {
    return null;
  }
}

interface SharedProject {
  name?: string;
  owner?: string | null;
  cover?: string | null;
  explore?: { description?: string | null } | null;
}

interface FrameSession {
  t?: unknown;
  s?: unknown;
  a?: unknown;
  p?: unknown;
}

const VIEW_META = { ui: { resourceUri: STUDIO_VIEW_URI }, "openai/outputTemplate": STUDIO_VIEW_URI };

export function registerStudioView(server: Server, deps: Deps) {
  server.registerTool(
    "luw_studio_open",
    {
      title: "Open a Luw Studio project in the conversation",
      description:
        "Opens one of the user's Luw Studio projects as the live 3D editor inside the conversation: the user sees it, turns it and edits it by hand, and every scene tool's change shows in it within a few seconds. Open a project once: the open editor follows the later edits by itself, so calling this again for the same project only opens a second editor.",
      inputSchema: { project_id: projectId.describe("The project (luw_studio_list_projects, or one just created).") },
      annotations: { title: "Open project", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        ...VIEW_META,
        "openai/toolInvocation/invoking": "Opening the project in Luw Studio…",
        "openai/toolInvocation/invoked": "Luw Studio project open",
      },
    },
    handler(deps, async (a, ctx) => {
      const project = await describeProject(ctx, projectNumber(a.project_id));
      return {
        content: [
          {
            type: "text",
            text:
              `The user now sees "${project.name}" open in Luw Studio in the view above and can edit it there by hand. ` +
              "What the scene tools change shows in it by itself within a few seconds: don't open the project again, and reply in text only, with no image or link for it.",
          },
        ],
        structuredContent: { project_id: project.project_id, name: project.name, ...(project.cover ? { cover: project.cover } : {}), studio_url: project.studio_url },
        _meta: { [SHOWN_AT]: Date.now() },
      };
    }),
  );

  // The view's own tool: the model neither sees nor calls it. Luw.ai makes the session from the API key
  // this server holds for the user; it lasts an hour and signs Studio's editor requests and nothing else.
  server.registerTool(
    "luw_studio_session",
    {
      title: "Sign the Luw Studio view in",
      description: "Used by the Luw Studio view itself to sign in and to stay signed in. Not for the assistant.",
      inputSchema: {},
      annotations: { title: "Sign the view in", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] }, "openai/widgetAccessible": true, "openai/visibility": "private" },
    },
    handler(deps, async (_a, ctx) => {
      const body = await ctx.client
        .request<{ session?: FrameSession; expires_in?: number }>("POST", "/studio_frame_session", { signal: ctx.signal, retry: false })
        .catch((error: unknown) => {
          // Luw.ai turns the editor view on per account (its STUDIO_FRAME_SESSION): off answers 404.
          if (error instanceof LuwApiError && error.httpStatus === 404) throw new InputError("The editor inside the conversation isn't on for this Luw.ai account yet.");
          throw error;
        });
      const s = body.session;
      if (typeof s?.t !== "string" || typeof s.a !== "string") throw new LuwApiError("Luw.ai didn't return a session for the Studio view.");
      return {
        content: [{ type: "text", text: "The Luw Studio view is signed in." }],
        _meta: { [SESSION]: { t: s.t, s: String(s.s ?? ""), a: s.a, p: String(s.p ?? "") }, [EXPIRES_IN]: Number(body.expires_in) || 3600 },
      };
    }),
  );

  server.registerTool(
    "luw_studio_show_shared",
    {
      title: "Show a shared Luw Studio project in 3D",
      description:
        "Shows a shared Luw Studio project in 3D inside the conversation: the user can turn it, zoom and open it full screen. Takes a share link (https://studio.luw.ai/s/…), as Luw Studio's Share window and its Explore pages give. View only; the user's own projects open with luw_studio_open.",
      inputSchema: { share_url: z.string().min(8).max(300).describe("The project's share link, https://studio.luw.ai/s/…") },
      annotations: { title: "Show shared project", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: {
        ...VIEW_META,
        "openai/toolInvocation/invoking": "Opening the project in 3D…",
        "openai/toolInvocation/invoked": "Luw Studio project open",
      },
    },
    handler<{ share_url: string }>(deps, async (a, ctx) => {
      const token = shareToken(a.share_url);
      if (!token) throw new InputError("share_url must be a Luw Studio share link: https://studio.luw.ai/s/…");
      // Without the scene (`lite`): the view loads it itself; this only says the link is on and names the project.
      const response = await ctx.fetch(`${ctx.config.baseUrl}/studio_shares/${token}?lite=1`, { signal: ctx.signal });
      const body = response.ok ? ((await response.json().catch(() => null)) as { status?: boolean; project?: SharedProject } | null) : null;
      if (!body?.status || !body.project) throw new InputError("This share link is off or wrong. The project's owner turns it on in Luw Studio's Share window.");
      const project = body.project;
      const name = project.name || "Untitled";
      const shown = {
        token,
        name,
        ...(project.owner ? { owner: project.owner } : {}),
        ...(project.cover ? { cover: project.cover } : {}),
        ...(project.explore?.description ? { description: project.explore.description } : {}),
        share_url: `${STUDIO_URL}/s/${token}`,
      };
      return {
        content: [
          {
            type: "text",
            text:
              `The user now sees "${name}"${project.owner ? ` by ${project.owner}` : ""} in 3D in the Luw Studio view above, and can turn it, zoom and open it full screen. ` +
              `Reply in text only: no image or link for it.${shown.description ? `\nAbout the project: ${shown.description}` : ""}`,
          },
        ],
        structuredContent: shown,
        // For the view alone: a result this old is a conversation read back, and its view opens resting.
        _meta: { [SHOWN_AT]: Date.now() },
      };
    }),
  );

  server.registerResource(
    "studio-view",
    STUDIO_VIEW_URI,
    { title: "Luw Studio view", description: "A Luw Studio project in the conversation: the user's own as the live editor, a shared one in 3D.", mimeType: "text/html;profile=mcp-app" },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/html;profile=mcp-app",
          text: VIEW_HTML,
          _meta: {
            // The view frames Studio's pages and loads one picture, the project's cover.
            ui: { prefersBorder: true, domain: "https://mcp.luw.ai", csp: { connectDomains: [], resourceDomains: [COVERS_URL], frameDomains: [STUDIO_URL] } },
            // ChatGPT's own names for the same things.
            "openai/widgetCSP": { connect_domains: [], resource_domains: [COVERS_URL], frame_domains: [STUDIO_URL] },
            "openai/ui": { availableDisplayModes: ["inline", "fullscreen"] },
            "openai/widgetDescription":
              "Luw Studio in the conversation: the user's project as the live 3D editor, which shows the scene tools' changes by itself, or a shared project in 3D. No need to describe how to open it.",
          },
        },
      ],
    }),
  );
}

// Plain JS with no dependencies, template literals or backslashes, so it can live in this string as is.
const VIEW_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
/* One color scheme at a time, matching the host's theme: a scheme the host doesn't use paints the frame opaque. */
:root { color-scheme: light; --fg: #1d1d1f; --muted: #6e6e73; --line: rgba(0,0,0,.12); --chip: rgba(0,0,0,.05); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
:root[data-theme="dark"] { color-scheme: dark; --fg: #f2f2f2; --muted: #a1a1a6; --line: rgba(255,255,255,.16); --chip: rgba(255,255,255,.07); }
* { box-sizing: border-box; }
html, body { overflow: hidden; }
body { margin: 0; color: var(--fg); background: transparent; }
#app { padding: 4px; display: flex; flex-direction: column; }
.stage { position: relative; width: 100%; aspect-ratio: 16 / 10; min-height: 260px; border-radius: 12px; overflow: hidden; background: var(--chip); }
.stage iframe, .stage img { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; object-fit: cover; }
/* Resting: the project's cover in place of the live 3D, which one click brings back. */
.stage.rest { cursor: pointer; }
.over { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 10px; max-width: 86%; text-align: center; }
.wake { border: 0; background: #fff; color: #1d1d1f; border-radius: 999px; padding: 9px 18px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 14px rgba(0,0,0,.28); }
.why { background: rgba(0,0,0,.62); color: #fff; border-radius: 10px; padding: 7px 12px; font-size: 12px; }
/* Full screen: the host gives the whole window; the project takes all of it but the bar. */
:root[data-mode="fullscreen"], :root[data-mode="fullscreen"] body { height: 100%; }
:root[data-mode="fullscreen"] #app { height: 100vh; }
:root[data-mode="fullscreen"] .stage { flex: 1; aspect-ratio: auto; min-height: 0; }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; flex: none; }
.title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.title span { color: var(--muted); font-weight: 500; }
.actions { display: flex; gap: 6px; flex: none; }
.btn { border: 1px solid var(--line); background: transparent; color: var(--fg); border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.btn:hover { background: var(--chip); }
.note { display: flex; gap: 10px; align-items: center; padding: 14px; border-radius: 12px; background: var(--chip); }
.stage .note { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: transparent; white-space: nowrap; }
.spin { width: 16px; height: 16px; flex: none; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--fg); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div id="app"></div>
<script>
(function () {
  var STUDIO = "https://studio.luw.ai";
  var COVERS = "https://i.luvicdn.com/";
  var app = document.getElementById("app");
  // What the view holds: a shared project ({ token }) or one of the user's as the editor ({ projectId }).
  var shown = null;
  var mode = "inline";
  var modeButton = null;
  var pending = {};
  var nextId = 1;

  // Live 3D is heavy, so one view at a time runs it. The others rest: the project's cover and a button.
  // A view rests when a newer one opens, after REST_AFTER off the screen, and from the start when the conversation
  // is read back later. The host tells a view none of this, so the views tell each other and watch the screen themselves.
  var REST_AFTER = 30000;
  var FRESH_FOR = 300000;
  var me = String(Math.random()).slice(2);
  var awake = false;
  var restTimer = null;
  var channel = null;

  // The editor's frame and its session. The session is short; the view gets the next one before it ends.
  var frame = null;
  var session = null;
  var problem = "";
  var renewTimer = null;
  var renewing = false;
  var bridged = Promise.resolve(false);
  var RENEW_BEFORE = 300;
  // Studio asks for a session when a request of its own is refused; one it asks for again and again is not
  // one a new session cures, so those asks are answered this far apart at most.
  var ASKED_APART = 60000;
  var askedAt = 0;
  // Studio's editor says it is up within seconds. A host whose view Studio doesn't take as a parent (its
  // frame mode names them) shows a refused or silent frame: after this long without a word, say so.
  var READY_WITHIN = 30000;
  var readyTimer = null;

  try {
    channel = new BroadcastChannel("luw-studio-view");
    channel.onmessage = function (event) {
      if (!event.data || !event.data.awake || event.data.awake === me || !awake) return;
      // The one the user has full screen stays, and the newer one rests.
      if (mode === "fullscreen") channel.postMessage({ awake: me }); else rest();
    };
  } catch (e) {}

  function post(message) { window.parent.postMessage(message, "*"); }
  function request(method, params, wait) {
    var id = nextId++;
    post({ jsonrpc: "2.0", id: id, method: method, params: params });
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error("timeout")); } }, wait || 8000);
    });
  }

  // The view's own tool on the server (luw_studio_session): the result's _meta is the view's alone.
  // Asked over the MCP Apps bridge, which hands the result back whole; a host without it has ChatGPT's own call.
  function askSession() {
    return bridged.then(function (yes) {
      if (yes || !(window.openai && window.openai.callTool)) return request("tools/call", { name: "luw_studio_session", arguments: {} }, 45000);
      return window.openai.callTool("luw_studio_session", {});
    }).then(function (result) {
      var meta = (result && (result._meta || result.meta)) || {};
      var given = meta["luw/session"];
      if (!given || typeof given.t !== "string" || typeof given.a !== "string") {
        var said = result && result.content && result.content[0] && result.content[0].text;
        throw new Error(result && result.isError && said ? said : "Luw Studio couldn't sign in here.");
      }
      return { session: { t: given.t, s: String(given.s || ""), a: given.a, p: String(given.p || "") }, expiresIn: Number(meta["luw/expiresIn"]) || 3600 };
    });
  }

  function toStudio(message) {
    if (!frame || !frame.contentWindow) return;
    message.source = "luw-archigpt";
    message.v = 1;
    frame.contentWindow.postMessage(message, STUDIO);
  }

  function renewIn(seconds) {
    clearTimeout(renewTimer);
    renewTimer = setTimeout(renew, Math.max(30, seconds) * 1000);
  }

  // The next session, handed to the open editor: its project stays open.
  function renew() {
    if (renewing || !awake || !shown || !shown.projectId) return;
    renewing = true;
    askSession().then(function (got) {
      renewing = false;
      session = got.session;
      toStudio({ type: "session", session: session });
      renewIn(got.expiresIn - RENEW_BEFORE);
    }).catch(function () {
      renewing = false;
      renewIn(60);
    });
  }

  function wake() {
    awake = true;
    problem = "";
    if (channel) channel.postMessage({ awake: me });
    if (!shown || !shown.projectId) return render();
    // The editor signs in first: its frame opens once the session is here.
    session = null;
    render();
    askSession().then(function (got) {
      if (!awake) return;
      session = got.session;
      renewIn(got.expiresIn - RENEW_BEFORE);
      render();
    }).catch(function (error) {
      if (!awake) return;
      awake = false;
      problem = (error && error.message) || "Luw Studio couldn't sign in here.";
      render();
    });
  }

  function rest() {
    if (!awake || mode === "fullscreen") return;
    awake = false;
    clearTimeout(renewTimer);
    clearTimeout(readyTimer);
    render();
  }

  function notReady() {
    if (!awake || !shown || !shown.projectId) return;
    awake = false;
    clearTimeout(renewTimer);
    problem = "Luw Studio can't open inside this app. Open it in Luw Studio with the button below.";
    render();
  }

  function applyTheme(theme) {
    var dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    for (var key in attrs || {}) {
      if (key === "class") node.className = attrs[key];
      else if (key === "text") node.textContent = attrs[key];
      else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2), attrs[key]);
      else node.setAttribute(key, attrs[key]);
    }
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  var lastHeight = 0;
  function reportSize() {
    requestAnimationFrame(function () {
      // In full screen the host sizes the frame; a height reported from there would stick when it closes.
      if (mode === "fullscreen") return;
      var height = Math.ceil(document.documentElement.getBoundingClientRect().height);
      if (height === lastHeight) return;
      lastHeight = height;
      post({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { width: document.documentElement.clientWidth, height: height } });
      if (window.openai && window.openai.notifyIntrinsicHeight) window.openai.notifyIntrinsicHeight(height);
    });
  }
  if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.body);

  function setMode(next) {
    if (next !== "inline" && next !== "fullscreen") return;
    mode = next;
    lastHeight = 0;
    document.documentElement.setAttribute("data-mode", mode);
    if (modeButton) modeButton.textContent = mode === "fullscreen" ? "Close full screen" : "Full screen";
    reportSize();
  }

  function toggleMode() {
    var want = mode === "fullscreen" ? "inline" : "fullscreen";
    if (want === "fullscreen" && !awake) wake();
    var asked = window.openai && window.openai.requestDisplayMode
      ? window.openai.requestDisplayMode({ mode: want })
      : request("ui/request-display-mode", { mode: want });
    Promise.resolve(asked).then(function (answer) { setMode((answer && answer.mode) || want); }).catch(function () {});
  }

  function openLink(url) {
    if (window.openai && window.openai.openExternal) { window.openai.openExternal({ href: url }); return; }
    request("ui/open-link", { url: url }).catch(function () { window.open(url, "_blank", "noopener"); });
  }

  function stage() {
    frame = null;
    if (!awake) {
      return el("div", { class: "stage rest", onclick: wake }, [
        shown.cover ? el("img", { src: shown.cover, alt: "" }) : null,
        el("div", { class: "over" }, [
          problem ? el("div", { class: "why", text: problem }) : null,
          el("button", { class: "wake", text: problem ? "Try again" : shown.projectId ? "Open the editor" : "Open in 3D" }),
        ]),
      ]);
    }
    if (shown.projectId && !session) {
      return el("div", { class: "stage" }, [el("div", { class: "note" }, [el("span", { class: "spin" }), el("span", { text: "Opening Luw Studio…" })])]);
    }
    // Only Studio's own pages are ever framed: its share page, or its editor in frame mode.
    var src = shown.projectId ? STUDIO + "/?frame=1" : STUDIO + "/s/" + shown.token + "?embed=1&clean=1";
    frame = el("iframe", { src: src, title: shown.name, allow: "fullscreen; xr-spatial-tracking; clipboard-write", loading: "eager" });
    clearTimeout(readyTimer);
    if (shown.projectId) readyTimer = setTimeout(notReady, READY_WITHIN);
    return el("div", { class: "stage" }, [frame]);
  }

  function render() {
    app.textContent = "";
    modeButton = null;
    if (!shown) {
      app.appendChild(el("div", { class: "note" }, [el("span", { class: "spin" }), el("span", { text: "Opening Luw Studio…" })]));
      return reportSize();
    }
    var title = el("div", { class: "title", text: shown.name });
    if (shown.owner) title.appendChild(el("span", { text: " · " + shown.owner }));
    modeButton = el("button", { class: "btn", text: "Full screen", onclick: toggleMode });
    app.appendChild(stage());
    app.appendChild(el("div", { class: "bar" }, [
      title,
      el("div", { class: "actions" }, [modeButton, el("button", { class: "btn", text: "Open in Luw Studio ↗", onclick: function () { openLink(shown.link); } })]),
    ]));
    setMode(mode);
  }

  // The token or the project's number alone picks the page: nothing but a page of Studio's is ever framed.
  function show(result, meta) {
    if (!result) return;
    var token = typeof result.token === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(result.token) ? result.token : "";
    var projectId = !token && Number.isInteger(result.project_id) && result.project_id > 0 ? result.project_id : 0;
    if (!token && !projectId) return;
    if (shown && shown.token === token && shown.projectId === projectId) return;
    shown = {
      token: token,
      projectId: projectId,
      name: typeof result.name === "string" && result.name ? result.name : "Luw Studio project",
      owner: typeof result.owner === "string" ? result.owner : "",
      cover: typeof result.cover === "string" && result.cover.indexOf(COVERS) === 0 ? result.cover : "",
      link: token ? STUDIO + "/s/" + token : STUDIO + "/?project=" + projectId,
    };
    var at = meta ? Number(meta["luw/shownAt"]) : 0;
    if (at && Date.now() - at > FRESH_FOR) render(); else wake();
  }

  if (window.IntersectionObserver) {
    new IntersectionObserver(function (entries) {
      clearTimeout(restTimer);
      if (!entries[entries.length - 1].isIntersecting) restTimer = setTimeout(rest, REST_AFTER);
    }).observe(app);
  }

  // Studio's editor in the frame (luw/frame/chat-frame.ts): it says it is up, and the view answers with who
  // the user is and which project is theirs to open. Heard from Studio's own page only.
  function fromStudio(event) {
    var message = event.data;
    if (event.origin !== STUDIO || !message || message.source !== "luw-studio" || message.v !== 1) return;
    if (message.type === "ready") clearTimeout(readyTimer);
    if (message.type === "ready" && session) toStudio({ type: "hello", session: session, projectId: shown.projectId });
    if (message.type === "expired" && Date.now() - askedAt > ASKED_APART) { askedAt = Date.now(); renew(); }
    if (message.type === "missing") {
      awake = false;
      clearTimeout(renewTimer);
      clearTimeout(readyTimer);
      problem = "This project can't be opened here: it was deleted, or it is another account's.";
      render();
    }
  }

  window.addEventListener("message", function (event) {
    if (frame && event.source === frame.contentWindow) return fromStudio(event);
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.id !== undefined && pending[message.id]) {
      var waiter = pending[message.id];
      delete pending[message.id];
      if (message.error) waiter.reject(message.error); else waiter.resolve(message.result);
      return;
    }
    var params = message.params || {};
    if (message.method === "ui/notifications/tool-result") show(params.structuredContent, params._meta);
    // The host is closing the view: answer, so it doesn't wait.
    if (message.method === "ui/resource-teardown" && message.id !== undefined) post({ jsonrpc: "2.0", id: message.id, result: {} });
    if (message.method === "ui/notifications/host-context-changed") {
      if (params.theme) applyTheme(params.theme);
      if (params.displayMode) setMode(params.displayMode);
    }
  });

  applyTheme(window.openai && window.openai.theme);
  render();

  // MCP Apps handshake; the host sends the tool result after it. It resolves to whether the host answered.
  bridged = request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "Luw Studio view", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
  }, 4000).then(function (init) {
    var context = (init && init.hostContext) || {};
    if (context.theme) applyTheme(context.theme);
    if (context.displayMode) setMode(context.displayMode);
    post({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    return true;
  }).catch(function () { return false; });

  // ChatGPT also exposes the result and its display mode directly.
  if (window.openai) {
    if (window.openai.displayMode) setMode(window.openai.displayMode);
    if (window.openai.toolOutput) show(window.openai.toolOutput, window.openai.toolResponseMetadata);
    window.addEventListener("openai:set_globals", function (event) {
      var globals = (event.detail && event.detail.globals) || {};
      if (globals.theme) applyTheme(globals.theme);
      if (globals.displayMode) setMode(globals.displayMode);
      if (globals.toolOutput) show(globals.toolOutput, globals.toolResponseMetadata || window.openai.toolResponseMetadata);
    });
  }
})();
</script>
</body>
</html>
`;
