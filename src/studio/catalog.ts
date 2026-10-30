import type { AssetInput } from "@pascal-app/core";
import { type AssetViewLoader, createAssetViewLoader, createFetchAssetViewIO } from "@pascal-app/core/agent-operations";
import { MCP_CATALOG_ITEMS } from "@pascal-app/mcp/tools/asset-catalog";
import { STUDIO_URL } from "../config.js";

// The items search_assets, place_items and furnish_room place: Luw Studio's own catalog (Pascal's
// library plus Luw's pieces), served by Studio at /api/catalog. Paths in it ("/items/…") are Studio's,
// so a placed item opens in Studio exactly as one placed there. When Studio can't be reached, Pascal's
// built-in starter list and Luw's pieces stand in.

const TTL_MS = 60 * 60 * 1000;

/** Luw's pieces Pascal lacks (Studio's luw/models/luw-catalog.ts). */
const LUW_ITEMS: AssetInput[] = [
  {
    id: "luw-vanity-single",
    category: "bathroom",
    name: "Single Vanity",
    tags: ["sink", "basin", "washbasin", "lavatory", "vanity", "single", "small", "cabinet", "bathroom", "plumbing", "white", "wood"],
    thumbnail: "/items/luw/luw-vanity-single/thumbnail.webp",
    src: "/items/luw/luw-vanity-single/model.glb",
    dimensions: [0.6, 0.95, 0.46],
    offset: [0.0012, 0.4762, -0.001],
    rotation: [0, 0, 0],
    scale: [0.413, 0.5029, 0.4359],
  },
  {
    id: "luw-vanity-compact",
    category: "bathroom",
    name: "Compact Hand Basin",
    tags: ["sink", "basin", "washbasin", "lavatory", "hand basin", "cloakroom", "wc", "guest", "compact", "small", "narrow", "vanity", "bathroom", "plumbing"],
    thumbnail: "/items/luw/luw-vanity-compact/thumbnail.webp",
    src: "/items/luw/luw-vanity-compact/model.glb",
    dimensions: [0.45, 0.88, 0.32],
    offset: [-0.002, 0.4406, 0.0009],
    rotation: [0, 0, 0],
    scale: [0.3733, 0.463, 0.3901],
  },
  {
    id: "luw-bathtub-compact",
    category: "bathroom",
    name: "Compact Bathtub",
    tags: ["bathtub", "bath", "tub", "compact", "small", "built-in", "bathroom", "plumbing"],
    thumbnail: "/items/luw/luw-bathtub-compact/thumbnail.webp",
    src: "/items/luw/luw-bathtub-compact/model.glb",
    dimensions: [1.6, 0.72, 0.7],
    offset: [-0.0029, 0.3656, 0.0034],
    rotation: [0, 0, 0],
    scale: [0.8435, 0.8415, 0.7314],
  },
];

export const FALLBACK_CATALOG: readonly AssetInput[] = [...MCP_CATALOG_ITEMS, ...LUW_ITEMS];

let cached: { url: string; at: number; items: readonly AssetInput[] } | null = null;

function isAsset(value: unknown): value is AssetInput {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.src === "string" && Array.isArray(item.dimensions);
}

/** Studio's catalog, fetched at most hourly; the fallback when it can't be read. */
export async function loadCatalog(url: string, fetchImpl: typeof fetch): Promise<readonly AssetInput[]> {
  if (!url) return FALLBACK_CATALOG;
  if (cached && cached.url === url && Date.now() - cached.at < TTL_MS) return cached.items;
  try {
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { items?: unknown };
    const items = Array.isArray(body.items) ? body.items.filter(isAsset) : [];
    if (items.length === 0) throw new Error("no items");
    cached = { url, at: Date.now(), items };
    return items;
  } catch {
    // Retry after a minute rather than on every call while Studio is unreachable.
    cached = { url, at: Date.now() - TTL_MS + 60_000, items: FALLBACK_CATALOG };
    return FALLBACK_CATALOG;
  }
}

/**
 * What view_assets and paint read of a catalog piece (its pictures, size and paintable surfaces): its
 * model and pictures, fetched as Pascal's server does, Studio's own links ("/items/…") from Studio.
 */
export function studioAssetViews(catalogUrl: string, fetchImpl: typeof fetch): AssetViewLoader {
  const base = catalogUrl || STUDIO_URL;
  return createAssetViewLoader(createFetchAssetViewIO({ fetchImpl, resolveUrl: async (url) => new URL(url, base).href }));
}
