// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const FREESTANDING_VANITY = 'bath-space:freestanding-vanity'
export const WALL_MOUNTED_VANITY = 'bath-space:wall-mounted-vanity'
export const CORNER_VANITY = 'bath-space:corner-vanity'
export const StorageBay = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  kind: z.enum(['drawers', 'doors', 'open']).default('drawers'),
  widthWeight: z.number().min(0.5).max(2).default(1),
  drawerHeights: z.array(z.number().min(0.5).max(2)).min(1).max(4).default([1, 1]),
  doorCount: z.number().int().min(1).max(2).default(1),
  shelves: z.number().int().min(0).max(3).default(1),
})
export type StorageBay = z.infer<typeof StorageBay>

export const VanityParameters = z.object({
  width: z.number().min(0.55).max(1.8).default(0.9),
  height: z.number().min(0.55).max(1.1).default(0.82),
  depth: z.number().min(0.35).max(0.75).default(0.48),
  storageLayout: z
    .enum(['drawers', 'doors', 'mixed', 'drawer-left', 'drawer-right', 'console', 'custom'])
    .default('drawers'),
  storageBays: z
    .array(StorageBay)
    .max(3)
    .refine(
      (bays) => new Set(bays.map((bay) => bay.id)).size === bays.length,
      'Storage section IDs must be unique',
    )
    .default([]),
  mountingHeight: z.number().min(0.1).max(0.4).default(0.3),
  drawerRows: z.number().int().min(1).max(4).default(2),
  drawerColumns: z.number().int().min(1).max(3).default(1),
  doorCount: z.number().int().min(1).max(4).default(2),
  drawerType: z.preprocess(
    (value) => (value === 'plumbing' ? 'standard' : value),
    z.enum(['standard', 'shallow-top']).default('shallow-top'),
  ),
  drawerOpen: z.number().min(0).max(1).default(0),
  doorOpen: z.number().min(0).max(110).default(0),
  interiorShelves: z.number().int().min(0).max(3).default(1),
  frontStyle: z.enum(['flat', 'shaker', 'fluted']).default('shaker'),
  frontMount: z.enum(['overlay', 'inset']).default('overlay'),
  panelThickness: z.number().min(0.012).max(0.03).default(0.018),
  frontGap: z.number().min(0.002).max(0.012).default(0.004),
  frameWidth: z.number().min(0.025).max(0.08).default(0.045),
  fluteSpacing: z.number().min(0.012).max(0.035).default(0.02),
  handleStyle: z.enum(['bar', 'knob', 'edge', 'none']).default('bar'),
  handleLength: z.number().min(0.06).max(0.3).default(0.16),
  baseStyle: z.enum(['square', 'tapered', 'metal', 'plinth']).default('tapered'),
  legHeight: z.number().min(0.06).max(0.3).default(0.16),
  legWidth: z.number().min(0.025).max(0.075).default(0.045),
  legInset: z.number().min(0).max(0.06).default(0.02),
  lowerShelf: z.boolean().default(false),
  countertopEnabled: z.boolean().default(true),
  countertopThickness: z.number().min(0.015).max(0.06).default(0.025),
  countertopOverhang: z.number().min(0).max(0.05).default(0.015),
  countertopEdge: z.enum(['square', 'soft']).default('soft'),
  backsplashHeight: z.number().min(0).max(0.2).default(0),
})

export type VanityParameters = z.infer<typeof VanityParameters>

export const FreestandingVanityNode = BaseNode.extend({
  supportSlabId: z.string().optional(),
  id: objectId('bath-space-vanity'),
  children: z.array(z.string()).default([]),
  type: nodeType('bath-space:freestanding-vanity'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),
  ...VanityParameters.shape,
  slots: z.record(z.string(), z.string()).optional(),
  partOpenings: z.record(z.string(), z.number().min(0).max(1.25)).default({}),
})

export type FreestandingVanityNode = z.infer<typeof FreestandingVanityNode>

export const WallMountedVanityNode = FreestandingVanityNode.extend({
  id: objectId('bath-space-wall-vanity'),
  type: nodeType(WALL_MOUNTED_VANITY),
  wallId: z.string().nullable().default(null),
  side: z.enum(['front', 'back']).default('front'),
})
export type WallMountedVanityNode = z.infer<typeof WallMountedVanityNode>
export const CornerVanityNode = FreestandingVanityNode.extend({
  id: objectId('bath-space-corner-vanity'),
  type: nodeType(CORNER_VANITY),
  width: z.number().min(0.55).max(1.2).default(0.7),
  storageLayout: z.literal('doors').default('doors'),
  doorCount: z.number().int().min(1).max(2).default(2),
  baseStyle: z.literal('plinth').default('plinth'),
  legHeight: z.number().min(0.06).max(0.3).default(0.1),
  countertopOverhang: z.number().min(0).max(0.05).default(0.015),
})
export type CornerVanityNode = z.infer<typeof CornerVanityNode>
export const VanityNode = z.union([FreestandingVanityNode, WallMountedVanityNode, CornerVanityNode])
export type VanityNode = z.infer<typeof VanityNode>
export const isVanityKind = (kind: string) =>
  kind === FREESTANDING_VANITY || kind === WALL_MOUNTED_VANITY || kind === CORNER_VANITY
