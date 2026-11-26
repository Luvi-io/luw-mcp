import { describe, expect, it } from "vitest";
import { shareToken, STUDIO_VIEW_URI } from "../src/studio/view.js";
import { connect, fakeLuw, textOf } from "./helpers.js";

const STUDIO = { mode: "remote" as const, toolsets: new Set(["studio" as const]), studioView: true };
const VIEW_TOOLS = ["luw_studio_open", "luw_studio_session", "luw_studio_show_shared"];

const lakeHouse = {
  persona: { id: 42, name: "Lake house", profession: "Studio", trainings: [{ id: 5, slot: 8, image: "https://i.luvicdn.com/c.jpg", extras: "{}" }] },
};

describe("Luw Studio view", () => {
  it("is the hosted Studio server's, and off until it is turned on", async () => {
    const names = async (overrides: Parameters<typeof connect>[1]) => (await (await connect(fakeLuw().fetch, overrides)).client.listTools()).tools.map((t) => t.name);

    expect((await names(STUDIO)).filter((n) => VIEW_TOOLS.includes(n)).sort()).toEqual([...VIEW_TOOLS].sort());
    expect((await names({ ...STUDIO, studioView: false })).filter((n) => VIEW_TOOLS.includes(n))).toEqual([]);
    expect((await names({ toolsets: new Set(["studio" as const]), studioView: true })).filter((n) => VIEW_TOOLS.includes(n))).toEqual([]);
    expect((await names({ mode: "remote", studioView: true })).filter((n) => VIEW_TOOLS.includes(n))).toEqual([]);
  });

  it("opens a project of the user's as the editor", async () => {
    const luw = fakeLuw().on("GET", "/personas/42", () => lakeHouse);
    const { client, call } = await connect(luw.fetch, STUDIO);

    const tool = (await client.listTools()).tools.find((t) => t.name === "luw_studio_open")!;
    expect((tool._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri).toBe(STUDIO_VIEW_URI);
    expect(tool._meta?.["openai/outputTemplate"]).toBe(STUDIO_VIEW_URI);

    const result = await call("luw_studio_open", { project_id: "luw-42" });
    expect(result.structuredContent).toEqual({ project_id: 42, name: "Lake house", cover: "https://i.luvicdn.com/c.jpg", studio_url: "https://studio.luw.ai/?project=42" });
    expect(textOf(result)).toContain('"Lake house" open in Luw Studio');
    expect(textOf(result)).toContain("don't open the project again");
    // The view reads the result's age from here, to open resting when the conversation is read back.
    expect(Math.abs(Date.now() - Number(result._meta?.["luw/shownAt"]))).toBeLessThan(60_000);
  });

  it("opens Studio projects only", async () => {
    const luw = fakeLuw().on("GET", "/personas/43", () => ({ persona: { id: 43, name: "A chat persona", profession: "Architect" } }));
    const { call } = await connect(luw.fetch, STUDIO);
    const result = await call("luw_studio_open", { project_id: 43 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No Luw Studio project 43");
  });

  it("signs the view in with a session made from the user's key, for the view alone", async () => {
    const luw = fakeLuw().on("POST", "/studio_frame_session", () => ({ status: true, session: { t: "sf_token", s: "salt", a: "user-token", p: 7 }, expires_in: 3590 }));
    const { client, call } = await connect(luw.fetch, STUDIO);

    const tool = (await client.listTools()).tools.find((t) => t.name === "luw_studio_session")!;
    // The model neither sees nor calls it.
    expect((tool._meta as { ui?: { visibility?: string[] } }).ui?.visibility).toEqual(["app"]);
    expect(tool._meta?.["openai/visibility"]).toBe("private");
    expect(tool._meta?.["openai/widgetAccessible"]).toBe(true);

    const result = await call("luw_studio_session", {});
    expect(result._meta?.["luw/session"]).toEqual({ t: "sf_token", s: "salt", a: "user-token", p: "7" });
    expect(result._meta?.["luw/expiresIn"]).toBe(3590);
    // Nothing of the session where the model reads.
    expect(JSON.stringify([result.content, result.structuredContent ?? null])).not.toMatch(/sf_token|user-token|salt/);
    expect(luw.calls[0]!.headers.get("authorization")).toBe("Bearer test-key");
    expect(luw.calls).toHaveLength(1);
  });

  it("says so when Luw.ai hasn't turned the editor view on for the account", async () => {
    const luw = fakeLuw().on("POST", "/studio_frame_session", () => new Response('{"status":false}', { status: 404 }));
    const { call } = await connect(luw.fetch, STUDIO);
    const result = await call("luw_studio_session", {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("isn't on for this Luw.ai account yet");
    expect(result._meta?.["luw/session"]).toBeUndefined();
  });

  it("reads the token from a Studio share link and from nothing else", () => {
    expect(shareToken("https://studio.luw.ai/s/7TD2oO5XzeB_ERRV")).toBe("7TD2oO5XzeB_ERRV");
    expect(shareToken(" https://studio.luw.ai/s/7TD2oO5XzeB_ERRV?embed=1&clean=1 ")).toBe("7TD2oO5XzeB_ERRV");
    expect(shareToken("7TD2oO5XzeB_ERRV")).toBe("7TD2oO5XzeB_ERRV");
    expect(shareToken("https://evil.example/s/7TD2oO5XzeB_ERRV")).toBeNull();
    expect(shareToken("https://studio.luw.ai/project/12")).toBeNull();
    expect(shareToken("https://studio.luw.ai/s/short")).toBeNull();
    expect(shareToken("https://studio.luw.ai/s/7TD2oO5XzeB_ERRV/../../project/12")).toBeNull();
  });

  it("shows a shared project in the view", async () => {
    const luw = fakeLuw().on("GET", "/studio_shares/7TD2oO5XzeB_ERRV", () => ({ status: true, project: { name: "Lake house", owner: "saGoLa", cover: "https://i.luvicdn.com/c.jpg" } }));
    const { client, call } = await connect(luw.fetch, STUDIO);

    const tool = (await client.listTools()).tools.find((t) => t.name === "luw_studio_show_shared")!;
    expect((tool._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri).toBe(STUDIO_VIEW_URI);

    const result = await call("luw_studio_show_shared", { share_url: "https://studio.luw.ai/s/7TD2oO5XzeB_ERRV" });
    expect(result.structuredContent).toEqual({
      token: "7TD2oO5XzeB_ERRV",
      name: "Lake house",
      owner: "saGoLa",
      cover: "https://i.luvicdn.com/c.jpg",
      share_url: "https://studio.luw.ai/s/7TD2oO5XzeB_ERRV",
    });
    expect(textOf(result)).toContain('"Lake house" by saGoLa');
    expect(Math.abs(Date.now() - Number(result._meta?.["luw/shownAt"]))).toBeLessThan(60_000);
    // The scene stays out of the call: the view loads it.
    expect(luw.calls[0]!.url.searchParams.get("lite")).toBe("1");
  });

  it("says so when the link is off or isn't a share link, and asks the API nothing for the second", async () => {
    const luw = fakeLuw().on("GET", "/studio_shares/7TD2oO5XzeB_ERRV", () => new Response("{}", { status: 404 }));
    const { call } = await connect(luw.fetch, STUDIO);

    const off = await call("luw_studio_show_shared", { share_url: "https://studio.luw.ai/s/7TD2oO5XzeB_ERRV" });
    expect(off.isError).toBe(true);
    expect(textOf(off)).toContain("off or wrong");

    const other = await call("luw_studio_show_shared", { share_url: "https://example.com/some/page" });
    expect(other.isError).toBe(true);
    expect(luw.calls).toHaveLength(1);
  });

  it("serves a view that may frame Studio, load a cover and nothing else", async () => {
    const { client } = await connect(fakeLuw().fetch, STUDIO);
    const [content] = (await client.readResource({ uri: STUDIO_VIEW_URI })).contents as unknown as [{ mimeType: string; text: string; _meta: any }];
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content._meta.ui.csp).toEqual({ connectDomains: [], resourceDomains: ["https://i.luvicdn.com"], frameDomains: ["https://studio.luw.ai"] });
    expect(content._meta["openai/widgetCSP"]).toEqual({ connect_domains: [], resource_domains: ["https://i.luvicdn.com"], frame_domains: ["https://studio.luw.ai"] });

    // The script lives in a TypeScript template string: make sure it is still valid JavaScript.
    const script = /<script>([\s\S]*)<\/script>/.exec(content.text)![1]!;
    expect(() => new Function(script)).not.toThrow();
    // Studio's two pages, and nothing else, go in the frame.
    expect(script).toContain('STUDIO + "/?frame=1" : STUDIO + "/s/" + shown.token + "?embed=1&clean=1"');
    // The editor's session goes to Studio's own page only, in the words its frame mode speaks.
    expect(script).toContain("frame.contentWindow.postMessage(message, STUDIO)");
    expect(script).toContain('message.source = "luw-archigpt"');
    expect(script).toContain('"luw_studio_session"');
    expect(script).toContain("ui/request-display-mode");
    // One view at a time runs the live 3D; the others show the cover.
    expect(script).toContain('new BroadcastChannel("luw-studio-view")');
    expect(script).toContain('meta["luw/shownAt"]');
  });
});
