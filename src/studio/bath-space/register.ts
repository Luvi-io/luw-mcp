// Bath Space's fixtures as kinds this server knows: Luw Studio's bathroom_add (in the vendored @pascal-app/nodes)
// makes each with its kind's schema and defaults from the registry, and refuses plugin_not_installed without
// them. Only the schemas (vendor/, from scripts/vendor-bath-space.mjs) and the plugin's own defaults (a
// fixture parsed with its name); Luw Studio, where Bath Space is installed, draws and edits them.
import { type AnyNodeDefinition, nodeRegistry, registerNode } from "@pascal-app/core";
import type { z } from "zod";
import { BATHTUB, BathtubNode } from "./vendor/bathtub/schema.js";
import { COUNTERTOP_BASIN, CountertopBasinNode } from "./vendor/countertop-basin/schema.js";
import { FLOOR_STANDING_TOILET, FloorStandingToiletNode } from "./vendor/floor-standing-toilet/schema.js";
import { WALL_FLUSH_PLATE, WallFlushPlateNode } from "./vendor/flush-control/schema.js";
import { WALL_MOUNTED_VANITY, WallMountedVanityNode } from "./vendor/freestanding-vanity/schema.js";
import { HAND_SHOWER, HandShowerNode } from "./vendor/hand-shower/schema.js";
import { MIRROR, MirrorNode } from "./vendor/mirror/schema.js";
import { SHOWER_ARM, ShowerArmNode } from "./vendor/shower-arm/schema.js";
import { SHOWER_CONTROL, ShowerControlNode } from "./vendor/shower-control/schema.js";
import { SHOWER_DIVIDER, ShowerDividerNode } from "./vendor/shower-divider/schema.js";
import { SHOWER_HEAD, ShowerHeadNode } from "./vendor/shower-head/schema.js";
import { SHOWER_HOSE, ShowerHoseNode } from "./vendor/shower-hose/schema.js";
import { SHOWER_MOUNT, ShowerMountNode } from "./vendor/shower-mount/schema.js";
import { TAP, TapNode } from "./vendor/taps/schema.js";
import { TOILET_PAPER_HOLDER, ToiletPaperHolderNode } from "./vendor/toilet-paper-holder/schema.js";
import { TOWEL_RAIL, TowelRailNode } from "./vendor/towel-rail/schema.js";
import { WALL_HUNG_TOILET, WallHungToiletNode } from "./vendor/wall-hung-toilet/schema.js";

// Each kind, its schema and the name its definition gives a new one.
const FIXTURES: [string, z.ZodType<{ id?: unknown; type?: unknown }>, string][] = [
  [BATHTUB, BathtubNode, "Freestanding Bath"],
  [COUNTERTOP_BASIN, CountertopBasinNode, "Countertop Basin"],
  [FLOOR_STANDING_TOILET, FloorStandingToiletNode, "Floor standing toilet"],
  [WALL_FLUSH_PLATE, WallFlushPlateNode, "Wall flush plate"],
  [WALL_MOUNTED_VANITY, WallMountedVanityNode, "Wall-mounted Vanity"],
  [HAND_SHOWER, HandShowerNode, "Hand shower"],
  [MIRROR, MirrorNode, "Bathroom mirror"],
  [SHOWER_ARM, ShowerArmNode, "Shower arm"],
  [SHOWER_CONTROL, ShowerControlNode, "Shower control"],
  [SHOWER_DIVIDER, ShowerDividerNode, "Shower divider"],
  [SHOWER_HEAD, ShowerHeadNode, "Shower head"],
  [SHOWER_HOSE, ShowerHoseNode, "Shower hose"],
  [SHOWER_MOUNT, ShowerMountNode, "Shower mounting fitting"],
  [TAP, TapNode, "Tap"],
  [TOILET_PAPER_HOLDER, ToiletPaperHolderNode, "Toilet paper holder"],
  [TOWEL_RAIL, TowelRailNode, "Towel rail"],
  [WALL_HUNG_TOILET, WallHungToiletNode, "Wall hung toilet"],
];

export const BATH_SPACE_KINDS = FIXTURES.map(([kind]) => kind);

/** Registers Bath Space's fixtures once (a kind already there, as in Luw Studio, is kept). */
export function registerBathSpace(): void {
  for (const [kind, schema, name] of FIXTURES) {
    if (nodeRegistry.has(kind)) continue;
    registerNode({
      kind,
      schemaVersion: 1,
      schema,
      category: "furnish",
      defaults: () => {
        const { id: _id, type: _type, ...rest } = schema.parse({ name });
        return rest;
      },
      capabilities: {},
    } as unknown as AnyNodeDefinition);
  }
}
