import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "./context.js";
import { GENERATE_TOOL_NAMES } from "./tools/generate.js";

/** Bump the version on breaking changes: hosts cache templates by URI. */
export const RESULT_VIEWER_URI = "ui://luw/result-viewer-v1.html";

// Tools whose results the viewer renders: every generation, and collecting a long-running one.
const VIEWER_TOOLS = new Set<string>([...GENERATE_TOOL_NAMES, "luw_get_result"]);

// Where Luw.ai results, uploads and previews live; the viewer loads nothing else.
const RESOURCE_DOMAINS = ["https://i.luvicdn.com", "https://img.luvicdn.com", "https://luvicdn.com", "https://luvicdn.net", "https://fal.media", "https://v3.fal.media", "https://v3b.fal.media"];

type ToolSpec = { _meta?: Record<string, unknown> };
type Callback = (args: Record<string, unknown>, extra: unknown) => unknown;

// Without this the model also tries to show the result in its reply: an image link renders as a broken image,
// and a host's own image tool makes a different picture that isn't the Luw.ai result.
const VIEWER_NOTE =
  "The user already sees this result in the Luw.ai viewer above, with a before/after comparison and a full-size link, so the reply needs no image of it.";

/**
 * Links a tool to the result viewer. ChatGPT doesn't show images a tool returns (only the model sees them)
 * and won't render image links the model writes, so without a viewer users see a broken image.
 */
export function withResultViewer<T extends ToolSpec>(name: string, tool: T, cb: Callback): [T, Callback] {
  if (!VIEWER_TOOLS.has(name)) return [tool, cb];
  const spec = {
    ...tool,
    _meta: {
      ...tool._meta,
      ui: { resourceUri: RESULT_VIEWER_URI },
      "openai/outputTemplate": RESULT_VIEWER_URI,
      "openai/toolInvocation/invoking": "Working on it with Luw.ai…",
      "openai/toolInvocation/invoked": "Luw.ai result ready",
    },
  };
  const call: Callback = async (args, extra) => {
    const result = (await cb(args, extra)) as CallToolResult;
    const status = result.structuredContent?.status;
    const [first, ...rest] = result.content ?? [];
    if ((status !== "completed" && status !== "partial") || first?.type !== "text") return result;
    return { ...result, content: [{ ...first, text: `${VIEWER_NOTE}\n${first.text}` }, ...rest] };
  };
  return [spec, call];
}

/** The MCP Apps view (ChatGPT, Claude and other hosts) that shows a Luw.ai result in the conversation. */
export function registerResultViewer(server: Server) {
  server.registerResource(
    "result-viewer",
    RESULT_VIEWER_URI,
    { title: "Luw.ai result viewer", description: "Shows a Luw.ai result in the conversation.", mimeType: "text/html;profile=mcp-app" },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/html;profile=mcp-app",
          text: VIEWER_HTML,
          _meta: {
            ui: { prefersBorder: true, domain: "https://mcp.luw.ai", csp: { connectDomains: [], resourceDomains: RESOURCE_DOMAINS } },
            "openai/widgetDescription":
              "Shows the Luw.ai result: a before/after slider for edited photos, a tiled preview for textures, a player for videos, and a link to the full-size file. No need to repeat the links.",
          },
        },
      ],
    }),
  );
}

// Plain JS with no dependencies or template literals, so it can live in this string as is.
const VIEWER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
/* One color scheme at a time, matching the host's theme: a scheme the host doesn't use paints the frame opaque. */
:root { color-scheme: light; --fg: #1d1d1f; --muted: #6e6e73; --line: rgba(0,0,0,.12); --chip: rgba(0,0,0,.05); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
:root[data-theme="dark"] { color-scheme: dark; --fg: #f2f2f2; --muted: #a1a1a6; --line: rgba(255,255,255,.16); --chip: rgba(255,255,255,.07); }
* { box-sizing: border-box; }
/* The host sizes the frame to the reported height; a scrollbar would narrow the content and change that height. */
html, body { overflow: hidden; }
body { margin: 0; color: var(--fg); background: transparent; }
#app { padding: 4px; }
.frame { position: relative; width: 100%; border-radius: 12px; overflow: hidden; background: var(--chip); }
.compare { aspect-ratio: 4 / 3; touch-action: pan-y; cursor: ew-resize; user-select: none; -webkit-user-select: none; --pos: 50%; }
.compare img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.compare img.before { clip-path: inset(0 calc(100% - var(--pos)) 0 0); }
.handle { position: absolute; top: 0; bottom: 0; left: var(--pos); width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 6px rgba(0,0,0,.45); pointer-events: none; }
.handle span { position: absolute; top: 50%; left: 50%; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.35); display: grid; place-items: center; }
.handle svg { width: 18px; height: 18px; stroke: #1d1d1f; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.tag { position: absolute; top: 10px; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #fff; background: rgba(0,0,0,.5); pointer-events: none; }
.tag.left { left: 10px; } .tag.right { right: 10px; }
.single { display: block; width: 100%; height: auto; }
video { display: block; width: 100%; background: #000; }
.tile { aspect-ratio: 16 / 9; background-repeat: repeat; background-size: 33.34%; }
.card { display: flex; gap: 12px; align-items: center; padding: 12px; }
.card img { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; flex: none; }
.card b { display: block; }
.card span { color: var(--muted); font-size: 13px; }
.thumbs { display: flex; gap: 6px; margin-top: 8px; overflow-x: auto; }
.thumbs button { padding: 0; width: 60px; height: 60px; flex: none; border: 2px solid transparent; border-radius: 8px; overflow: hidden; background: var(--chip); cursor: pointer; }
.thumbs button[aria-current="true"] { border-color: var(--fg); }
.thumbs img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
.brand { font-size: 12px; font-weight: 600; color: var(--muted); }
.btn { border: 1px solid var(--line); background: transparent; color: var(--fg); border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
.btn:hover { background: var(--chip); }
.note { display: flex; gap: 10px; align-items: center; padding: 14px; border-radius: 12px; background: var(--chip); }
.spin { width: 16px; height: 16px; flex: none; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--fg); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.masks { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.masks figure { margin: 0; }
.masks img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; background: var(--chip); display: block; }
.masks figcaption { font-size: 12px; color: var(--muted); margin-top: 4px; }
</style>
</head>
<body>
<div id="app"></div>
<script>
(function () {
  var app = document.getElementById("app");
  var state = { result: null, index: 0 };
  var pending = {};
  var nextId = 1;

  function post(message) { window.parent.postMessage(message, "*"); }
  function request(method, params) {
    var id = nextId++;
    post({ jsonrpc: "2.0", id: id, method: method, params: params });
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error("timeout")); } }, 8000);
    });
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

  function isUrl(value) { return typeof value === "string" && /^https:\\/\\//i.test(value); }
  function kind(url) {
    var path = url.split("?")[0].toLowerCase();
    if (/\\.(mp4|webm|mov)$/.test(path)) return "video";
    if (/\\.(glb|gltf|usdz)$/.test(path)) return "model";
    return "image";
  }
  // Large PNGs load fast as JPEG previews from the resizing CDN; the original stays one click away.
  function preview(url) {
    var match = /^https:\\/\\/[a-z0-9.-]*luvicdn\\.com(\\/luwai\\/[^?#]+)/i.exec(url);
    return match ? "https://luvicdn.net/img" + match[1] + "?w=1200&fm=jpg&q=85" : url;
  }

  function openLink(url) {
    if (window.openai && window.openai.openExternal) { window.openai.openExternal({ href: url }); return; }
    request("ui/open-link", { url: url }).catch(function () { window.open(url, "_blank", "noopener"); });
  }

  var lastHeight = 0;
  function reportSize() {
    requestAnimationFrame(function () {
      var height = Math.ceil(document.documentElement.getBoundingClientRect().height);
      if (height === lastHeight) return;
      lastHeight = height;
      post({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { width: document.documentElement.clientWidth, height: height } });
      if (window.openai && window.openai.notifyIntrinsicHeight) window.openai.notifyIntrinsicHeight(height);
    });
  }
  if (window.ResizeObserver) new ResizeObserver(reportSize).observe(document.body);

  function image(url, cls) {
    var node = el("img", { src: preview(url), alt: "", class: cls || "", draggable: "false" });
    node.addEventListener("load", reportSize);
    return node;
  }

  function note(text, busy) {
    return el("div", { class: "note" }, [busy ? el("span", { class: "spin" }) : null, el("span", { text: text })]);
  }

  function single(url) { return el("div", { class: "frame" }, [image(url, "single")]); }

  function compare(before, after) {
    var box = el("div", { class: "frame compare" });
    var afterImg = image(after);
    var beforeImg = image(before, "before");
    var handle = el("div", { class: "handle" }, [el("span")]);
    handle.firstChild.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6"/></svg>';
    box.appendChild(afterImg);
    box.appendChild(beforeImg);
    box.appendChild(handle);
    box.appendChild(el("span", { class: "tag left", text: "Before" }));
    box.appendChild(el("span", { class: "tag right", text: "After" }));

    var auto = true;
    var started = performance.now();
    function set(percent) { box.style.setProperty("--pos", Math.max(0, Math.min(100, percent)) + "%"); }
    function follow(event) { var rect = box.getBoundingClientRect(); set(((event.clientX - rect.left) / rect.width) * 100); }
    box.addEventListener("pointerdown", function (event) { auto = false; box.setPointerCapture(event.pointerId); follow(event); });
    box.addEventListener("pointermove", function (event) { if (event.pointerType === "mouse" || event.buttons) { auto = false; follow(event); } });
    // A short sweep shows there is a slider, like the comparison on luw.ai; any interaction stops it.
    function sweep(now) {
      if (!auto || !box.isConnected) return;
      var t = now - started;
      if (t > 5200) { set(50); return; }
      set(50 + 28 * Math.sin(t / 650));
      requestAnimationFrame(sweep);
    }
    afterImg.addEventListener("load", function () {
      if (afterImg.naturalWidth) box.style.aspectRatio = afterImg.naturalWidth + " / " + afterImg.naturalHeight;
      requestAnimationFrame(sweep);
    });
    // An input the viewer can't load (a link it isn't allowed to fetch, an expired upload): show the result alone.
    beforeImg.addEventListener("error", function () { if (box.isConnected) box.replaceWith(single(after)); reportSize(); });
    set(50);
    return box;
  }

  function media(url, result) {
    var type = kind(url);
    if (type === "video") {
      var attrs = { src: url, controls: "", playsinline: "", muted: "", loop: "", autoplay: "", preload: "metadata" };
      if (isUrl(result.source)) attrs.poster = preview(result.source);
      var video = el("video", attrs);
      video.muted = true;
      video.addEventListener("loadedmetadata", reportSize);
      return el("div", { class: "frame" }, [video]);
    }
    if (type === "model") {
      return el("div", { class: "frame card" }, [
        isUrl(result.source) ? image(result.source) : null,
        el("div", {}, [el("b", { text: "3D model ready" }), el("span", { text: "GLB file, opens in any 3D viewer" })]),
      ]);
    }
    if (result.tile) {
      var tile = el("div", { class: "frame tile" });
      tile.style.backgroundImage = "url(" + JSON.stringify(preview(url)) + ")";
      return tile;
    }
    if (isUrl(result.source) && kind(result.source) === "image" && result.source !== url) return compare(result.source, url);
    return single(url);
  }

  function render() {
    var result = state.result;
    app.textContent = "";
    if (!result) { app.appendChild(note("Working on it with Luw.ai…", true)); return reportSize(); }
    if (result.status === "processing") {
      app.appendChild(note("Still processing. Videos and 3D models take a few minutes; the result appears here once it's collected.", true));
      return reportSize();
    }
    var outputs = (result.outputs || []).filter(isUrl);
    var masks = (result.masks || []).filter(function (mask) { return mask && isUrl(mask.url); });
    if (!outputs.length && !masks.length) {
      var reason = (result.errors && result.errors.join(" ")) || result.text || "Luw.ai returned no result.";
      app.appendChild(note(reason, false));
      return reportSize();
    }
    if (!outputs.length) {
      app.appendChild(el("div", { class: "masks" }, masks.map(function (mask) {
        return el("figure", {}, [image(mask.url), el("figcaption", { text: mask.label || "Mask" })]);
      })));
      return reportSize();
    }

    var index = Math.min(state.index, outputs.length - 1);
    var current = outputs[index];
    app.appendChild(media(current, result));
    if (outputs.length > 1) {
      app.appendChild(el("div", { class: "thumbs" }, outputs.map(function (url, i) {
        var thumb = kind(url) === "image" ? image(url) : el("span", { text: kind(url) === "video" ? "Video" : "3D" });
        return el("button", { "aria-label": "Result " + (i + 1), "aria-current": String(i === index), onclick: function () { state.index = i; render(); } }, [thumb]);
      })));
    }
    var label = kind(current) === "model" ? "Download 3D model" : kind(current) === "video" ? "Open video" : "Open full size";
    app.appendChild(el("div", { class: "bar" }, [
      el("span", { class: "brand", text: "Luw.ai" }),
      el("button", { class: "btn", text: label + " ↗", onclick: function () { openLink(current); } }),
    ]));
    reportSize();
  }

  function show(result) {
    if (!result || typeof result !== "object") return;
    state.result = result;
    state.index = 0;
    render();
  }

  window.addEventListener("message", function (event) {
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
    if (message.method === "ui/notifications/tool-result") show(params.structuredContent);
    if (message.method === "ui/notifications/host-context-changed" && params.theme) applyTheme(params.theme);
  });

  applyTheme(window.openai && window.openai.theme);
  render();

  // MCP Apps handshake; the host sends the tool input and result after it.
  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "Luw.ai result viewer", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline"] },
  }).then(function (init) {
    if (init && init.hostContext && init.hostContext.theme) applyTheme(init.hostContext.theme);
    post({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
  }).catch(function () {});

  // ChatGPT also exposes the result directly.
  if (window.openai) {
    if (window.openai.toolOutput) show(window.openai.toolOutput);
    window.addEventListener("openai:set_globals", function (event) {
      var globals = (event.detail && event.detail.globals) || {};
      if (globals.theme) applyTheme(globals.theme);
      if (globals.toolOutput) show(globals.toolOutput);
    });
  }
})();
</script>
</body>
</html>
`;
