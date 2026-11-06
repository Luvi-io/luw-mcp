// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

export const COUNTERTOP_BASIN = 'bath-space:countertop-basin'
export const UNDERMOUNT_BASIN = 'bath-space:undermount-basin'
export const DROP_IN_BASIN = 'bath-space:drop-in-basin'
export const HALF_PEDESTAL_BASIN = 'bath-space:half-pedestal-basin'
export const FULL_PEDESTAL_BASIN = 'bath-space:full-pedestal-basin'
export const WALL_HUNG_BASIN = 'bath-space:wall-hung-basin'
export const SEMI_RECESSED_BASIN = 'bath-space:semi-recessed-basin'
export const BasinParameters = z.object({
  shape: z.enum(['round', 'oval', 'rectangle']).default('oval'),
  width: z.number().finite().max(0.8).default(0.5),
  depth: z.number().finite().max(0.55).default(0.38),
  height: z.number().min(0.08).max(0.22).default(0.14),
  wallThickness: z.number().min(0.005).max(0.025).default(0.012),
  taper: z.number().min(0).max(0.4).default(0.22),
  drainDiameter: z.number().min(0.035).max(0.05).default(0.045),
  drainCover: z.boolean().default(true),
})
export const CountertopBasinNode = BaseNode.extend({
  supportSlabId: z.string().optional(),
  id: objectId('bath-space-basin'),
  type: nodeType(COUNTERTOP_BASIN),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.number().default(0),
  flangeWidth: z.number().min(0.01).max(0.04).default(0.02),
  children: z.array(z.string()).default([]),
  // Omitted targets follow bowl dimensions until an attached tap is moved.
  tapMountingLayout: z.enum(['single-hole', 'three-hole']).default('single-hole'),
  tapHoleSpacing: z.number().min(0.1).max(0.4).default(0.2),
  tapSlotCount: z.union([z.literal(1), z.literal(3)]).default(1),
  tapSlots: z
    .array(
      z.object({
        id: z.string().min(1),
        position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
        rotation: z.number().finite().default(0),
      }),
    )
    .refine(
      (slots) => new Set(slots.map((slot) => slot.id)).size === slots.length,
      'Slot IDs must be unique',
    )
    .default([]),
  tapTarget: z
    .object({
      position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
      rotation: z.number().finite().default(0),
    })
    .optional(),
  ...BasinParameters.shape,
  slots: z.record(z.string(), z.string()).optional(),
})
export type CountertopBasinNode = z.infer<typeof CountertopBasinNode>
export const UndermountBasinNode = CountertopBasinNode.extend({
  id: objectId('bath-space-undermount-basin'),
  type: nodeType(UNDERMOUNT_BASIN),
  height: BasinParameters.shape.height.default(0.18),
})
export type UndermountBasinNode = z.infer<typeof UndermountBasinNode>
export const DropInBasinNode = CountertopBasinNode.extend({
  id: objectId('bath-space-drop-in-basin'),
  type: nodeType(DROP_IN_BASIN),
  height: BasinParameters.shape.height.default(0.18),
  rimHeight: z.number().min(0.004).max(0.02).default(0.008),
})
export type DropInBasinNode = z.infer<typeof DropInBasinNode>
export const SemiRecessedBasinNode = CountertopBasinNode.extend({
  id: objectId('bath-space-semi-recessed-basin'),
  type: nodeType(SEMI_RECESSED_BASIN),
  shape: BasinParameters.shape.shape.default('rectangle'),
  width: BasinParameters.shape.width.default(0.55),
  depth: BasinParameters.shape.depth.default(0.43),
  taper: BasinParameters.shape.taper.default(0.08),
  height: z.number().min(0.12).max(0.22).default(0.18),
  recessDepth: z.number().min(0.03).max(0.1).default(0.08),
  frontProjection: z.number().min(0.04).max(0.18).default(0.1),
})
export type SemiRecessedBasinNode = z.infer<typeof SemiRecessedBasinNode>
export const WallHungBasinNode = CountertopBasinNode.extend({
  id: objectId('bath-space-wall-hung-basin'),
  type: nodeType(WALL_HUNG_BASIN),
  wallDesign: z.enum(['sculpted', 'shallow', 'classic', 'box']).default('box'),
  plumbingStyle: z.enum(['concealed', 'bottle', 'p-trap', 'flexible']).default('bottle'),
  plumbingEnabled: z.boolean().default(true),
  plumbingDrop: z.number().min(0.12).max(0.4).default(0.24),
  overflowEnabled: z.boolean().default(true),
  wallId: z.string().nullable().default(null),
  side: z.enum(['front', 'back']).default('front'),
  shape: BasinParameters.shape.shape.default('rectangle'),
  width: z.number().min(0.45).max(0.8).default(0.6),
  depth: z.number().min(0.42).max(0.55).default(0.46),
  position: z.tuple([z.number(), z.number().finite(), z.number()]).default([0, 0.85, 0]),
})
export type WallHungBasinNode = z.infer<typeof WallHungBasinNode>
export const FullPedestalBasinNode = WallHungBasinNode.extend({
  id: objectId('bath-space-full-pedestal-basin'),
  type: nodeType(FULL_PEDESTAL_BASIN),
  pedestalDesign: z.enum(['classic', 'square', 'monobloc']).default('classic'),
  totalHeight: z.number().min(0.7).max(0.95).default(0.85),
  pedestalWidth: z.number().min(0.14).max(0.3).default(0.18),
  pedestalDepth: z.number().min(0.14).max(0.3).default(0.2),
  plumbingEnabled: z.boolean().default(false),
  shape: BasinParameters.shape.shape.default('oval'),
  wallDesign: WallHungBasinNode.shape.wallDesign.default('classic'),
  width: WallHungBasinNode.shape.width.default(0.55),
  height: BasinParameters.shape.height.default(0.16),
})
export type FullPedestalBasinNode = z.infer<typeof FullPedestalBasinNode>
export const HalfPedestalBasinNode = WallHungBasinNode.extend({
  id: objectId('bath-space-half-pedestal-basin'),
  type: nodeType(HALF_PEDESTAL_BASIN),
  shroudDesign: z.enum(['curved', 'square', 'integrated']).default('curved'),
  shroudHeight: z.number().min(0.12).max(0.38).default(0.26),
  shroudWidth: z.number().min(0.18).max(0.38).default(0.28),
  shroudDepth: z.number().min(0.18).max(0.4).default(0.3),
  plumbingEnabled: z.boolean().default(false),
  shape: BasinParameters.shape.shape.default('oval'),
  wallDesign: WallHungBasinNode.shape.wallDesign.default('classic'),
  width: WallHungBasinNode.shape.width.default(0.55),
  height: BasinParameters.shape.height.default(0.14),
})
export type HalfPedestalBasinNode = z.infer<typeof HalfPedestalBasinNode>
export type WallSupportedBasinNode =
  | WallHungBasinNode
  | FullPedestalBasinNode
  | HalfPedestalBasinNode
export const halfPedestalBasinPresets = [
  {
    shroudDesign: 'curved',
    label: 'Classic half pedestal',
    description: 'Curved bowl with a rounded short shroud',
    shape: 'oval',
    wallDesign: 'classic',
    width: 0.55,
    depth: 0.46,
    height: 0.14,
    taper: 0.22,
    shroudHeight: 0.26,
    shroudWidth: 0.28,
    shroudDepth: 0.3,
  },
  {
    shroudDesign: 'square',
    label: 'Square half pedestal',
    description: 'Rectangular bowl and compact square shroud',
    shape: 'rectangle',
    wallDesign: 'shallow',
    width: 0.58,
    depth: 0.46,
    height: 0.13,
    taper: 0.12,
    shroudHeight: 0.24,
    shroudWidth: 0.28,
    shroudDepth: 0.3,
  },
  {
    shroudDesign: 'integrated',
    label: 'Integrated tapered shroud',
    description: 'Broad bowl flowing into a tapered ceramic body',
    shape: 'round',
    wallDesign: 'sculpted',
    width: 0.52,
    depth: 0.46,
    height: 0.16,
    taper: 0.14,
    shroudHeight: 0.3,
    shroudWidth: 0.32,
    shroudDepth: 0.32,
  },
] as const
export const fullPedestalBasinPresets = [
  {
    pedestalDesign: 'classic',
    label: 'Classic full pedestal',
    description: 'Curved bowl and flared round column',
    shape: 'oval',
    wallDesign: 'classic',
    width: 0.55,
    depth: 0.46,
    height: 0.16,
    taper: 0.22,
    pedestalWidth: 0.18,
    pedestalDepth: 0.2,
  },
  {
    pedestalDesign: 'square',
    label: 'Square full pedestal',
    description: 'Soft rectangular bowl and square column',
    shape: 'rectangle',
    wallDesign: 'shallow',
    width: 0.58,
    depth: 0.46,
    height: 0.15,
    taper: 0.12,
    pedestalWidth: 0.2,
    pedestalDepth: 0.22,
  },
  {
    pedestalDesign: 'monobloc',
    label: 'Tapered monobloc',
    description: 'Tall continuous ceramic body',
    shape: 'round',
    wallDesign: 'sculpted',
    width: 0.5,
    depth: 0.46,
    height: 0.18,
    taper: 0.14,
    pedestalWidth: 0.24,
    pedestalDepth: 0.26,
  },
] as const
export const wallHungBasinPresets = [
  {
    wallDesign: 'sculpted',
    thumbnail: new URL('../wall-hung-basin/assets/sculpted.webp', import.meta.url).href,
    label: 'Sculpted shroud',
    description: 'Flared bowl, concealed waste',
    shape: 'rectangle',
    width: 0.58,
    depth: 0.48,
    height: 0.17,
    taper: 0.28,
    plumbingStyle: 'concealed',
    plumbingDrop: 0.24,
  },
  {
    wallDesign: 'shallow',
    thumbnail: new URL('../wall-hung-basin/assets/shallow.webp', import.meta.url).href,
    label: 'Slim rectangle',
    description: 'Soft rim, chrome bottle trap',
    shape: 'rectangle',
    width: 0.58,
    depth: 0.44,
    height: 0.095,
    taper: 0.08,
    plumbingStyle: 'bottle',
    plumbingDrop: 0.22,
  },
  {
    wallDesign: 'classic',
    thumbnail: new URL('../wall-hung-basin/assets/classic.webp', import.meta.url).href,
    label: 'Classic curved',
    description: 'Rounded front, curved waste trap',
    shape: 'oval',
    width: 0.55,
    depth: 0.46,
    height: 0.12,
    taper: 0.2,
    plumbingStyle: 'p-trap',
    plumbingDrop: 0.25,
  },
  {
    wallDesign: 'box',
    thumbnail: new URL('../wall-hung-basin/assets/box.webp', import.meta.url).href,
    label: 'Deep box',
    description: 'Straight apron, flexible waste',
    shape: 'rectangle',
    width: 0.6,
    depth: 0.46,
    height: 0.18,
    taper: 0.03,
    plumbingStyle: 'flexible',
    plumbingDrop: 0.24,
  },
] as const

export const BasinNode = z.union([
  CountertopBasinNode,
  UndermountBasinNode,
  DropInBasinNode,
  SemiRecessedBasinNode,
  WallHungBasinNode,
  FullPedestalBasinNode,
  HalfPedestalBasinNode,
])
export type BasinNode = z.infer<typeof BasinNode>
export function isInsetBasinKind(type: string) {
  return type === UNDERMOUNT_BASIN || type === DROP_IN_BASIN || type === SEMI_RECESSED_BASIN
}
export function isBasinKind(type: string) {
  return (
    type === HALF_PEDESTAL_BASIN ||
    type === FULL_PEDESTAL_BASIN ||
    type === WALL_HUNG_BASIN ||
    type === COUNTERTOP_BASIN ||
    isInsetBasinKind(type)
  )
}
export const semiRecessedBasinPresets = [
  {
    shape: 'round',
    label: 'Round-front compact',
    width: 0.46,
    depth: 0.46,
    height: 0.16,
    taper: 0.18,
  },
  { shape: 'oval', label: 'Soft oval apron', width: 0.56, depth: 0.45, height: 0.165, taper: 0.16 },
  {
    shape: 'rectangle',
    label: 'Rectangular apron',
    width: 0.55,
    depth: 0.43,
    height: 0.16,
    taper: 0.08,
  },
] as const
export const basinPresets = [
  { shape: 'round', label: 'Round', width: 0.4, depth: 0.4, height: 0.15, taper: 0.3 },
  { shape: 'oval', label: 'Oval', width: 0.5, depth: 0.38, height: 0.14, taper: 0.22 },
  {
    shape: 'rectangle',
    label: 'Rounded rectangle',
    width: 0.55,
    depth: 0.38,
    height: 0.12,
    taper: 0.08,
  },
] as const
export function basinDepth(node: BasinNode) {
  return node.type !== HALF_PEDESTAL_BASIN &&
    node.type !== FULL_PEDESTAL_BASIN &&
    node.type !== WALL_HUNG_BASIN &&
    node.shape === 'round'
    ? node.width
    : node.depth
}

export function basinTapMaximumHoleSpacing(node: BasinNode) {
  const deck =
    node.type === SEMI_RECESSED_BASIN ||
    node.type === WALL_HUNG_BASIN ||
    node.type === FULL_PEDESTAL_BASIN ||
    node.type === HALF_PEDESTAL_BASIN
  return Math.min(0.4, deck ? node.width * 0.55 : node.width - 0.12)
}
