import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expect, it } from "vitest";
import { connect, fakeLuw } from "./helpers.js";

async function read(client: Client, uri: string): Promise<string> {
  const { contents } = await client.readResource({ uri });
  return (contents[0] as { text: string }).text;
}

async function uris(client: Client): Promise<string[]> {
  return (await client.listResources()).resources.map((r) => r.uri);
}

describe("resources", () => {
  it("lists the account, guide, catalogs, per-app history and the user's projects", async () => {
    const luw = fakeLuw().on("GET", "/boards", () => ({ status: true, boards: [{ id: 7, name: "Villa Ada", media_count: 12, folders_count: 2 }] }));
    const { client } = await connect(luw.fetch);

    const listed = await uris(client);
    expect(listed).toEqual(
      expect.arrayContaining(["luw://account", "luw://guide", "luw://catalog/design_styles", "luw://history/Interior", "luw://history/Video", "luw://projects/7"]),
    );
    expect(listed).not.toContain("luw://history/ArchiGPT");
    const templates = (await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate);
    expect(templates.sort()).toEqual(["luw://catalog/{kind}", "luw://history/{app}", "luw://projects/{id}"]);
  });

  it("still lists everything else when projects can't be loaded", async () => {
    const { client } = await connect(fakeLuw().fetch, { apiKey: "" });
    const listed = await uris(client);
    expect(listed).toContain("luw://account");
    expect(listed).toContain("luw://history/Interior");
    expect(listed.some((u) => u.startsWith("luw://projects/"))).toBe(false);
  });

  it("follows LUW_TOOLSETS", async () => {
    const { client } = await connect(fakeLuw().fetch, {}, { LUW_TOOLSETS: "archigpt" });
    expect((await uris(client)).sort()).toEqual(["luw://account", "luw://guide"]);
  });

  it("reads the credit balance", async () => {
    const luw = fakeLuw().on("GET", "/credits", () => ({ status: true, credits: { purchased: 500, used: 380, available: 120 }, subscription: "ai_plan_m2" }));
    const { client } = await connect(luw.fetch);
    const text = await read(client, "luw://account");
    expect(text).toContain("Credits available: 120");
    expect(text).toContain("Credits used: 380 of 500");
    expect(text).toContain("Subscription: active");
  });

  it("shows an app's recent projects with their finished results, newest first", async () => {
    const luw = fakeLuw().on("GET", "/personas/ft-Interior", () => ({
      status: true,
      personas: [
        {
          id: 11,
          name: "Salon",
          updated_at: "2026-10-08T10:00:00Z",
          generations: [
            { id: 1, created_at: "2026-10-01T09:00:00Z", data: JSON.stringify({ prompt: "warm", image: "https://cdn.test/room.jpg", final_url: "https://cdn.test/old.png" }) },
            // Same precedence as the web app: the uploaded file first; `data` may be encoded twice.
            { id: 2, created_at: "2026-10-07T09:00:00Z", upload_result: { final_url: "https://cdn.test/new.png" }, data: JSON.stringify(JSON.stringify({ prompt: "japandi" })) },
            { id: 3, created_at: "2026-10-08T09:00:00Z", temp: true, data: "{}" },
            { id: 4, created_at: "2026-10-08T09:30:00Z", upload_status: "failed", data: JSON.stringify({ final_url: "https://cdn.test/broken.png" }) },
          ],
        },
        { id: 12, name: "Nothing yet", generations: [] },
      ],
    }));
    const { client } = await connect(luw.fetch);

    const text = await read(client, "luw://history/interior");
    const call = luw.calls.find((c) => c.url.pathname.endsWith("/personas/ft-Interior"))!;
    expect(Object.fromEntries(call.url.searchParams)).toEqual({ provider: "luw", page: "1", limit: "10" });
    expect(text).toContain("## Salon (project 11, updated 2026-10-08)");
    expect(text).toContain('- 2026-10-07: https://cdn.test/new.png · prompt: "japandi"');
    expect(text).toContain('- 2026-10-01: https://cdn.test/old.png · prompt: "warm" · source: https://cdn.test/room.jpg');
    expect(text.indexOf("new.png")).toBeLessThan(text.indexOf("old.png"));
    expect(text).not.toContain("broken.png");
    expect(text).not.toContain("Nothing yet");
  });

  it("says so when an app has no results, and rejects unknown apps", async () => {
    const luw = fakeLuw().on("GET", "/personas/ft-Video", () => ({ status: true, personas: [] }));
    const { client } = await connect(luw.fetch);
    expect(await read(client, "luw://history/Video")).toContain("No finished Video results yet.");
    await expect(client.readResource({ uri: "luw://history/Nope" })).rejects.toThrow(/Unknown Luw.ai app "Nope"/);
  });

  it("lists a project's items with the real file behind each thumbnail", async () => {
    const luw = fakeLuw().on("GET", "/boards/7", () => ({
      status: true,
      board: {
        id: 7,
        name: "Villa Ada",
        folders: [{ id: 3, name: "Facade" }],
        media: [
          { id: 2, url: "https://cdn.test/upload.jpg", control_image: "https://cdn.test/src.jpg", created_at: "2026-10-01T00:00:00Z" },
          {
            id: 1,
            url: "https://cdn.test/poster.jpg",
            folder_id: 3,
            created_at: "2026-10-02T00:00:00Z",
            extras: JSON.stringify({ upload_result: { final_url: "https://cdn.test/fly.mp4" } }),
          },
        ],
      },
    }));
    const { client } = await connect(luw.fetch);

    const text = await read(client, "luw://projects/7");
    expect(text).toContain("# Villa Ada");
    expect(text).toContain("2 items in 1 folders: Facade.");
    expect(text).toContain('- https://cdn.test/fly.mp4 · folder "Facade"\n- https://cdn.test/upload.jpg (source: https://cdn.test/src.jpg)');
    expect(text).not.toContain("poster.jpg");
  });

  it("serves catalogs from the same lookup as luw_list_options, with previews", async () => {
    const luw = fakeLuw().on("GET", "/styles", () => [{ name: "Scandinavian", description: "Light and calm", thumb_image: "https://cdn.test/s.jpg" }]);
    const { client } = await connect(luw.fetch);
    expect(await read(client, "luw://catalog/design_styles")).toContain("Scandinavian: Light and calm (https://cdn.test/s.jpg)");
  });

  it("guides through every registered tool, costs included", async () => {
    const { client } = await connect(fakeLuw().fetch);
    const text = await read(client, "luw://guide");
    for (const tool of (await client.listTools()).tools) expect(text).toContain(`(\`${tool.name}\`)`);
    expect(text).toContain("Costs 10 credits");
  });
});
