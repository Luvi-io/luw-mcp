// Vendored from @pascal-app/plugin-bath-space 0.1.0 (MIT, github:sudhir9297/pascal-cluster#357338ddb7e042498fca7b6e6ee2054edbeb70b7) by scripts/vendor-bath-space.mjs.
// Do not edit: run the script again.
import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'
export const WALL_FLUSH_PLATE = 'bath-space:wall-flush-plate'
export const CISTERN_FLUSH_CONTROL = 'bath-space:cistern-flush-control'
const length = (min: number, max: number, value: number) =>
  z.number().finite().min(min).max(max).default(value)
const common = {
  position: z
    .tuple([z.number().finite(), z.number().finite(), z.number().finite()])
    .default([0, 1, 0]),
  rotation: z.number().finite().default(0),
  children: z.array(z.string()).default([]),
  shape: z
    .enum(['rectangle', 'rounded', 'square', 'round', 'oval'])
    .default('rounded'),
  buttonShape: z.enum(['round', 'rectangle', 'oval']).default('round'),
  flushMode: z.enum(['single', 'dual', 'touchless']).default('dual'),
  width: length(0.03, 0.35, 0.24),
  height: length(0.03, 0.25, 0.16),
  thickness: length(0.003, 0.03, 0.012),
  buttonSize: length(0.012, 0.08, 0.045),
  edgeRadius: length(0.0003, 0.004, 0.0015),
  seamWidth: length(0.0003, 0.002, 0.0008),
  buttonProjection: length(0.002, 0.015, 0.005),
  slots: z.record(z.string(), z.string()).optional(),
}
export const WallFlushPlateNode = BaseNode.extend({
  ...common,
  id: objectId('bath-space-flush-plate'),
  type: nodeType(WALL_FLUSH_PLATE),
  wallId: z.string().nullable().default(null),
  side: z.enum(['front', 'back']).default('front'),
  mountingHeight: z.number().finite().default(1),
  servesToiletId: z.string().nullable().default(null),
})
export type WallFlushPlateNode = z.infer<typeof WallFlushPlateNode>
export const CisternFlushControlNode = BaseNode.extend({
  ...common,
  id: objectId('bath-space-cistern-control'),
  type: nodeType(CISTERN_FLUSH_CONTROL),
  mount: z.enum(['top', 'side', 'pull-chain']).default('top'),
  width: common.width.default(0.055),
  height: common.height.default(0.045),
  thickness: common.thickness.default(0.006),
  buttonSize: common.buttonSize.default(0.018),
  offsetX: length(-0.25, 0.25, 0),
  offsetZ: length(-0.1, 0.1, 0),
  chainLength: length(0.3, 1.4, 0.8),
})
export type CisternFlushControlNode = z.infer<typeof CisternFlushControlNode>
export type FlushControlNode = WallFlushPlateNode | CisternFlushControlNode
export const flushPlatePresets = [
  { shape: 'rectangle', label: 'Rectangular', width: 0.24, height: 0.16, buttonShape: 'rectangle', buttonSize: 0.065, thickness: 0.008 },
  { shape: 'rounded', label: 'Rounded', width: 0.24, height: 0.16, buttonShape: 'round', buttonSize: 0.06, thickness: 0.01 },
  { shape: 'square', label: 'Square', width: 0.18, height: 0.18, buttonShape: 'rectangle', buttonSize: 0.048, thickness: 0.008 },
  { shape: 'round', label: 'Round', width: 0.18, height: 0.18, buttonShape: 'round', buttonSize: 0.045, thickness: 0.01 },
  { shape: 'oval', label: 'Oval', width: 0.25, height: 0.14, buttonShape: 'oval', buttonSize: 0.07, thickness: 0.008 },
] as const
export function controlDimensions(n: FlushControlNode) {
  const width = n.width,
    height = n.shape === 'round' || n.shape === 'square' ? n.width : n.height
  return { width, height, depth: n.thickness + n.buttonProjection }
}
